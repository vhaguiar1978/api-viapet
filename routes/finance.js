import express from "express";
import authenticate from "../middlewares/auth.js";
import Sales from "../models/Sales.js";
import Appointment from "../models/Appointment.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Pets from "../models/Pets.js";
import Services from "../models/Services.js";
import Users from "../models/Users.js";
import { Op } from "sequelize";
import Finance from "../models/Finance.js";
import CashClosure from "../models/CashClosure.js";
import sequelize from "sequelize";
import { hydrateAppointmentsWithFinancialDetails } from "../service/appointmentFinance.js";
const router = express.Router();

function normalizeViaCentralMetricText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeViaCentralCategoryLabel(
  rawCategory = "",
  rawServiceName = "",
  appointmentType = "",
) {
  const category = String(rawCategory || "").trim();
  const serviceName = String(rawServiceName || "").trim();
  const appointmentKind = String(appointmentType || "").trim();
  const source = normalizeViaCentralMetricText(
    `${category} ${serviceName} ${appointmentKind}`,
  );

  if (source.includes("pacot")) return "Pacotinhos";
  if (source.includes("internac") || source.includes("interna")) return "Internacao";
  if (source.includes("cirurg")) return "Cirurgias";
  if (
    source.includes("consult") ||
    source.includes("clinica") ||
    source.includes("exame") ||
    source.includes("vacina") ||
    source.includes("procedimento")
  ) {
    return "Clinica";
  }
  if (
    source.includes("estet") ||
    source.includes("banho") ||
    source.includes("tosa") ||
    source.includes("hidrat")
  ) {
    return "Estetica";
  }
  if (category) return category;
  if (serviceName) return serviceName;
  return "Outros";
}

function getViaCentralDetailedItems(appointment = {}) {
  if (Array.isArray(appointment?.itemsList) && appointment.itemsList.length) {
    return appointment.itemsList;
  }
  if (Array.isArray(appointment?.legacyItemsList) && appointment.legacyItemsList.length) {
    return appointment.legacyItemsList;
  }
  if (Array.isArray(appointment?.itemRows) && appointment.itemRows.length) {
    return appointment.itemRows;
  }
  return [];
}

function getViaCentralServiceEntries(appointment = {}) {
  const detailedItems = getViaCentralDetailedItems(appointment);
  const serviceItems = detailedItems.filter((item) => {
    const normalizedType = normalizeViaCentralMetricText(item?.type || item?.kind || "");
    if (normalizedType === "product") return false;
    if (normalizedType === "service") return true;
    if (item?.serviceId || item?.Service?.id || item?.Service?.name) return true;
    return !(item?.productId || item?.Product?.id);
  });

  if (serviceItems.length) {
    return serviceItems
      .map((item) => {
        const quantity = Number(item?.quantity || 1) || 1;
        const unitPrice = Number(item?.unitPrice ?? item?.price ?? 0) || 0;
        const total = Number(item?.total ?? quantity * unitPrice) || 0;
        const label =
          String(
            item?.description ||
              item?.name ||
              item?.serviceName ||
              item?.Service?.name ||
              appointment?.Service?.name ||
              "Servico",
          ).trim() || "Servico";

        return {
          label,
          category: normalizeViaCentralCategoryLabel(
            item?.Service?.category || appointment?.Service?.category,
            label,
            appointment?.type,
          ),
          count: quantity,
          amount: total,
        };
      })
      .filter((item) => item.label);
  }

  const fallbackLabel =
    String(
      appointment?.Service?.name ||
        appointment?.serviceName ||
        appointment?.title ||
        appointment?.event ||
        "Servico",
    ).trim() || "Servico";
  const fallbackAmount =
    Number(appointment?.summary?.total || 0) ||
    Number(appointment?.finance?.grossAmount || appointment?.finance?.amount || 0) ||
    Number(appointment?.Service?.price || 0) ||
    0;

  return fallbackLabel
    ? [
        {
          label: fallbackLabel,
          category: normalizeViaCentralCategoryLabel(
            appointment?.Service?.category,
            fallbackLabel,
            appointment?.type,
          ),
          count: 1,
          amount: fallbackAmount,
        },
      ]
    : [];
}

function getPackageOccurrenceNumber(appointment = {}) {
  const candidates = [
    appointment?.packageNumber,
    appointment?.packageIndex,
    appointment?.package?.index,
  ];

  for (const candidate of candidates) {
    const normalizedNumber = Number(candidate || 0) || 0;
    if (normalizedNumber > 0) {
      return normalizedNumber;
    }
  }

  return 0;
}

function getPackageTotalCount(appointment = {}) {
  const candidates = [
    appointment?.packageMax,
    appointment?.packageTotal,
    appointment?.package?.total,
  ];

  for (const candidate of candidates) {
    const normalizedNumber = Number(candidate || 0) || 0;
    if (normalizedNumber > 0) {
      return normalizedNumber;
    }
  }

  return 0;
}

function isPackageAppointment(appointment = {}) {
  return (
    Boolean(appointment?.package) ||
    String(appointment?.packageGroupId || "").trim() !== "" ||
    getPackageTotalCount(appointment) > 1 ||
    normalizeViaCentralMetricText(
      `${appointment?.Service?.name || ""} ${appointment?.Service?.category || ""} ${appointment?.finance?.description || ""}`,
    ).includes("pacot")
  );
}

function isPrimaryPackageOccurrence(appointment = {}) {
  if (!isPackageAppointment(appointment)) {
    return true;
  }

  const occurrenceNumber = getPackageOccurrenceNumber(appointment);
  if (occurrenceNumber > 0) {
    return occurrenceNumber === 1;
  }

  const currentDate = String(appointment?.date || "").slice(0, 10);
  const packageOccurrences = Array.isArray(appointment?.packageOccurrences)
    ? appointment.packageOccurrences
    : [];
  const orderedDates = packageOccurrences
    .map((item) => String(item?.date || "").slice(0, 10))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  if (orderedDates.length && currentDate) {
    return orderedDates[0] === currentDate;
  }

  return true;
}

function buildNormalizedDateString(year, month, day) {
  const isoValue = `${year}-${month}-${day}`;
  const parsedDate = new Date(`${isoValue}T12:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const [parsedYear, parsedMonth, parsedDay] = isoValue.split("-").map(Number);
  if (
    parsedDate.getFullYear() !== parsedYear ||
    parsedDate.getMonth() + 1 !== parsedMonth ||
    parsedDate.getDate() !== parsedDay
  ) {
    return null;
  }

  return isoValue;
}

function normalizeFinanceDateInput(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return null;

  const isoMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return buildNormalizedDateString(isoMatch[1], isoMatch[2], isoMatch[3]);
  }

  const brMatch = rawValue.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  if (brMatch) {
    return buildNormalizedDateString(brMatch[3], brMatch[2], brMatch[1]);
  }

  const digitsOnly = rawValue.replace(/\D/g, "");
  if (digitsOnly.length === 8) {
    if (/^(19|20)\d{6}$/.test(digitsOnly)) {
      return buildNormalizedDateString(
        digitsOnly.slice(0, 4),
        digitsOnly.slice(4, 6),
        digitsOnly.slice(6, 8)
      );
    }

    return buildNormalizedDateString(
      digitsOnly.slice(4, 8),
      digitsOnly.slice(2, 4),
      digitsOnly.slice(0, 2)
    );
  }

  return null;
}

function parseDateParam(value, endOfDay = false) {
  if (!value) return null;
  const normalizedValue = normalizeFinanceDateInput(value);
  if (!normalizedValue) return null;
  const [year, month, day] = normalizedValue.split("-").map(Number);
  if (!year || !month || !day) return null;
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
}

// Função auxiliar para calcular datas
const getDateRanges = () => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(
    startOfDay.getFullYear(),
    startOfDay.getMonth(),
    1
  );

  return { startOfDay, endOfDay, startOfWeek, startOfMonth };
};

function isAgendaFinanceRow(finance = {}) {
  const reference = String(finance.reference || "").trim().toLowerCase();
  const description = String(finance.description || "").trim().toLowerCase();
  const category = String(finance.category || "").trim().toLowerCase();
  const subCategory = String(finance.subCategory || "").trim().toLowerCase();

  return (
    reference === "appointment" ||
    reference.startsWith("appointment_payment:") ||
    reference.startsWith("appointment_balance:") ||
    reference.startsWith("appointment_free:") ||
    description.startsWith("agendamento") ||
    description.startsWith("saldo agendamento") ||
    category.includes("agendamento") ||
    subCategory.includes("agenda")
  );
}

function getAgendaFinanceReferenceKind(reference) {
  const normalizedReference = String(reference || "").trim().toLowerCase();

  if (normalizedReference.startsWith("appointment_balance:")) {
    return "balance";
  }

  if (normalizedReference.startsWith("appointment_free:")) {
    return "free";
  }

  if (normalizedReference.startsWith("appointment_payment:")) {
    return "payment";
  }

  if (normalizedReference === "appointment") {
    return "legacy";
  }

  return "other";
}

function parseAppointmentIdFromReference(reference) {
  const normalizedReference = String(reference || "").trim();
  const [prefix, appointmentId] = normalizedReference.split(":");

  if (
    (prefix === "appointment_balance" || prefix === "appointment_free") &&
    appointmentId
  ) {
    return appointmentId;
  }

  return null;
}

function toComparableTimestamp(value) {
  if (!value) return 0;

  const normalizedValue =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00`
      : value;
  const parsedTimestamp = new Date(normalizedValue).getTime();

  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
}

function normalizeAgendaPetName(value) {
  return String(value || "").trim().toLowerCase();
}

function getFinanceDateKey(finance = {}) {
  const sourceValue = finance.dueDate || finance.date;
  if (!sourceValue) {
    return "";
  }

  if (typeof sourceValue === "string" && /^\d{4}-\d{2}-\d{2}/.test(sourceValue)) {
    return sourceValue.slice(0, 10);
  }

  const parsedDate = new Date(sourceValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toISOString().slice(0, 10);
}

function extractLegacyFinancePetName(description) {
  const parts = String(description || "")
    .split(" - ")
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (parts.length < 3) {
    return "";
  }

  return normalizeAgendaPetName(parts[parts.length - 1]);
}

function getAgendaAppointmentDisplayKey(appointment) {
  if (!appointment) {
    return null;
  }

  const customerId = String(appointment.customerId || "").trim();
  const petId = String(appointment.petId || "").trim();
  const date = String(appointment.date || "").trim();
  const time = String(appointment.time || "").trim();

  if (!customerId && !petId) {
    return String(appointment.id || "").trim() || null;
  }

  return [customerId || "sem-cliente", petId || "sem-pet", date, time]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

function getAgendaFinancePriority({ finance, appointment, payment, referenceKind }) {
  const priorityByType = {
    balance: 500,
    free: 450,
    payment: 400,
    legacy: 100,
    other: 50,
  };

  let score = priorityByType[referenceKind] || 0;

  if (appointment && Number(appointment.financeId) === Number(finance.id)) {
    if (referenceKind === "balance" || referenceKind === "free") {
      score += 250;
    } else if (referenceKind === "legacy") {
      score += 80;
    }
  }

  if (String(finance.status || "").trim().toLowerCase() === "pago") {
    score += 25;
  }

  if (String(payment?.status || "").trim().toLowerCase() === "pago") {
    score += 15;
  }

  return score;
}

async function keepOnlyCurrentAgendaFinanceRows(finances = [], usersId) {
  const rows = Array.isArray(finances) ? finances : [];
  const agendaRows = rows.filter((item) => isAgendaFinanceRow(item));
  if (!agendaRows.length) {
    return rows;
  }

  const financeIds = agendaRows.map((item) => item?.id).filter(Boolean);
  if (!financeIds.length) {
    return rows;
  }

  const appointmentIdsFromReferences = [
    ...new Set(
      agendaRows
        .map((item) => parseAppointmentIdFromReference(item.reference))
        .filter(Boolean),
    ),
  ];
  const legacyDates = [
    ...new Set(
      agendaRows
        .filter((item) => getAgendaFinanceReferenceKind(item.reference) === "legacy")
        .map((item) => getFinanceDateKey(item))
        .filter(Boolean),
    ),
  ];

  const appointmentPayments = await AppointmentPayment.findAll({
    attributes: [
      "id",
      "appointmentId",
      "financeId",
      "dueDate",
      "paidAt",
      "status",
      "createdAt",
      "updatedAt",
    ],
    where: {
      usersId,
      financeId: {
        [Op.in]: financeIds,
      },
    },
  });

  const appointmentIdsFromPayments = [
    ...new Set(
      appointmentPayments.map((item) => item?.appointmentId).filter(Boolean),
    ),
  ];

  const appointmentFilters = [
    {
      financeId: {
        [Op.in]: financeIds,
      },
    },
  ];

  const mappedAppointmentIds = [
    ...new Set([...appointmentIdsFromReferences, ...appointmentIdsFromPayments]),
  ];
  if (mappedAppointmentIds.length > 0) {
    appointmentFilters.push({
      id: {
        [Op.in]: mappedAppointmentIds,
      },
    });
  }

  const directAppointments = await Appointment.findAll({
    attributes: [
      "id",
      "financeId",
      "customerId",
      "petId",
      "date",
      "time",
      "createdAt",
      "updatedAt",
    ],
    where: {
      usersId,
      [Op.or]: appointmentFilters,
    },
  });
  const legacyDateAppointments = legacyDates.length > 0
    ? await Appointment.findAll({
        attributes: [
          "id",
          "financeId",
          "customerId",
          "petId",
          "date",
          "time",
          "createdAt",
          "updatedAt",
        ],
        where: {
          usersId,
          date: {
            [Op.in]: legacyDates,
          },
        },
      })
    : [];
  const appointments = [
    ...new Map(
      [...directAppointments, ...legacyDateAppointments].map((item) => [String(item.id), item]),
    ).values(),
  ];
  const petIds = [
    ...new Set(appointments.map((item) => item?.petId).filter(Boolean)),
  ];
  const pets = petIds.length > 0
    ? await Pets.findAll({
        attributes: ["id", "name"],
        where: {
          id: {
            [Op.in]: petIds,
          },
        },
      })
    : [];

  const appointmentById = new Map(
    appointments.map((item) => [String(item.id), item]),
  );
  const appointmentByLegacyFinanceId = new Map(
    appointments
      .filter((item) => item?.financeId)
      .map((item) => [Number(item.financeId), item]),
  );
  const paymentByFinanceId = new Map(
    appointmentPayments
      .filter((item) => item?.financeId)
      .map((item) => [Number(item.financeId), item]),
  );
  const petById = new Map(
    pets.map((item) => [String(item.id), item]),
  );
  const appointmentsByPetDate = new Map();

  for (const appointment of appointments) {
    const petName = normalizeAgendaPetName(petById.get(String(appointment.petId))?.name);
    const dateKey = String(appointment.date || "").slice(0, 10);

    if (!petName || !dateKey) {
      continue;
    }

    const petDateKey = `${petName}|${dateKey}`;
    const currentAppointment = appointmentsByPetDate.get(petDateKey);
    const currentTimestamp = Math.max(
      toComparableTimestamp(currentAppointment?.updatedAt),
      toComparableTimestamp(currentAppointment?.createdAt),
    );
    const nextTimestamp = Math.max(
      toComparableTimestamp(appointment.updatedAt),
      toComparableTimestamp(appointment.createdAt),
    );

    if (!currentAppointment || nextTimestamp >= currentTimestamp) {
      appointmentsByPetDate.set(petDateKey, appointment);
    }
  }

  const selectedAgendaFinanceIds = new Set();
  const selectedRowsByAppointment = new Map();

  for (const finance of agendaRows) {
    const financeId = Number(finance.id);
    const referenceKind = getAgendaFinanceReferenceKind(finance.reference);
    const payment = paymentByFinanceId.get(financeId) || null;
    const appointmentId =
      payment?.appointmentId ||
      parseAppointmentIdFromReference(finance.reference) ||
      appointmentByLegacyFinanceId.get(financeId)?.id ||
      `finance:${financeId}`;
    let appointment = appointmentById.get(String(appointmentId)) || null;
    if (!appointment && referenceKind === "legacy") {
      const petName = extractLegacyFinancePetName(finance.description);
      const dateKey = getFinanceDateKey(finance);
      appointment = appointmentsByPetDate.get(`${petName}|${dateKey}`) || null;
    }
    const displayGroupKey =
      getAgendaAppointmentDisplayKey(appointment) || String(appointmentId);
    const priority = getAgendaFinancePriority({
      finance,
      appointment,
      payment,
      referenceKind,
    });
    const timestamp = Math.max(
      toComparableTimestamp(finance.updatedAt),
      toComparableTimestamp(finance.createdAt),
      toComparableTimestamp(finance.dueDate),
      toComparableTimestamp(finance.date),
      toComparableTimestamp(payment?.updatedAt),
      toComparableTimestamp(payment?.createdAt),
      toComparableTimestamp(payment?.paidAt),
      toComparableTimestamp(payment?.dueDate),
      toComparableTimestamp(appointment?.updatedAt),
      toComparableTimestamp(appointment?.createdAt),
      toComparableTimestamp(appointment?.date),
    );
    const currentSelection = selectedRowsByAppointment.get(displayGroupKey);

    if (
      !currentSelection ||
      priority > currentSelection.priority ||
      (priority === currentSelection.priority &&
        timestamp >= currentSelection.timestamp)
    ) {
      selectedRowsByAppointment.set(displayGroupKey, {
        financeId,
        priority,
        timestamp,
      });
    }
  }

  for (const selection of selectedRowsByAppointment.values()) {
    selectedAgendaFinanceIds.add(selection.financeId);
  }

  return rows.filter((finance) => {
    if (!isAgendaFinanceRow(finance)) {
      return true;
    }

    return selectedAgendaFinanceIds.has(Number(finance.id));
  });
}

// Criar nova entrada/saída financeira
router.post("/finance", authenticate, async (req, res) => {
  try {
    const {
      type,
      description,
      amount,
      date,
      dueDate,
      category,
      subCategory,
      expenseType,
      frequency,
      paymentMethod,
      reference,
      notes,
      attachments,
      status,
      grossAmount,
      feePercentage,
      feeAmount,
      netAmount,
    } = req.body;
    const normalizedDate = date ? normalizeFinanceDateInput(date) : null;
    const normalizedDueDate = dueDate ? normalizeFinanceDateInput(dueDate) : null;

    if (date && !normalizedDate) {
      return res.status(400).json({
        message: "Data do lancamento invalida",
        error: "Informe a data no formato dia-mes-ano ou ano-mes-dia.",
      });
    }

    if (dueDate && !normalizedDueDate) {
      return res.status(400).json({
        message: "Data de vencimento invalida",
        error: "Informe o vencimento no formato dia-mes-ano ou ano-mes-dia.",
      });
    }

    const finance = await Finance.create({
      type,
      description,
      amount,
      grossAmount,
      feePercentage,
      feeAmount,
      netAmount,
      date: normalizedDate,
      dueDate: normalizedDueDate,
      category,
      subCategory,
      expenseType,
      frequency,
      paymentMethod,
      reference,
      notes,
      attachments,
      status,
      createdBy: req.user.id,
      usersId: req.user.establishment,
    });

    res.status(201).json({
      message: "Registro financeiro criado com sucesso",
      data: finance,
    });
  } catch (error) {
    console.error("Erro ao criar registro financeiro:", error);
    res.status(500).json({
      message: "Erro ao criar registro financeiro",
      error: error.message,
    });
  }
});

router.post("/finance/close-cash", authenticate, async (req, res) => {
  try {
    const referenceDate = req.body.referenceDate || new Date().toISOString().slice(0, 10);
    const notes = req.body.notes || null;

    const startDateTime = new Date(referenceDate);
    startDateTime.setUTCHours(0, 0, 0, 0);

    const endDateTime = new Date(referenceDate);
    endDateTime.setUTCHours(23, 59, 59, 999);

    const finances = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        dueDate: {
          [Op.gte]: startDateTime,
          [Op.lte]: endDateTime,
        },
        status: {
          [Op.ne]: "cancelado",
        },
      },
    });
    const currentFinances = await keepOnlyCurrentAgendaFinanceRows(
      finances,
      req.user.establishment,
    );

    const totals = currentFinances.reduce(
      (acc, item) => {
        const amount = Number(item.netAmount ?? item.amount ?? 0);

        if (item.type === "entrada") {
          acc.totalEntries += amount;
        }

        if (item.type === "saida") {
          acc.totalExpenses += amount;
        }

        if (item.category === "Vendas" && item.type === "entrada") {
          acc.totalSales += amount;
        }

        return acc;
      },
      {
        totalEntries: 0,
        totalExpenses: 0,
        totalSales: 0,
      }
    );

    const balance = totals.totalEntries - totals.totalExpenses;

    const payload = {
      referenceDate,
      totalEntries: totals.totalEntries,
      totalExpenses: totals.totalExpenses,
      totalSales: totals.totalSales,
      balance,
      notes,
      closedAt: new Date(),
      closedBy: req.user.id,
      usersId: req.user.establishment,
    };

    const existingClosure = await CashClosure.findOne({
      where: {
        referenceDate,
        usersId: req.user.establishment,
      },
    });

    const closure = existingClosure
      ? await existingClosure.update(payload)
      : await CashClosure.create(payload);

    res.status(200).json({
      message: "Caixa fechado com sucesso",
      data: closure,
    });
  } catch (error) {
    console.error("Erro ao fechar caixa:", error);
    res.status(500).json({
      message: "Erro ao fechar caixa",
      error: error.message,
    });
  }
});

router.get("/finance/cash-status/:referenceDate", authenticate, async (req, res) => {
  try {
    const referenceDate = req.params.referenceDate;

    const openingEntry = await Finance.findOne({
      where: {
        usersId: req.user.establishment,
        category: "Caixa",
        subCategory: "Abertura",
        dueDate: {
          [Op.gte]: new Date(`${referenceDate}T00:00:00.000Z`),
          [Op.lte]: new Date(`${referenceDate}T23:59:59.999Z`),
        },
        status: {
          [Op.ne]: "cancelado",
        },
      },
      order: [["createdAt", "DESC"]],
    });

    const closure = await CashClosure.findOne({
      where: {
        referenceDate,
        usersId: req.user.establishment,
      },
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      data: {
        referenceDate,
        opened: Boolean(openingEntry),
        openingAmount: Number(
          openingEntry?.netAmount ?? openingEntry?.amount ?? 0,
        ),
        openingEntry,
        closed: Boolean(closure),
        closure,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar status do caixa:", error);
    return res.status(500).json({
      message: "Erro ao buscar status do caixa",
      error: error.message,
    });
  }
});

router.post("/finance/open-cash", authenticate, async (req, res) => {
  try {
    const referenceDate =
      req.body.referenceDate || new Date().toISOString().slice(0, 10);
    const amount = Number(req.body.amount || 0);

    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: "Informe um valor valido para abertura do caixa.",
      });
    }

    const startDateTime = new Date(referenceDate);
    startDateTime.setUTCHours(0, 0, 0, 0);

    const endDateTime = new Date(referenceDate);
    endDateTime.setUTCHours(23, 59, 59, 999);

    const existingOpening = await Finance.findOne({
      where: {
        usersId: req.user.establishment,
        category: "Caixa",
        subCategory: "Abertura",
        dueDate: {
          [Op.gte]: startDateTime,
          [Op.lte]: endDateTime,
        },
        status: {
          [Op.ne]: "cancelado",
        },
      },
      order: [["createdAt", "DESC"]],
    });

    let openingEntry;

    if (existingOpening) {
      openingEntry = await existingOpening.update({
        amount,
        grossAmount: amount,
        feePercentage: 0,
        feeAmount: 0,
        netAmount: amount,
        paymentMethod: "Dinheiro",
        status: "pago",
        notes: "Abertura de caixa registrada na dashboard",
      });
    } else {
      openingEntry = await Finance.create({
        type: "entrada",
        description: "Abertura de caixa",
        amount,
        grossAmount: amount,
        feePercentage: 0,
        feeAmount: 0,
        netAmount: amount,
        date: referenceDate,
        dueDate: referenceDate,
        category: "Caixa",
        subCategory: "Abertura",
        expenseType: "variavel",
        frequency: "unico",
        paymentMethod: "Dinheiro",
        status: "pago",
        notes: "Abertura de caixa registrada na dashboard",
        createdBy: req.user.id,
        usersId: req.user.establishment,
      });
    }

    return res.status(200).json({
      message: "Caixa aberto com sucesso",
      data: openingEntry,
    });
  } catch (error) {
    console.error("Erro ao abrir caixa:", error);
    return res.status(500).json({
      message: "Erro ao abrir caixa",
      error: error.message,
    });
  }
});
// Listar registros financeiros com filtros
router.get("/finance/day/:endDate", authenticate, async (req, res) => {
  try {
    const endDate = req.params.endDate;

    // Cria objetos Date para início e fim do dia
    const startDateTime = new Date(endDate);
    startDateTime.setUTCHours(0, 0, 0, 0);

    const endDateTime = new Date(endDate);
    endDateTime.setUTCHours(23, 59, 59, 999);
    const finances = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        dueDate: {
          [Op.gte]: startDateTime,
          [Op.lte]: endDateTime,
        },
      },
      order: [["dueDate", "DESC"]],
    });
    const currentFinances = await keepOnlyCurrentAgendaFinanceRows(
      finances,
      req.user.establishment,
    );

    // Buscar todas as finanças fixas do mês
    const startOfMonth = new Date(endDate);
    startOfMonth.setDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const endOfMonth = new Date(endDate);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setUTCHours(23, 59, 59, 999);

    const fixedFinances = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        expenseType: "fixo",
        status: "pendente",
        type: "saida",
        dueDate: {
          [Op.gte]: startOfMonth,
          [Op.lte]: endOfMonth,
        },
      },
    });

    // Calcular o total das finanças fixas
    const totalFixo = fixedFinances.reduce((sum, finance) => {
      return sum + Number(finance.amount);
    }, 0);

    res.json({
      financesFixo: totalFixo,
      fixo: fixedFinances,
      message: "Registros financeiros encontrados com sucesso",
      data: currentFinances,
    });
  } catch (error) {
    console.error("Erro ao buscar registros financeiros:", error);
    res.status(500).json({
      message: "Erro ao buscar registros financeiros",
      error: error.message,
    });
  }
});

router.get("/finance/list", authenticate, async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      type,
      status,
      expenseType,
      category,
      subCategory,
    } = req.query;

    const where = {
      usersId: req.user.establishment,
    };

    if (type) where.type = type;
    if (status) {
      where.status = status;
    } else {
      where.status = {
        [Op.ne]: "cancelado",
      };
    }
    if (expenseType) where.expenseType = expenseType;
    if (category) where.category = category;
    if (subCategory) where.subCategory = subCategory;

    const parsedStartDate = parseDateParam(startDate, false);
    const parsedEndDate = parseDateParam(endDate, true);
    const dateRange = {};
    if (parsedStartDate) dateRange[Op.gte] = parsedStartDate;
    if (parsedEndDate) dateRange[Op.lte] = parsedEndDate;
    if (Object.keys(dateRange).length) {
      where[Op.or] = [
        { date: dateRange },
        { dueDate: dateRange },
      ];
    }

    const finances = await Finance.findAll({
      where,
      order: [["dueDate", "DESC"], ["date", "DESC"], ["updatedAt", "DESC"], ["createdAt", "DESC"]],
    });
    const currentFinances = await keepOnlyCurrentAgendaFinanceRows(
      finances,
      req.user.establishment,
    );

    res.json({
      message: "Registros financeiros encontrados com sucesso",
      data: currentFinances,
    });
  } catch (error) {
    console.error("Erro ao listar registros financeiros:", error);
    res.status(500).json({
      message: "Erro ao listar registros financeiros",
      error: error.message,
    });
  }
});

// Atualizar registro financeiro
router.put("/finance/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const finance = await Finance.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro não encontrado",
      });
    }

    const updatePayload = { ...req.body };

    if (Object.prototype.hasOwnProperty.call(updatePayload, "date")) {
      if (updatePayload.date) {
        updatePayload.date = normalizeFinanceDateInput(updatePayload.date);
        if (!updatePayload.date) {
          return res.status(400).json({
            message: "Data do lancamento invalida",
            error: "Informe a data no formato dia-mes-ano ou ano-mes-dia.",
          });
        }
      } else {
        updatePayload.date = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updatePayload, "dueDate")) {
      if (updatePayload.dueDate) {
        updatePayload.dueDate = normalizeFinanceDateInput(updatePayload.dueDate);
        if (!updatePayload.dueDate) {
          return res.status(400).json({
            message: "Data de vencimento invalida",
            error: "Informe o vencimento no formato dia-mes-ano ou ano-mes-dia.",
          });
        }
      } else {
        updatePayload.dueDate = null;
      }
    }

    const updatedFinance = await finance.update(updatePayload);

    res.json({
      message: "Registro financeiro atualizado com sucesso",
      data: updatedFinance,
    });
  } catch (error) {
    console.error("Erro ao atualizar registro financeiro:", error);
    res.status(500).json({
      message: "Erro ao atualizar registro financeiro",
      error: error.message,
    });
  }
});

// Excluir registro financeiro
router.delete("/finance/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const finance = await Finance.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro não encontrado",
      });
    }

    await finance.destroy();

    res.json({
      message: "Registro financeiro excluído com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir registro financeiro:", error);
    res.status(500).json({
      message: "Erro ao excluir registro financeiro",
      error: error.message,
    });
  }
});

// Buscar contas a pagar/receber
router.get("/finance/pending", authenticate, async (req, res) => {
  try {
    const { type, dueStartDate, dueEndDate } = req.query;

    const where = {
      usersId: req.user.establishment,
      status: "pendente",
    };

    if (type) where.type = type;
    if (dueStartDate || dueEndDate) {
      where.dueDate = {};
      if (dueStartDate) where.dueDate[Op.gte] = new Date(dueStartDate);
      if (dueEndDate) where.dueDate[Op.lte] = new Date(dueEndDate);
    }

    const pendingFinances = await Finance.findAll({
      where,
      order: [["dueDate", "ASC"]],
    });
    const currentPendingFinances = await keepOnlyCurrentAgendaFinanceRows(
      pendingFinances,
      req.user.establishment,
    );

    res.json({
      message: "Contas pendentes encontradas com sucesso",
      data: currentPendingFinances,
    });
  } catch (error) {
    console.error("Erro ao buscar contas pendentes:", error);
    res.status(500).json({
      message: "Erro ao buscar contas pendentes",
      error: error.message,
    });
  }
});

// Atualizar status do registro financeiro
router.patch("/finance/:id/status", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentMethod } = req.body;

    const finance = await Finance.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro não encontrado",
      });
    }
    const updatedFinance = await finance.update({
      status,
      paymentMethod: paymentMethod || "Pendente",
    });

    res.json({
      message: "Status atualizado com sucesso",
      data: updatedFinance,
    });
  } catch (error) {
    console.error("Erro ao atualizar status:", error);
    res.status(500).json({
      message: "Erro ao atualizar status",
      error: error.message,
    });
  }
});

// Buscar resumo financeiro por período
router.get("/finance/summary", authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {
      usersId: req.user.establishment,
      status: {
        [Op.ne]: "cancelado",
      },
    };

    if (startDate || endDate) {
      const parsedStartDate = parseDateParam(startDate, false);
      const parsedEndDate = parseDateParam(endDate, true);
      const dateRange = {};
      if (parsedStartDate) dateRange[Op.gte] = parsedStartDate;
      if (parsedEndDate) dateRange[Op.lte] = parsedEndDate;
      if (Object.keys(dateRange).length) {
        where[Op.or] = [
          { date: dateRange },
          { dueDate: dateRange },
        ];
      }
    }

    const finances = await Finance.findAll({ where });
    const currentFinances = await keepOnlyCurrentAgendaFinanceRows(
      finances,
      req.user.establishment,
    );

    const summary = {
      entradas: {
        total: 0,
        count: 0,
      },
      taxas: {
        total: 0,
      },
      commissions: {
        total: 0,
      },
      saidas: {
        total: 0,
        count: 0,
        fixas: 0,
        variaveis: 0,
      },
      saldo: 0,
    };

    currentFinances.forEach((finance) => {
      const amount = parseFloat(finance.amount) || 0;
      const feeAmount = parseFloat(finance.feeAmount) || 0;

      if (finance.type === "entrada") {
        summary.entradas.total += amount;
        summary.entradas.count++;
        summary.taxas.total += feeAmount;
      } else {
        summary.saidas.total += amount;
        summary.saidas.count++;
        if (finance.expenseType === "fixo") {
          summary.saidas.fixas += amount;
        } else {
          summary.saidas.variaveis += amount;
        }
      }

      if (String(finance.category || "").toLowerCase().includes("comiss")) {
        summary.commissions.total += amount;
      }
    });

    summary.saldo = summary.entradas.total - summary.saidas.total;
    summary.totalSales = summary.entradas.total;

    res.json({
      message: "Resumo financeiro calculado com sucesso",
      data: summary,
    });
  } catch (error) {
    console.error("Erro ao calcular resumo financeiro:", error);
    res.status(500).json({
      message: "Erro ao calcular resumo financeiro",
      error: error.message,
    });
  }
});

// Rota para obter estatísticas mensais
router.get("/monthly-stats/:year/:month", authenticate, async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // Validar parâmetros
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({
        message: "Ano ou mês inválido",
      });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const usersId = req.user.establishment;

    // Buscar agendamentos do mês
    const appointments = await Appointment.findAll({
      where: {
        usersId,
        date: {
          [Op.between]: [startDate, endDate],
        },
        status: "Finalizado",
      },
      include: [
        {
          model: Services,
          attributes: ["id", "price", "category"],
        },
      ],
    });

    // Buscar vendas do mês
    const sales = await Sales.findAll({
      where: {
        usersId,
        createdAt: {
          [Op.between]: [startDate, endDate],
        },
        status: "Pago",
      },
    });

    // Inicializar contadores
    const stats = {
      patients: {
        count: 0, // Total de atendimentos
        uniqueCount: new Set(), // Pacientes únicos
        value: 0,
      },
      clinicalAppointments: {
        count: 0,
        value: 0,
      },
      aestheticAppointments: {
        count: 0,
        value: 0,
      },
      hospitalizationAppointments: {
        count: 0,
        value: 0,
      },
      products: {
        count: 0,
        value: 0,
      },
      serviceCategories: {},
    };

    // Processar agendamentos
    appointments.forEach((appointment) => {
      // Adicionar paciente ao Set de únicos
      if (appointment.customerId) {
        stats.patients.uniqueCount.add(appointment.customerId);
      }

      const value = appointment.Service
        ? parseFloat(appointment.Service.price) || 0
        : 0;
      const groupedCategoryTotals = {};
      const appointmentRevenue = 0;
      const normalizedCategory = "";

      // Classificar por tipo de serviço
      if (false && appointment.Service && appointment.Service.category) {
        const category = appointment.Service.category.toLowerCase();
        if (category.includes("Clínica") || category.includes("clínica")) {
          stats.clinicalAppointments.count++;
          stats.clinicalAppointments.value += value;
        } else if (
          category.includes("Estética") ||
          category.includes("estética")
        ) {
          stats.aestheticAppointments.count++;
          stats.aestheticAppointments.value += value;
        }
      }
      if (groupedCategoryTotals.Estetica > 0) {
        stats.aestheticAppointments.count += 1;
        stats.aestheticAppointments.value += Number(groupedCategoryTotals.Estetica || 0);
      }
      if (groupedCategoryTotals.Clinica > 0 || groupedCategoryTotals.Cirurgias > 0) {
        stats.clinicalAppointments.count += 1;
        stats.clinicalAppointments.value +=
          Number(groupedCategoryTotals.Clinica || 0) +
          Number(groupedCategoryTotals.Cirurgias || 0);
      }
      if (groupedCategoryTotals.Internacao > 0) {
        stats.hospitalizationAppointments.count += 1;
        stats.hospitalizationAppointments.value += Number(groupedCategoryTotals.Internacao || 0);
      }
      if (!Object.keys(groupedCategoryTotals).length && appointmentRevenue > 0) {
        if (!stats.serviceCategories[normalizedCategory]) {
          stats.serviceCategories[normalizedCategory] = {
            label: normalizedCategory,
            count: 0,
            value: 0,
          };
        }
        stats.serviceCategories[normalizedCategory].count += 1;
        stats.serviceCategories[normalizedCategory].value += appointmentRevenue;
      }
      if (groupedCategoryTotals.Estetica > 0) {
        stats.aestheticAppointments.count += 1;
        stats.aestheticAppointments.value += Number(groupedCategoryTotals.Estetica || 0);
      }
      if (groupedCategoryTotals.Clinica > 0 || groupedCategoryTotals.Cirurgias > 0) {
        stats.clinicalAppointments.count += 1;
        stats.clinicalAppointments.value +=
          Number(groupedCategoryTotals.Clinica || 0) +
          Number(groupedCategoryTotals.Cirurgias || 0);
      }
      if (groupedCategoryTotals.Internacao > 0) {
        stats.hospitalizationAppointments.count += 1;
        stats.hospitalizationAppointments.value += Number(groupedCategoryTotals.Internacao || 0);
      }
      if (!Object.keys(groupedCategoryTotals).length && appointmentRevenue > 0) {
        if (!stats.serviceCategories[normalizedCategory]) {
          stats.serviceCategories[normalizedCategory] = {
            label: normalizedCategory,
            count: 0,
            value: 0,
          };
        }
        stats.serviceCategories[normalizedCategory].count += 1;
        stats.serviceCategories[normalizedCategory].value += appointmentRevenue;
      }
    });

    // Processar vendas de produtos
    sales.forEach((sale) => {
      const saleTotal = parseFloat(sale.total) || 0;
      const quantity = parseInt(sale.quantity) || 1; // Se não tiver quantidade, assume 1

      stats.products.value += saleTotal;
      stats.products.count += quantity;
    });

    // Calcular totais
    stats.patients.count =
      stats.clinicalAppointments.count + stats.aestheticAppointments.count; // Total de atendimentos
    const uniquePatients = stats.patients.uniqueCount.size; // Quantidade de pacientes únicos
    delete stats.patients.uniqueCount; // Remove o Set do resultado
    stats.patients.value =
      stats.clinicalAppointments.value + stats.aestheticAppointments.value;

    res.json({
      message: "Estatísticas mensais encontradas com sucesso",
      data: stats,
    });
  } catch (error) {
    console.error("Erro ao buscar estatísticas mensais:", error);
    res.status(500).json({
      message: "Erro ao buscar estatísticas mensais",
      error: error.message,
    });
  }
});

// Rota para obter dados financeiros
router.get("/financial-data/:date", authenticate, async (req, res) => {
  try {
    const [month, year] = req.params.date.split("-");
    if (!month || !year || month.length !== 2 || year.length !== 4) {
      return res.status(400).json({
        message: "Data inválida",
        error: "Formato esperado: MM-YYYY",
      });
    }

    // Configura todas as datas necessárias
    const today = new Date();
    const startOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      0,
      0,
      0
    );
    const endOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23,
      59,
      59
    );

    // Início e fim da semana
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    // Início e fim do mês
    const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);

    // Buscar vendas (hoje, semana, mês)
    const [salesToday, salesWeek, salesMonth] = await Promise.all([
      Sales.findAll({
        where: {
          usersId: req.user.establishment,
          createdAt: { [Op.between]: [startOfToday, endOfToday] },
        },
        attributes: [
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
          [sequelize.fn("SUM", sequelize.col("total")), "total"],
        ],
        raw: true,
      }),
      Sales.findAll({
        where: {
          usersId: req.user.establishment,
          createdAt: { [Op.between]: [startOfWeek, endOfWeek] },
        },
        attributes: [
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
          [sequelize.fn("SUM", sequelize.col("total")), "total"],
        ],
        raw: true,
      }),
      Sales.findAll({
        where: {
          usersId: req.user.establishment,
          createdAt: { [Op.between]: [startOfMonth, endOfMonth] },
        },
        attributes: [
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
          [sequelize.fn("SUM", sequelize.col("total")), "total"],
        ],
        raw: true,
      }),
    ]);

    // Buscar agendamentos (hoje, semana, mês)
    const [appointmentsToday, appointmentsWeek, appointmentsMonth] =
      await Promise.all([
        Appointment.findAll({
          where: {
            usersId: req.user.establishment,
            date: today.toISOString().split("T")[0],
          },
          attributes: ["id", "serviceId"],
          raw: true,
        }),
        Appointment.findAll({
          where: {
            usersId: req.user.establishment,
            date: {
              [Op.between]: [
                startOfWeek.toISOString().split("T")[0],
                endOfWeek.toISOString().split("T")[0],
              ],
            },
          },
          attributes: ["id", "serviceId"],
          raw: true,
        }),
        Appointment.findAll({
          where: {
            usersId: req.user.establishment,
            date: {
              [Op.between]: [
                startOfMonth.toISOString().split("T")[0],
                endOfMonth.toISOString().split("T")[0],
              ],
            },
          },
          attributes: ["id", "serviceId"],
          raw: true,
        }),
      ]);

    // Buscar todos os serviços necessários de uma vez
    const allServiceIds = [
      ...appointmentsToday,
      ...appointmentsWeek,
      ...appointmentsMonth,
    ]
      .map((app) => app.serviceId)
      .filter((id, index, self) => self.indexOf(id) === index); // Remove duplicados

    const services = await Services.findAll({
      where: {
        id: { [Op.in]: allServiceIds },
      },
      attributes: ["id", "price"],
      raw: true,
    });

    // Criar mapa de preços
    const servicePrices = services.reduce((acc, service) => {
      acc[service.id] = parseFloat(service.price) || 0;
      return acc;
    }, {});

    // Função para calcular total dos agendamentos
    const calculateAppointmentsTotal = (appointments) => {
      return appointments.reduce(
        (total, app) => total + (servicePrices[app.serviceId] || 0),
        0
      );
    };

    const formatData = (salesData, appointmentsCount, appointmentsTotal) => ({
      sales: {
        count: Number(salesData[0]?.count || 0),
        total: Number(salesData[0]?.total || 0),
      },
      appointments: {
        count: appointmentsCount,
        total: appointmentsTotal,
      },
    });

    res.json({
      message: "Dados financeiros encontrados com sucesso",
      data: {
        today: formatData(
          salesToday,
          appointmentsToday.length,
          calculateAppointmentsTotal(appointmentsToday)
        ),
        week: formatData(
          salesWeek,
          appointmentsWeek.length,
          calculateAppointmentsTotal(appointmentsWeek)
        ),
        month: formatData(
          salesMonth,
          appointmentsMonth.length,
          calculateAppointmentsTotal(appointmentsMonth)
        ),
      },
    });
  } catch (error) {
    console.error("Erro ao buscar dados financeiros:", error);
    res.status(500).json({
      message: "Erro ao buscar dados financeiros",
      error: error.message,
    });
  }
});

router.get("/monthly-stats-detailed/:year/:month", authenticate, async (req, res) => {
  try {
    const normalizeServiceCategoryLabel = (rawCategory = "", rawServiceName = "") => {
      const category = String(rawCategory || "").trim();
      const serviceName = String(rawServiceName || "").trim();
      const source = `${category} ${serviceName}`.toLowerCase();

      if (source.includes("cirurg")) return "Cirurgias";
      if (source.includes("consult") || source.includes("clinica") || source.includes("clínica")) return "Consultas";
      if (source.includes("estet") || source.includes("estét") || source.includes("banho") || source.includes("tosa")) return "Estética";
      if (category) return category;
      if (serviceName) return serviceName;
      return "Outros";
    };

    const year = parseInt(req.params.year, 10);
    const month = parseInt(req.params.month, 10);
    const seller = String(req.query.seller || "").trim();

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({
        message: "Ano ou mês inválido",
      });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const usersId = req.user.establishment;

    const allAppointments = await Appointment.findAll({
      where: {
        usersId,
        date: {
          [Op.between]: [startDate, endDate],
        },
        status: {
          [Op.notIn]: ["cancelado", "Cancelado"],
        },
      },
      include: [
        {
          model: Services,
          attributes: ["id", "name", "price", "category"],
        },
        {
          model: Users,
          as: "responsible",
          attributes: ["id", "name"],
          required: false,
        },
      ],
    });

    const hydratedAppointments = await hydrateAppointmentsWithFinancialDetails(
      allAppointments,
      usersId,
    );

    const allSales = await Sales.findAll({
      where: {
        usersId,
        createdAt: {
          [Op.between]: [startDate, endDate],
        },
        status: "pago",
      },
    });

    const sellerIds = Array.from(
      new Set(
        [
          ...hydratedAppointments.map((appointment) => String(appointment.responsibleId || "").trim()),
          ...allSales.map((sale) => String(sale.responsible || "").trim()),
        ].filter(Boolean),
      ),
    );

    const sellerUsers = sellerIds.length
      ? await Users.findAll({
          where: {
            id: {
              [Op.in]: sellerIds,
            },
          },
          attributes: ["id", "name"],
        })
      : [];

    const sellerNameById = sellerUsers.reduce((acc, user) => {
      acc[String(user.id)] = user.name;
      return acc;
    }, {});

    const sellerStatsMap = {};

    const ensureSellerStats = (sellerId, fallbackName = "") => {
      const normalizedId = String(sellerId || "").trim();
      if (!normalizedId) return null;

      if (!sellerStatsMap[normalizedId]) {
        sellerStatsMap[normalizedId] = {
          id: normalizedId,
          name: sellerNameById[normalizedId] || fallbackName || "Sem nome",
          appointmentsCount: 0,
          salesCount: 0,
          aestheticValue: 0,
          clinicalValue: 0,
          salesValue: 0,
          totalValue: 0,
        };
      }

      return sellerStatsMap[normalizedId];
    };

    hydratedAppointments.forEach((appointment) => {
      const sellerStats = ensureSellerStats(
        appointment.responsibleId,
        appointment.responsible?.name || appointment.sellerName || "",
      );
      if (!sellerStats) return;

      if (!isPrimaryPackageOccurrence(appointment)) {
        return;
      }

      const serviceEntries = getViaCentralServiceEntries(appointment);
      const appointmentRevenue =
        serviceEntries.reduce((sum, item) => sum + (Number(item.amount || 0) || 0), 0) ||
        Number(appointment?.summary?.total || 0) ||
        Number(appointment?.Service?.price || 0) ||
        0;
      const groupedCategoryTotals = serviceEntries.reduce((acc, item) => {
        const categoryLabel = normalizeViaCentralCategoryLabel(
          item?.category,
          item?.label,
          appointment?.type,
        );
        acc[categoryLabel] = (acc[categoryLabel] || 0) + (Number(item.amount || 0) || 0);
        return acc;
      }, {});

      sellerStats.appointmentsCount += 1;
      sellerStats.totalValue += appointmentRevenue;
      sellerStats.aestheticValue += Number(groupedCategoryTotals.Estetica || 0);
      sellerStats.clinicalValue +=
        Number(groupedCategoryTotals.Clinica || 0) +
        Number(groupedCategoryTotals.Cirurgias || 0) +
        Number(groupedCategoryTotals.Internacao || 0);
      const value = appointmentRevenue;

      if (false && appointment.Service && appointment.Service.category) {
        const category = String(appointment.Service.category || "").toLowerCase();
        if (category.includes("clínica") || category.includes("clinica")) {
          sellerStats.clinicalValue += value;
        } else if (category.includes("estética") || category.includes("estetica")) {
          sellerStats.aestheticValue += value;
        }
      }
    });

    allSales.forEach((sale) => {
      const sellerStats = ensureSellerStats(sale.responsible);
      if (!sellerStats) return;

      const saleTotal = parseFloat(sale.total) || 0;
      sellerStats.salesCount += 1;
      sellerStats.salesValue += saleTotal;
      sellerStats.totalValue += saleTotal;
    });

    const appointments =
      seller && seller !== "all"
        ? hydratedAppointments.filter((appointment) => String(appointment.responsibleId || "") === seller)
        : hydratedAppointments;
    const sales =
      seller && seller !== "all"
        ? allSales.filter((sale) => String(sale.responsible || "") === seller)
        : allSales;

    const stats = {
      patients: {
        count: 0,
        uniqueCount: new Set(),
        value: 0,
      },
      clinicalAppointments: {
        count: 0,
        value: 0,
      },
      aestheticAppointments: {
        count: 0,
        value: 0,
      },
      hospitalizationAppointments: {
        count: 0,
        value: 0,
      },
      products: {
        count: 0,
        value: 0,
      },
      serviceCategories: {},
      sellers: Object.values(sellerStatsMap).sort((left, right) => left.name.localeCompare(right.name)),
    };

    appointments.forEach((appointment) => {
      if (appointment.customerId) {
        stats.patients.uniqueCount.add(appointment.customerId);
      }

      if (!isPrimaryPackageOccurrence(appointment)) {
        return;
      }

      const serviceEntries = getViaCentralServiceEntries(appointment);
      const appointmentRevenue =
        serviceEntries.reduce((sum, item) => sum + (Number(item.amount || 0) || 0), 0) ||
        Number(appointment?.summary?.total || 0) ||
        Number(appointment?.Service?.price || 0) ||
        0;
      const groupedCategoryTotals = serviceEntries.reduce((acc, item) => {
        const normalizedCategory = normalizeViaCentralCategoryLabel(
          item?.category,
          item?.label,
          appointment?.type,
        );
        const count = Number(item?.count || 0) || 0;
        const value = Number(item?.amount || 0) || 0;

        if (!stats.serviceCategories[normalizedCategory]) {
          stats.serviceCategories[normalizedCategory] = {
            label: normalizedCategory,
            count: 0,
            value: 0,
          };
        }

        stats.serviceCategories[normalizedCategory].count += count;
        stats.serviceCategories[normalizedCategory].value += value;
        acc[normalizedCategory] = (acc[normalizedCategory] || 0) + value;
        return acc;
      }, {});
      const normalizedCategory = normalizeViaCentralCategoryLabel(
        appointment?.Service?.category,
        appointment?.Service?.name,
        appointment?.type,
      );
      const value = appointmentRevenue;

      if (false && !stats.serviceCategories[normalizedCategory]) {
        stats.serviceCategories[normalizedCategory] = {
          label: normalizedCategory,
          count: 0,
          value: 0,
        };
      }
      if (false) stats.serviceCategories[normalizedCategory].count += 1;
      if (false) stats.serviceCategories[normalizedCategory].value += value;
      if (groupedCategoryTotals.Estetica > 0) {
        stats.aestheticAppointments.count += 1;
        stats.aestheticAppointments.value += Number(groupedCategoryTotals.Estetica || 0);
      }
      if (groupedCategoryTotals.Clinica > 0 || groupedCategoryTotals.Cirurgias > 0) {
        stats.clinicalAppointments.count += 1;
        stats.clinicalAppointments.value +=
          Number(groupedCategoryTotals.Clinica || 0) +
          Number(groupedCategoryTotals.Cirurgias || 0);
      }
      if (groupedCategoryTotals.Internacao > 0) {
        stats.hospitalizationAppointments.count += 1;
        stats.hospitalizationAppointments.value += Number(groupedCategoryTotals.Internacao || 0);
      }
      if (!Object.keys(groupedCategoryTotals).length && appointmentRevenue > 0) {
        if (!stats.serviceCategories[normalizedCategory]) {
          stats.serviceCategories[normalizedCategory] = {
            label: normalizedCategory,
            count: 0,
            value: 0,
          };
        }
        stats.serviceCategories[normalizedCategory].count += 1;
        stats.serviceCategories[normalizedCategory].value += appointmentRevenue;
      }

      if (false && appointment.Service && appointment.Service.category) {
        const category = String(appointment.Service.category || "").toLowerCase();
        if (category.includes("clínica") || category.includes("clinica")) {
          stats.clinicalAppointments.count++;
          stats.clinicalAppointments.value += value;
        } else if (category.includes("estética") || category.includes("estetica")) {
          stats.aestheticAppointments.count++;
          stats.aestheticAppointments.value += value;
        }
      }
    });

    sales.forEach((sale) => {
      const saleTotal = parseFloat(sale.total) || 0;
      const quantity = parseInt(sale.quantity) || 1;
      stats.products.value += saleTotal;
      stats.products.count += quantity;
    });

    stats.patients.count =
      stats.clinicalAppointments.count +
      stats.aestheticAppointments.count +
      stats.hospitalizationAppointments.count;
    delete stats.patients.uniqueCount;
    stats.patients.value =
      stats.clinicalAppointments.value +
      stats.aestheticAppointments.value +
      stats.hospitalizationAppointments.value;
    stats.serviceCategories = Object.values(stats.serviceCategories).sort((left, right) => right.value - left.value);

    res.json({
      message: "Estatísticas mensais detalhadas encontradas com sucesso",
      data: stats,
    });
  } catch (error) {
    console.error("Erro ao buscar estatísticas mensais detalhadas:", error);
    res.status(500).json({
      message: "Erro ao buscar estatísticas mensais detalhadas",
      error: error.message,
    });
  }
});

// Rota para obter resumo financeiro do dia
router.get("/summary/:date", authenticate, async (req, res) => {
  try {
    const { date } = req.params;

    const appointments = await Appointment.findAll({
      where: {
        usersId: req.user.establishment,
        date: date,
      },
    });
    const finances = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        type: "saida",
        status: "pendente",
        dueDate: {
          [Op.between]: [
            new Date(date + "T00:00:00.000Z"),
            new Date(date + "T23:59:59.999Z"),
          ],
        },
      },
    });

    const faturamentoHoje = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        type: "entrada",
        status: "Pago",
        dueDate: {
          [Op.between]: [
            new Date(date + "T00:00:00.000Z"),
            new Date(date + "T23:59:59.999Z"),
          ],
        },
      },
    });

    res.status(200).json({
      message: "Resumo financeiro encontrado com sucesso",
      data: {
        faturamentoHoje: faturamentoHoje
          .reduce((sum, finance) => sum + parseFloat(finance.amount), 0)
          .toFixed(2),
        agendamentoHoje: appointments.length,
        despesasHoje: finances
          .reduce((sum, finance) => sum + parseFloat(finance.amount), 0)
          .toFixed(2),
      },
    });
  } catch (error) {
    console.error("Erro ao buscar resumo financeiro:", error);
    return res.status(500).json({
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

// Endpoint para calcular valores financeiros de um agendamento/pacote
router.get(
  "/finance/calculate/:appointmentId",
  authenticate,
  async (req, res) => {
    try {
      const { appointmentId } = req.params;

      // Buscar o agendamento principal com as relações básicas
      const appointment = await Appointment.findByPk(appointmentId, {
        include: [
          {
            model: Services,
            as: "Service",
            attributes: ["id", "name", "price"],
          },
          {
            model: Finance,
            as: "finance",
            attributes: ["id", "status", "amount"],
          },
        ],
      });

      if (!appointment) {
        return res.status(404).json({
          error: "Agendamento não encontrado",
        });
      }

      // Calcular valor base do serviço principal
      const servicePrice = parseFloat(appointment.Service?.price || 0);

      // Para pegar serviços secundários e terciários, vamos buscar pelos IDs diretamente
      let secondaryService = null;
      let tertiaryService = null;

      if (appointment.secondaryServiceId) {
        secondaryService = await Services.findByPk(
          appointment.secondaryServiceId,
          {
            attributes: ["id", "name", "price"],
          }
        );
      }

      if (appointment.tertiaryServiceId) {
        tertiaryService = await Services.findByPk(
          appointment.tertiaryServiceId,
          {
            attributes: ["id", "name", "price"],
          }
        );
      }

      const secondaryServicePrice = parseFloat(secondaryService?.price || 0);
      const tertiaryServicePrice = parseFloat(tertiaryService?.price || 0);

      const totalServicePrice =
        servicePrice + secondaryServicePrice + tertiaryServicePrice;

      let result = {
        totalContracted: 0,
        totalPaid: 0,
        totalRemaining: 0,
        isPackage: false,
        packageInfo: null,
      };

      // Verificar se é um pacote
      if (appointment.package && appointment.packageMax) {
        result.isPackage = true;
        const totalSessions = appointment.packageMax;
        result.totalContracted = totalServicePrice * totalSessions;

        // Buscar todos os agendamentos do mesmo pacote
        const packageAppointments = await Appointment.findAll({
          where: {
            petId: appointment.petId,
            customerId: appointment.customerId,
            package: appointment.package,
            packageMax: appointment.packageMax,
            usersId: req.user.establishment,
          },
          include: [
            {
              model: Finance,
              as: "finance",
              attributes: ["id", "status", "amount"],
            },
          ],
          order: [["packageNumber", "ASC"]],
        });

        // Contar sessões pagas
        const paidSessions = packageAppointments.filter(
          (apt) => apt.finance?.status?.toLowerCase() === "pago"
        ).length;

        result.totalPaid = paidSessions * totalServicePrice;
        result.totalRemaining = Math.max(
          0,
          result.totalContracted - result.totalPaid
        );

        result.packageInfo = {
          sessionsCompleted: appointment.packageNumber || 0,
          totalSessions: totalSessions,
          paidSessions: paidSessions,
          sessionPrice: totalServicePrice,
        };
      } else {
        // Agendamento individual
        result.totalContracted = totalServicePrice;

        if (appointment.finance?.status?.toLowerCase() === "pago") {
          result.totalPaid = totalServicePrice;
        } else {
          result.totalPaid = 0;
        }

        result.totalRemaining = Math.max(
          0,
          result.totalContracted - result.totalPaid
        );
      }

      res.json(result);
    } catch (error) {
      console.error("Erro ao calcular valores financeiros:", error);
      res.status(500).json({
        error: "Erro interno do servidor",
        details: error.message,
      });
    }
  }
);

// Endpoint para pagar UMA sessao do pacote (POST /finance/pay-package)
// Comportamento correto:
//   - Apenas a sessao indicada (appointmentId) fica como "pago"
//   - As demais sessoes do mesmo pacote recebem o valor mas continuam "pendente"
//   - Nao duplica registros financeiros
//   - Nao sobrescreve sessoes que ja estao pagas
router.post("/finance/pay-package", authenticate, async (req, res) => {
  try {
    const { appointmentId, paymentMethod, paymentStatus = "pago" } = req.body;

    // Buscar o agendamento alvo
    const appointment = await Appointment.findByPk(appointmentId, {
      include: [
        {
          model: Services,
          as: "Service",
          attributes: ["id", "name", "price"],
        },
        {
          model: Finance,
          as: "finance",
          attributes: ["id", "status", "amount"],
        },
      ],
    });

    if (!appointment) {
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }

    if (!appointment.package || !appointment.packageMax) {
      return res
        .status(400)
        .json({ error: "Este agendamento não é um pacote" });
    }

    // Calcular valor por sessao
    let valorServicos = parseFloat(appointment.Service?.price || 0);

    if (appointment.secondaryServiceId) {
      const secondaryService = await Services.findByPk(appointment.secondaryServiceId);
      valorServicos += parseFloat(secondaryService?.price || 0);
    }

    if (appointment.tertiaryServiceId) {
      const tertiaryService = await Services.findByPk(appointment.tertiaryServiceId);
      valorServicos += parseFloat(tertiaryService?.price || 0);
    }

    const totalPackageValue = valorServicos * appointment.packageMax;

    // Buscar todas as sessoes do mesmo pacote:
    //   prioridade 1 → packageGroupId (UUID persistido no banco)
    //   fallback     → petId + customerId + packageMax (legado)
    const packageWhere = appointment.packageGroupId
      ? { packageGroupId: appointment.packageGroupId, usersId: req.user.establishment }
      : {
          petId: appointment.petId,
          customerId: appointment.customerId,
          package: true,
          packageMax: appointment.packageMax,
          usersId: req.user.establishment,
        };

    const packageAppointments = await Appointment.findAll({
      where: packageWhere,
      include: [
        {
          model: Finance,
          as: "finance",
          attributes: ["id", "status", "amount", "paymentMethod"],
        },
      ],
    });

    // Atualizar registros financeiros:
    //   - sessao alvo  → status = paymentStatus (pago)
    //   - demais sessoes NAO pagas → status = "pendente" com valor atualizado
    //   - sessoes ja pagas (exceto alvo) → NAO alteradas
    const updatePromises = packageAppointments.map(async (apt) => {
      const isTarget = String(apt.id) === String(appointmentId);
      const aptFinanceStatus = String(apt.finance?.status || "").toLowerCase();

      if (!isTarget && aptFinanceStatus === "pago") {
        return; // sessao ja paga, nao mexer
      }

      const sessionStatus = isTarget ? paymentStatus : "pendente";
      const sessionPaymentMethod = isTarget ? paymentMethod : (apt.finance?.paymentMethod || "Pendente");

      if (apt.finance) {
        await Finance.update(
          {
            status: sessionStatus,
            paymentMethod: sessionPaymentMethod,
            amount: valorServicos,
            updatedAt: new Date(),
          },
          { where: { id: apt.finance.id } }
        );
      } else {
        const newFinance = await Finance.create({
          type: "entrada",
          description: `Pacote - Sessão ${apt.packageNumber || "?"}/${apt.packageMax}`,
          status: sessionStatus,
          paymentMethod: sessionPaymentMethod,
          amount: valorServicos,
          grossAmount: valorServicos,
          netAmount: valorServicos,
          date: new Date(apt.date || new Date()),
          dueDate: new Date(apt.date || new Date()),
          category: "Agendamentos",
          subCategory: apt.type || "Agenda",
          expenseType: "variavel",
          frequency: "unico",
          reference: `appointment_balance:${apt.id}`,
          usersId: req.user.establishment,
        });
        await apt.update({ financeId: newFinance.id });
      }
    });

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: `Sessão paga com sucesso. Demais sessões do pacote mantidas como pendente.`,
      data: {
        packageGroupId: appointment.packageGroupId || null,
        totalSessions: packageAppointments.length,
        totalAmount: totalPackageValue,
        sessionAmount: valorServicos,
        paymentMethod,
        paidAppointmentId: appointmentId,
      },
    });
  } catch (error) {
    console.error("Erro ao pagar sessão do pacote:", error);
    res.status(500).json({
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

export default router;
