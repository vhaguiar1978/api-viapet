import Appointment from "../models/Appointment.js";
import AppointmentItem from "../models/AppointmentItem.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import AppointmentStatusHistory from "../models/AppointmentStatusHistory.js";
import Custumers from "../models/Custumers.js";
import Finance from "../models/Finance.js";
import Products from "../models/Products.js";
import Services from "../models/Services.js";

const toNumber = (value) => Number.parseFloat(value || 0) || 0;

const normalizeStatus = (status) => (status || "").toLowerCase();

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

      const latestPaymentFinanceId =
        payments.find((payment) => payment.financeId)?.financeId || null;
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

    const latestPaymentFinanceId =
      payments.find((payment) => payment.financeId)?.financeId || null;
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

  return {
    appointment,
    items,
    legacyItems,
    payments,
    history,
    summary,
    catalogs: {
      products,
      services,
    },
  };
};
