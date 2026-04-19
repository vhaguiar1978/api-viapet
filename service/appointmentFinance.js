import Appointment from "../models/Appointment.js";
import AppointmentItem from "../models/AppointmentItem.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import AppointmentStatusHistory from "../models/AppointmentStatusHistory.js";
import Custumers from "../models/Custumers.js";
import Finance from "../models/Finance.js";
import Products from "../models/Products.js";
import Services from "../models/Services.js";
import { Op } from "sequelize";

const toNumber = (value) => Number.parseFloat(value || 0) || 0;

const normalizeStatus = (status) => (status || "").toLowerCase();
const isComandaManagedFinanceReference = (reference) =>
  /^appointment_(payment:|balance:|free:)/.test(String(reference || ""));
const toTimestamp = (value) => {
  if (!value) return 0;
  const normalizedValue =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00`
      : value;
  const parsed = new Date(normalizedValue).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const getLatestAppointmentPaymentFinanceId = (payments = []) =>
  payments
    .filter((payment) => payment?.financeId)
    .reduce((latestPayment, currentPayment) => {
      if (!latestPayment) {
        return currentPayment;
      }

      const latestTimestamp = Math.max(
        toTimestamp(latestPayment.updatedAt),
        toTimestamp(latestPayment.paidAt),
        toTimestamp(latestPayment.createdAt),
        toTimestamp(latestPayment.dueDate),
      );
      const currentTimestamp = Math.max(
        toTimestamp(currentPayment.updatedAt),
        toTimestamp(currentPayment.paidAt),
        toTimestamp(currentPayment.createdAt),
        toTimestamp(currentPayment.dueDate),
      );

      return currentTimestamp >= latestTimestamp ? currentPayment : latestPayment;
    }, null)?.financeId || null;

export const calculateMachineFeeBreakdown = (grossAmount, feePercentage = 0) => {
  const gross = toNumber(grossAmount);
  const percent = toNumber(feePercentage);
  const feeAmount = Number(((gross * percent) / 100).toFixed(2));
  const netAmount = Number((gross - feeAmount).toFixed(2));

  return {
    grossAmount: gross,
    feePercentage: percent,
    feeAmount,
    netAmount,
  };
};

export const logAppointmentEvent = async ({
  appointmentId,
  usersId,
  createdBy,
  status,
  notes,
  eventType = "status_change",
}) => {
  return AppointmentStatusHistory.create({
    appointmentId,
    usersId,
    createdBy,
    status,
    notes,
    eventType,
  });
};

const getLegacyServiceItems = async (appointment) => {
  const serviceIds = [
    appointment.serviceId,
    appointment.secondaryServiceId,
    appointment.tertiaryServiceId,
  ].filter(Boolean);

  if (serviceIds.length === 0) {
    return [];
  }

  const services = await Services.findAll({
    where: {
      id: serviceIds,
    },
  });

  const serviceMap = new Map(services.map((service) => [service.id, service]));

  return serviceIds
    .map((serviceId, index) => {
      const service = serviceMap.get(serviceId);
      if (!service) return null;

      return {
        id: `legacy-${service.id}-${index}`,
        appointmentId: appointment.id,
        usersId: appointment.usersId,
        type: "service",
        serviceId: service.id,
        productId: null,
        description: service.name,
        quantity: 1,
        unitPrice: toNumber(service.price),
        discount: 0,
        total: toNumber(service.price),
        observation: null,
        legacy: true,
      };
    })
    .filter(Boolean);
};

const buildLegacyServiceItemsFromServiceMap = (appointment, serviceMap = new Map()) => {
  const serviceIds = [
    appointment?.serviceId,
    appointment?.secondaryServiceId,
    appointment?.tertiaryServiceId,
  ].filter(Boolean);

  if (serviceIds.length === 0) {
    return [];
  }

  return serviceIds
    .map((serviceId, index) => {
      const service = serviceMap.get(String(serviceId));
      if (!service) return null;

      return {
        id: `legacy-${service.id}-${index}`,
        appointmentId: appointment.id,
        usersId: appointment.usersId,
        type: "service",
        serviceId: service.id,
        productId: null,
        description: service.name,
        quantity: 1,
        unitPrice: toNumber(service.price),
        discount: 0,
        total: toNumber(service.price),
        observation: null,
        legacy: true,
        Service: service,
        Product: null,
      };
    })
    .filter(Boolean);
};

export const hydrateAppointmentsWithFinancialDetails = async (
  appointments = [],
  usersId,
  options = {},
) => {
  const includePackageContext = Boolean(options?.includePackageContext);
  const normalizedAppointments = (Array.isArray(appointments) ? appointments : [])
    .map((appointment) =>
      typeof appointment?.toJSON === "function" ? appointment.toJSON() : appointment,
    )
    .filter(Boolean);

  if (!normalizedAppointments.length || !usersId) {
    return normalizedAppointments;
  }

  const appointmentIds = normalizedAppointments
    .map((appointment) => appointment?.id)
    .filter(Boolean);

  if (!appointmentIds.length) {
    return normalizedAppointments;
  }

  const packageGroupIds = includePackageContext
    ? [
        ...new Set(
            normalizedAppointments
              .map((appointment) => String(appointment?.packageGroupId || "").trim())
              .filter(Boolean),
          ),
      ]
    : [];

  const packageOccurrences = packageGroupIds.length
    ? await Appointment.findAll({
        where: {
          usersId,
          packageGroupId: {
            [Op.in]: packageGroupIds,
          },
        },
        attributes: [
          "id",
          "date",
          "time",
          "packageNumber",
          "packageMax",
          "packageGroupId",
          "status",
          "responsibleId",
          "sellerName",
        ],
        order: [
          ["packageNumber", "ASC"],
          ["date", "ASC"],
          ["time", "ASC"],
        ],
      })
    : [];

  const packageOccurrenceIds = packageOccurrences
    .map((appointment) => appointment?.id)
    .filter(Boolean);
  const allRelevantAppointmentIds = [
    ...new Set([...appointmentIds, ...packageOccurrenceIds]),
  ];

  const [items, payments, history] = await Promise.all([
    AppointmentItem.findAll({
      where: {
        appointmentId: allRelevantAppointmentIds,
        usersId,
      },
      order: [["createdAt", "ASC"]],
    }),
    AppointmentPayment.findAll({
      where: {
        appointmentId: allRelevantAppointmentIds,
        usersId,
      },
      order: [["dueDate", "ASC"], ["createdAt", "ASC"]],
    }),
    AppointmentStatusHistory.findAll({
      where: {
        appointmentId: allRelevantAppointmentIds,
        usersId,
      },
      order: [["createdAt", "DESC"]],
    }),
  ]);

  const serviceIds = [
    ...new Set(
      [
        ...normalizedAppointments.flatMap((appointment) => [
          appointment?.serviceId,
          appointment?.secondaryServiceId,
          appointment?.tertiaryServiceId,
          appointment?.Service?.id,
        ]),
        ...items.map((item) => item?.serviceId),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  const productIds = [
    ...new Set(
      items
        .map((item) => String(item?.productId || "").trim())
        .filter(Boolean),
    ),
  ];

  const [services, products] = await Promise.all([
    serviceIds.length
      ? Services.findAll({
          where: {
            id: serviceIds,
          },
        })
      : [],
    productIds.length
      ? Products.findAll({
          where: {
            id: productIds,
            usersId,
          },
        })
      : [],
  ]);

  const serviceMap = new Map(
    services.map((service) => [
      String(service.id),
      typeof service?.toJSON === "function" ? service.toJSON() : service,
    ]),
  );
  const productMap = new Map(
    products.map((product) => [
      String(product.id),
      typeof product?.toJSON === "function" ? product.toJSON() : product,
    ]),
  );

  const itemsByAppointmentId = items.reduce((acc, item) => {
    const key = String(item.appointmentId || "");
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    const normalizedItem =
      typeof item?.toJSON === "function" ? item.toJSON() : item;
    acc[key].push({
      ...normalizedItem,
      Service: normalizedItem.serviceId
        ? serviceMap.get(String(normalizedItem.serviceId)) || null
        : null,
      Product: normalizedItem.productId
        ? productMap.get(String(normalizedItem.productId)) || null
        : null,
    });
    return acc;
  }, {});
  const paymentsByAppointmentId = payments.reduce((acc, payment) => {
    const key = String(payment.appointmentId || "");
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(typeof payment?.toJSON === "function" ? payment.toJSON() : payment);
    return acc;
  }, {});
  const historyByAppointmentId = history.reduce((acc, entry) => {
    const key = String(entry.appointmentId || "");
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(typeof entry?.toJSON === "function" ? entry.toJSON() : entry);
    return acc;
  }, {});
  const packageOccurrencesByGroupId = packageOccurrences.reduce((acc, appointment) => {
    const packageGroupId = String(appointment?.packageGroupId || "").trim();
    if (!packageGroupId) return acc;
    if (!acc[packageGroupId]) acc[packageGroupId] = [];
    acc[packageGroupId].push(
      typeof appointment?.toJSON === "function" ? appointment.toJSON() : appointment,
    );
    return acc;
  }, {});
  const sharedPackagePaymentsByGroupId = Object.entries(packageOccurrencesByGroupId).reduce(
    (acc, [packageGroupId, occurrences]) => {
      const paidPayments = occurrences.flatMap((occurrence) =>
        (paymentsByAppointmentId[String(occurrence?.id || "")] || []).filter(
          (payment) => normalizeStatus(payment.status) === "pago",
        ),
      );
      acc[packageGroupId] = paidPayments;
      return acc;
    },
    {},
  );

  return Promise.all(
    normalizedAppointments.map(async (appointment) => {
      const appointmentId = String(appointment.id || "");
      const itemsList = itemsByAppointmentId[appointmentId] || [];
      const paymentsList = paymentsByAppointmentId[appointmentId] || [];
      const statusHistory = historyByAppointmentId[appointmentId] || [];
      const legacyItemsList = itemsList.length
        ? []
        : buildLegacyServiceItemsFromServiceMap(appointment, serviceMap);
      const summary = await calculateAppointmentSummary(
        appointment,
        itemsList.length ? itemsList : legacyItemsList,
        paymentsList,
      );

      return {
        ...appointment,
        Service: appointment?.serviceId
          ? serviceMap.get(String(appointment.serviceId)) ||
            appointment?.Service ||
            null
          : appointment?.Service || null,
        itemsList,
        legacyItemsList,
        paymentsList,
        statusHistory,
        packageOccurrences: appointment?.packageGroupId
          ? packageOccurrencesByGroupId[String(appointment.packageGroupId).trim()] || []
          : appointment?.packageOccurrences || [],
        sharedPackagePayments: appointment?.packageGroupId
          ? sharedPackagePaymentsByGroupId[String(appointment.packageGroupId).trim()] || []
          : appointment?.sharedPackagePayments || [],
        summary: {
          ...summary,
          usesLegacyItems: !itemsList.length && legacyItemsList.length > 0,
        },
      };
    }),
  );
};

export const calculateAppointmentSummary = async (appointment, items, payments) => {
  const effectiveItems =
    items.length > 0 ? items : await getLegacyServiceItems(appointment);

  const itemCount = effectiveItems.length;
  const servicesCount = effectiveItems.filter((item) => item.type === "service").length;
  const productsCount = effectiveItems.filter((item) => item.type === "product").length;
  const subtotal = effectiveItems.reduce(
    (sum, item) => sum + toNumber(item.unitPrice) * Number(item.quantity || 0),
    0,
  );
  const discountTotal = effectiveItems.reduce(
    (sum, item) => sum + toNumber(item.discount),
    0,
  );
  const total = effectiveItems.reduce((sum, item) => sum + toNumber(item.total), 0);
  const paid = payments
    .filter((payment) => normalizeStatus(payment.status) === "pago")
    .reduce(
      (sum, payment) => sum + toNumber(payment.grossAmount || payment.amount),
      0,
    );
  const paidNet = payments
    .filter((payment) => normalizeStatus(payment.status) === "pago")
    .reduce(
      (sum, payment) =>
        sum + toNumber(payment.netAmount || payment.grossAmount || payment.amount),
      0,
    );
  const pendingPayments = payments
    .filter((payment) => normalizeStatus(payment.status) === "pendente")
    .reduce(
      (sum, payment) => sum + toNumber(payment.grossAmount || payment.amount),
      0,
    );
  const pendingNet = payments
    .filter((payment) => normalizeStatus(payment.status) === "pendente")
    .reduce(
      (sum, payment) =>
        sum + toNumber(payment.netAmount || payment.grossAmount || payment.amount),
      0,
    );
  const balance = Math.max(total - paid, 0);

  let financialStatus = "sem_cobranca";
  if (total > 0 && paid === 0 && balance > 0) {
    financialStatus = "pendente";
  } else if (paid > 0 && balance > 0) {
    financialStatus = "parcial";
  } else if (total > 0 && balance === 0) {
    financialStatus = "pago";
  }

  return {
    itemCount,
    servicesCount,
    productsCount,
    subtotal,
    discountTotal,
    total,
    paid,
    paidNet,
    pendingPayments,
    pendingNet,
    balance,
    financialStatus,
    usesLegacyItems: items.length === 0 && effectiveItems.length > 0,
  };
};

export const syncAppointmentFinance = async (appointmentId) => {
  const appointment = await Appointment.findByPk(appointmentId);
  if (!appointment) {
    throw new Error("Agendamento não encontrado");
  }

  const currentLinkedFinance = appointment.financeId
    ? await Finance.findByPk(appointment.financeId)
    : null;

  const [items, payments, customer] = await Promise.all([
    AppointmentItem.findAll({
      where: { appointmentId },
      order: [["createdAt", "ASC"]],
    }),
    AppointmentPayment.findAll({
      where: { appointmentId },
      order: [["dueDate", "ASC"], ["createdAt", "ASC"]],
    }),
    Custumers.findByPk(appointment.customerId),
  ]);

  const summary = await calculateAppointmentSummary(appointment, items, payments);
  const customerName = customer?.name || "Cliente não identificado";
  const appointmentDate = appointment.date
    ? new Date(`${appointment.date}T12:00:00`)
    : new Date();

  for (const payment of payments) {
    const financePayload = {
      type: "entrada",
      description: `Agendamento - ${customerName}`,
      amount: toNumber(payment.netAmount || payment.grossAmount || payment.amount),
      grossAmount: toNumber(payment.grossAmount || payment.amount),
      feePercentage: toNumber(payment.feePercentage),
      feeAmount: toNumber(payment.feeAmount),
      netAmount: toNumber(payment.netAmount || payment.grossAmount || payment.amount),
      date:
        normalizeStatus(payment.status) === "pago"
          ? payment.paidAt || new Date()
          : appointmentDate,
      dueDate: payment.dueDate ? new Date(`${payment.dueDate}T12:00:00`) : appointmentDate,
      category: "Agendamentos",
      subCategory: appointment.type || "Agenda",
      expenseType: "variavel",
      frequency: "unico",
      paymentMethod: payment.paymentMethod || "Pendente",
      status: normalizeStatus(payment.status) || "pendente",
      reference: `appointment_payment:${payment.id}`,
      notes: payment.details,
      createdBy: payment.createdBy,
      usersId: appointment.usersId,
    };

    let financeRecord = payment.financeId
      ? await Finance.findByPk(payment.financeId)
      : await Finance.findOne({
          where: {
            reference: `appointment_payment:${payment.id}`,
            usersId: appointment.usersId,
          },
        });

    if (financeRecord) {
      await financeRecord.update(financePayload);
    } else {
      financeRecord = await Finance.create(financePayload);
      await payment.update({ financeId: financeRecord.id });
    }
  }

  const canceledPayments = payments.filter(
    (payment) => normalizeStatus(payment.status) === "cancelado" && payment.financeId,
  );

  for (const payment of canceledPayments) {
    const financeRecord = await Finance.findByPk(payment.financeId);
    if (financeRecord) {
      await financeRecord.update({
        status: "cancelado",
        amount: 0,
      });
    }
  }

  if (
    currentLinkedFinance &&
    !isComandaManagedFinanceReference(currentLinkedFinance.reference) &&
    (items.length > 0 || payments.length > 0)
  ) {
    await currentLinkedFinance.destroy();
    await appointment.update({ financeId: null });
  }

  const balanceReference = `appointment_balance:${appointment.id}`;
  const existingBalanceFinance = await Finance.findOne({
    where: {
      reference: balanceReference,
      usersId: appointment.usersId,
    },
  });

  if (summary.balance > 0) {
    const earliestPendingDate =
      payments.find((payment) => normalizeStatus(payment.status) === "pendente")?.dueDate ||
      appointment.date;
    const hasPendingPaymentRows = payments.some(
      (payment) => normalizeStatus(payment.status) === "pendente",
    );

    if (hasPendingPaymentRows) {
      if (existingBalanceFinance) {
        await existingBalanceFinance.destroy();
      }

      const latestPaymentFinanceId = getLatestAppointmentPaymentFinanceId(payments);
      await appointment.update({ financeId: latestPaymentFinanceId });
      return summary;
    }

    const balancePayload = {
      type: "entrada",
      description: `Saldo agendamento - ${customerName}`,
      amount: summary.balance,
      grossAmount: summary.balance,
      feePercentage: 0,
      feeAmount: 0,
      netAmount: summary.balance,
      date: appointmentDate,
      dueDate: earliestPendingDate
        ? new Date(`${earliestPendingDate}T12:00:00`)
        : appointmentDate,
      category: "Agendamentos",
      subCategory: appointment.type || "Agenda",
      expenseType: "variavel",
      frequency: "unico",
      paymentMethod: "Pendente",
      status: "pendente",
      reference: balanceReference,
      notes: "Saldo em aberto da comanda do agendamento",
      createdBy: appointment.responsibleId || appointment.usersId,
      usersId: appointment.usersId,
    };

    if (existingBalanceFinance) {
      await existingBalanceFinance.update(balancePayload);
      await appointment.update({ financeId: existingBalanceFinance.id });
    } else {
      const newBalanceFinance = await Finance.create(balancePayload);
      await appointment.update({ financeId: newBalanceFinance.id });
    }
  } else {
    if (existingBalanceFinance) {
      await existingBalanceFinance.destroy();
    }

    const latestPaymentFinanceId = getLatestAppointmentPaymentFinanceId(payments);
    if (latestPaymentFinanceId) {
      await appointment.update({ financeId: latestPaymentFinanceId });
    } else {
      const freeAppointmentFinance = await Finance.findOne({
        where: {
          reference: `appointment_free:${appointment.id}`,
          usersId: appointment.usersId,
        },
      });
      if (freeAppointmentFinance) {
        await freeAppointmentFinance.destroy();
      }

      if (appointment.financeId) {
        const linkedFinance = await Finance.findByPk(appointment.financeId);
        if (linkedFinance) {
          await linkedFinance.destroy();
        }
      }
      await appointment.update({ financeId: null });
    }
  }

  return summary;
};

export const getAppointmentComandaDetails = async (appointmentId, usersId) => {
  const appointment = await Appointment.findOne({
    where: {
      id: appointmentId,
      usersId,
    },
  });

  if (!appointment) {
    return null;
  }

  const [items, payments, history, products, services] = await Promise.all([
    AppointmentItem.findAll({
      where: { appointmentId },
      order: [["createdAt", "ASC"]],
    }),
    AppointmentPayment.findAll({
      where: { appointmentId },
      order: [["dueDate", "ASC"], ["createdAt", "ASC"]],
    }),
    AppointmentStatusHistory.findAll({
      where: { appointmentId },
      order: [["createdAt", "DESC"]],
    }),
    Products.findAll({
      attributes: ["id", "name", "price", "stoke"],
      where: { usersId },
    }),
    Services.findAll({
      attributes: ["id", "name", "price", "category"],
      where: { establishment: usersId },
    }),
  ]);

  const summary = await calculateAppointmentSummary(appointment, items, payments);
  if (summary.total <= 0 && payments.length === 0 && appointment.financeId) {
    await syncAppointmentFinance(appointment.id);
    await appointment.reload();
  }
  const legacyItems = items.length === 0 ? await getLegacyServiceItems(appointment) : [];
  const finance = appointment.financeId
    ? await Finance.findByPk(appointment.financeId)
    : null;
  const packageOccurrences =
    appointment.packageGroupId || (appointment.package && Number(appointment.packageMax || 0) > 1)
      ? await Appointment.findAll({
          where: appointment.packageGroupId
            ? {
                usersId,
                packageGroupId: appointment.packageGroupId,
              }
            : {
                usersId,
                customerId: appointment.customerId,
                petId: appointment.petId,
                serviceId: appointment.serviceId,
                package: true,
                packageMax: appointment.packageMax,
              },
          attributes: ["id", "date", "time", "packageNumber", "packageMax", "packageGroupId", "status"],
          order: [
            ["packageNumber", "ASC"],
            ["date", "ASC"],
            ["time", "ASC"],
          ],
        })
      : [];
  const sharedPackagePayments =
    packageOccurrences.length > 0
      ? await AppointmentPayment.findAll({
          where: {
            appointmentId: packageOccurrences.map((occurrence) => occurrence.id),
            usersId,
          },
          order: [["dueDate", "ASC"], ["createdAt", "ASC"]],
        })
      : [];

  return {
    appointment,
    items,
    legacyItems,
    payments,
    history,
    summary,
    finance,
    packageOccurrences,
    sharedPackagePayments,
    catalogs: {
      products,
      services,
    },
  };
};
