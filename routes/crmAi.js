import express from "express";
import { v4 as uuidv4 } from "uuid";
import auth from "../middlewares/auth.js";
import owner from "../middlewares/owner.js";
import Users from "../models/Users.js";
import Settings from "../models/Settings.js";
import Appointment from "../models/Appointment.js";
import Custumers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import Services from "../models/Services.js";
import Finance from "../models/Finance.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import CrmAiActionLog from "../models/CrmAiActionLog.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";
import sequelize from "../database/config.js";
import { createSubscriptionPreference, processWebhookEvent, validateWebhookSignature } from "../service/mercadopago.js";

const router = express.Router();
const CRM_AI_PRICE = Number(process.env.CRM_AI_PRICE || 49.9);
const VALID_WEEK_DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const VALID_AGENDA_TYPES = ["estetica", "clinica", "internacao"];

const DEFAULT_CONTROL = {
  enabled: false,
  autoReplyEnabled: false,
  autoExecuteEnabled: false,
  assistantName: "ViaPet IA",
  provider: "OpenAI",
  instructions:
    "Responder com educacao, confirmar dados importantes antes de agir e encaminhar para humano em caso de risco, reclamacao ou duvida sensivel.",
  escalationKeywords: ["urgente", "reclamacao", "cancelar", "dor", "emergencia"],
  capabilities: {
    replyToMessages: true,
    createCustomer: false,
    createPet: false,
    createAppointment: false,
    updateAppointment: false,
    cancelAppointment: false,
    viewFinancial: false,
  },
  scheduling: {
    requireHumanApproval: true,
    requireTutorConfirmation: true,
    allowNewCustomer: false,
    allowNewPet: false,
    allowOffGridTimes: true,
    minimumLeadMinutes: 30,
    slotMinutes: 10,
    maxDailyAppointments: 12,
    allowedAgendaTypes: ["estetica"],
    allowedServiceCategories: ["Banho", "Tosa", "Estetica"],
    allowedDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
    allowedTimeStart: "08:00",
    allowedTimeEnd: "18:00",
    notes:
      "A IA so deve agendar quando houver servico permitido, horario dentro da janela definida e confirmacao do tutor.",
  },
};

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizeStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [...fallback];
}

function normalizeWeekDays(value, fallback = DEFAULT_CONTROL.scheduling.allowedDays) {
  const requested = normalizeStringArray(value, fallback)
    .map((item) => item.toLowerCase())
    .filter((item) => VALID_WEEK_DAYS.includes(item));

  return requested.length ? requested : [...fallback];
}

function normalizeAgendaTypes(value, fallback = DEFAULT_CONTROL.scheduling.allowedAgendaTypes) {
  const requested = normalizeStringArray(value, fallback)
    .map((item) => item.toLowerCase())
    .filter((item) => VALID_AGENDA_TYPES.includes(item));

  return requested.length ? requested : [...fallback];
}

function normalizeTime(value, fallback) {
  const normalized = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback;
}

function sanitizeControlSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const capabilities = source.capabilities && typeof source.capabilities === "object" ? source.capabilities : {};
  const scheduling = source.scheduling && typeof source.scheduling === "object" ? source.scheduling : {};

  return {
    enabled: normalizeBoolean(source.enabled, DEFAULT_CONTROL.enabled),
    autoReplyEnabled: normalizeBoolean(
      source.autoReplyEnabled,
      DEFAULT_CONTROL.autoReplyEnabled,
    ),
    autoExecuteEnabled: normalizeBoolean(
      source.autoExecuteEnabled,
      DEFAULT_CONTROL.autoExecuteEnabled,
    ),
    assistantName: String(
      source.assistantName || DEFAULT_CONTROL.assistantName,
    ).trim(),
    provider: String(source.provider || DEFAULT_CONTROL.provider).trim(),
    instructions: String(
      source.instructions || DEFAULT_CONTROL.instructions,
    ).trim(),
    escalationKeywords: normalizeStringArray(
      source.escalationKeywords,
      DEFAULT_CONTROL.escalationKeywords,
    ),
    capabilities: {
      replyToMessages: normalizeBoolean(
        capabilities.replyToMessages,
        DEFAULT_CONTROL.capabilities.replyToMessages,
      ),
      createCustomer: normalizeBoolean(
        capabilities.createCustomer,
        DEFAULT_CONTROL.capabilities.createCustomer,
      ),
      createPet: normalizeBoolean(
        capabilities.createPet,
        DEFAULT_CONTROL.capabilities.createPet,
      ),
      createAppointment: normalizeBoolean(
        capabilities.createAppointment,
        DEFAULT_CONTROL.capabilities.createAppointment,
      ),
      updateAppointment: normalizeBoolean(
        capabilities.updateAppointment,
        DEFAULT_CONTROL.capabilities.updateAppointment,
      ),
      cancelAppointment: normalizeBoolean(
        capabilities.cancelAppointment,
        DEFAULT_CONTROL.capabilities.cancelAppointment,
      ),
      viewFinancial: normalizeBoolean(
        capabilities.viewFinancial,
        DEFAULT_CONTROL.capabilities.viewFinancial,
      ),
    },
    scheduling: {
      requireHumanApproval: normalizeBoolean(
        scheduling.requireHumanApproval,
        DEFAULT_CONTROL.scheduling.requireHumanApproval,
      ),
      requireTutorConfirmation: normalizeBoolean(
        scheduling.requireTutorConfirmation,
        DEFAULT_CONTROL.scheduling.requireTutorConfirmation,
      ),
      allowNewCustomer: normalizeBoolean(
        scheduling.allowNewCustomer,
        DEFAULT_CONTROL.scheduling.allowNewCustomer,
      ),
      allowNewPet: normalizeBoolean(
        scheduling.allowNewPet,
        DEFAULT_CONTROL.scheduling.allowNewPet,
      ),
      allowOffGridTimes: normalizeBoolean(
        scheduling.allowOffGridTimes,
        DEFAULT_CONTROL.scheduling.allowOffGridTimes,
      ),
      minimumLeadMinutes: normalizePositiveInteger(
        scheduling.minimumLeadMinutes,
        DEFAULT_CONTROL.scheduling.minimumLeadMinutes,
      ),
      slotMinutes: normalizePositiveInteger(
        scheduling.slotMinutes,
        DEFAULT_CONTROL.scheduling.slotMinutes,
      ),
      maxDailyAppointments: normalizePositiveInteger(
        scheduling.maxDailyAppointments,
        DEFAULT_CONTROL.scheduling.maxDailyAppointments,
      ),
      allowedAgendaTypes: normalizeAgendaTypes(
        scheduling.allowedAgendaTypes,
        DEFAULT_CONTROL.scheduling.allowedAgendaTypes,
      ),
      allowedServiceCategories: normalizeStringArray(
        scheduling.allowedServiceCategories,
        DEFAULT_CONTROL.scheduling.allowedServiceCategories,
      ),
      allowedDays: normalizeWeekDays(
        scheduling.allowedDays,
        DEFAULT_CONTROL.scheduling.allowedDays,
      ),
      allowedTimeStart: normalizeTime(
        scheduling.allowedTimeStart,
        DEFAULT_CONTROL.scheduling.allowedTimeStart,
      ),
      allowedTimeEnd: normalizeTime(
        scheduling.allowedTimeEnd,
        DEFAULT_CONTROL.scheduling.allowedTimeEnd,
      ),
      notes: String(scheduling.notes || DEFAULT_CONTROL.scheduling.notes).trim(),
    },
  };
}

async function getOrCreateControlSettings(usersId) {
  let settings = await Settings.findOne({
    where: { usersId },
  });

  if (!settings) {
    settings = await Settings.create({
      usersId,
      whatsappConnection: {},
    });
  }

  const whatsappConnection =
    settings.whatsappConnection && typeof settings.whatsappConnection === "object"
      ? settings.whatsappConnection
      : {};

  const control = sanitizeControlSettings(whatsappConnection.crmAiControl);

  return {
    settings,
    whatsappConnection,
    control,
  };
}

function getActionCapability(actionType) {
  switch (actionType) {
    case "reply_message":
      return "replyToMessages";
    case "create_customer":
      return "createCustomer";
    case "create_pet":
      return "createPet";
    case "schedule_appointment":
      return "createAppointment";
    case "update_appointment":
      return "updateAppointment";
    case "cancel_appointment":
      return "cancelAppointment";
    default:
      return "";
  }
}

function getWeekDayFromDate(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  return VALID_WEEK_DAYS[parsed.getDay()] || "";
}

function getTimeLabelFromDate(value, fallback = "") {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return fallback;
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getMinutesFromTime(value) {
  const normalized = normalizeTime(value, "");
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function evaluateControlAction(control, actionType, payload = {}) {
  const reasons = [];
  const warnings = [];
  const capability = getActionCapability(actionType);

  if (!control.enabled) {
    reasons.push("A IA esta desativada.");
  }

  if (!capability || !control.capabilities[capability]) {
    reasons.push("Essa acao nao esta liberada nas permissoes da IA.");
  }

  if (actionType === "schedule_appointment") {
    const agendaType = String(payload.agendaType || "").trim().toLowerCase();
    const serviceCategory = String(payload.serviceCategory || "").trim();
    const appointmentAt = payload.appointmentAt || payload.dateTime || "";
    const weekday = getWeekDayFromDate(appointmentAt);
    const timeLabel = getTimeLabelFromDate(appointmentAt, String(payload.time || ""));
    const appointmentMinutes = getMinutesFromTime(timeLabel);
    const startMinutes = getMinutesFromTime(control.scheduling.allowedTimeStart);
    const endMinutes = getMinutesFromTime(control.scheduling.allowedTimeEnd);

    if (
      agendaType &&
      !control.scheduling.allowedAgendaTypes.includes(agendaType)
    ) {
      reasons.push("O tipo de agenda nao esta permitido para agendamento automatico.");
    }

    if (
      serviceCategory &&
      control.scheduling.allowedServiceCategories.length &&
      !control.scheduling.allowedServiceCategories.some(
        (item) => item.toLowerCase() === serviceCategory.toLowerCase(),
      )
    ) {
      reasons.push("A categoria de servico nao esta liberada para a IA.");
    }

    if (weekday && !control.scheduling.allowedDays.includes(weekday)) {
      reasons.push("O dia solicitado esta fora dos dias permitidos.");
    }

    if (
      appointmentMinutes != null &&
      startMinutes != null &&
      endMinutes != null &&
      (appointmentMinutes < startMinutes || appointmentMinutes > endMinutes)
    ) {
      reasons.push("O horario solicitado esta fora da janela permitida.");
    }

    if (!control.scheduling.allowOffGridTimes && appointmentMinutes != null) {
      const slotBase = Number(control.scheduling.slotMinutes || 0);
      if (slotBase > 0 && appointmentMinutes % slotBase !== 0) {
        reasons.push("A IA nao pode usar horarios quebrados fora do intervalo configurado.");
      }
    }

    if (payload.isNewCustomer && !control.scheduling.allowNewCustomer) {
      reasons.push("A IA nao pode cadastrar tutor novo automaticamente.");
    }

    if (payload.isNewPet && !control.scheduling.allowNewPet) {
      reasons.push("A IA nao pode cadastrar pet novo automaticamente.");
    }

    if (
      control.scheduling.requireTutorConfirmation &&
      !normalizeBoolean(payload.tutorConfirmed, false)
    ) {
      warnings.push("O tutor ainda nao confirmou o agendamento.");
    }

    if (appointmentAt) {
      const appointmentDate = new Date(appointmentAt);
      if (!Number.isNaN(appointmentDate.getTime())) {
        const leadMinutes = (appointmentDate.getTime() - Date.now()) / 60000;
        if (leadMinutes < Number(control.scheduling.minimumLeadMinutes || 0)) {
          reasons.push("O agendamento esta muito proximo do horario atual.");
        }
      }
    }
  }

  if (actionType === "create_customer" && !control.scheduling.allowNewCustomer) {
    warnings.push("Criacao de tutor exige aprovacao manual pela regra atual.");
  }

  if (actionType === "create_pet" && !control.scheduling.allowNewPet) {
    warnings.push("Criacao de pet exige aprovacao manual pela regra atual.");
  }

  const blocked = reasons.length > 0;
  const requiresApproval =
    !blocked &&
    (control.scheduling.requireHumanApproval ||
      !control.autoExecuteEnabled ||
      warnings.length > 0);

  return {
    allowed: !blocked,
    executionMode: blocked
      ? "blocked"
      : requiresApproval
        ? "approval"
        : "automatic",
    reasons,
    warnings,
  };
}

function normalizeSearchable(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseAppointmentDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const normalized = raw.length === 16 ? `${raw}:00` : raw;
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const date = parsed.toISOString().slice(0, 10);
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");

  return {
    raw,
    parsed,
    date,
    time: `${hours}:${minutes}:00`,
    timeLabel: `${hours}:${minutes}`,
  };
}

function formatAppointmentLabel(parsedInfo) {
  if (!parsedInfo?.parsed) return "";
  const parsed = parsedInfo.parsed;
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

async function resolveConversationContext(usersId, conversationId) {
  if (!conversationId) return null;

  return CrmConversation.findOne({
    where: {
      id: conversationId,
      usersId,
      isArchived: false,
    },
  });
}

async function resolveCustomerForAi(usersId, conversation, customerId) {
  const resolvedId = customerId || conversation?.customerId || "";
  if (!resolvedId) return null;

  return Custumers.findOne({
    where: {
      id: resolvedId,
      usersId,
    },
  });
}

async function findCustomerByPhone(usersId, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  return Custumers.findOne({
    where: {
      usersId,
      phone: normalizedPhone,
    },
    order: [["updatedAt", "DESC"]],
  });
}

async function createCustomerForAi(usersId, draft = {}) {
  const name = String(draft.name || "").trim();
  const phone = normalizePhone(draft.phone);

  if (!name && !phone) return null;

  return Custumers.create({
    usersId,
    name: name || phone,
    phone,
    email: String(draft.email || "").trim() || null,
    address: String(draft.address || "").trim() || null,
    city: String(draft.city || "").trim() || null,
    bairro: String(draft.bairro || "").trim() || null,
    observation: String(draft.observation || "").trim() || null,
    state: String(draft.state || "").trim() || null,
    status: true,
  });
}

async function resolvePetForAi(usersId, conversation, petId) {
  const resolvedId = petId || conversation?.petId || "";
  if (!resolvedId) return null;

  return Pets.findOne({
    where: {
      id: resolvedId,
      usersId,
    },
  });
}

async function findPetByName(usersId, customerId, name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName || !customerId) return null;

  return Pets.findOne({
    where: {
      usersId,
      custumerId: customerId,
      name: normalizedName,
    },
    order: [["updatedAt", "DESC"]],
  });
}

async function createPetForAi(usersId, customerId, draft = {}) {
  const name = String(draft.name || "").trim();
  if (!name || !customerId) return null;

  return Pets.create({
    usersId,
    custumerId: customerId,
    name,
    species: String(draft.species || "").trim() || null,
    breed: String(draft.breed || "").trim() || null,
    color: String(draft.color || "").trim() || null,
    sex: String(draft.sex || "").trim() || null,
    observation: String(draft.observation || "").trim() || null,
    allergic: String(draft.allergic || "").trim() || null,
  });
}

function scoreBathService(service, serviceQuery) {
  const name = normalizeSearchable(service?.name);
  const category = normalizeSearchable(service?.category);
  const query = normalizeSearchable(serviceQuery);
  let score = 0;

  if (name.includes("banho")) score += 10;
  if (name.includes("tosa")) score += 4;
  if (category.includes("estet")) score += 6;
  if (category.includes("banho")) score += 8;
  if (query && name.includes(query)) score += 7;
  if (query && category.includes(query)) score += 5;
  if (query && query.includes("banho") && name.includes("banho")) score += 4;

  return score;
}

async function resolveBathService(usersId, serviceId, serviceQuery) {
  if (serviceId) {
    const service = await Services.findOne({
      where: {
        id: serviceId,
        establishment: usersId,
      },
    });

    if (service) return service;
  }

  const services = await Services.findAll({
    where: { establishment: usersId },
    order: [["name", "ASC"]],
  });

  if (!services.length) return null;

  const preferredService = services
    .map((service) => ({ service, score: scoreBathService(service, serviceQuery) }))
    .sort((left, right) => right.score - left.score)[0];

  return preferredService?.score > 0 ? preferredService.service : null;
}

async function appendConversationSystemMessage({
  usersId,
  conversation,
  authorUserId,
  customerId,
  petId,
  body,
  payload = {},
}) {
  if (!conversation?.id || !body) return;

  await CrmConversationMessage.create({
    conversationId: conversation.id,
    usersId,
    customerId: customerId || conversation.customerId || null,
    petId: petId || conversation.petId || null,
    authorUserId: authorUserId || null,
    direction: "outbound",
    channel: conversation.channel || "whatsapp",
    messageType: "text",
    body,
    status: "internal",
    sentAt: new Date(),
    payload: {
      source: "crm_ai",
      ...payload,
    },
  });

  await conversation.update({
    status: "attending",
    lastMessagePreview: body.slice(0, 240),
    lastMessageAt: new Date(),
    unreadCount: 0,
  });
}

async function createAppointmentFromAi({
  usersId,
  authorUserId,
  customer,
  pet,
  service,
  appointmentInfo,
  observation,
}) {
  return sequelize.transaction(async (transaction) => {
    const finance = await Finance.create(
      {
        type: "entrada",
        description: `Agendamento IA - ${service.name} - ${pet.name}`,
        amount: Number(service.price || 0),
        date: new Date(appointmentInfo.date),
        dueDate: new Date(appointmentInfo.date),
        category: "Serviços",
        subCategory: "estetica",
        expenseType: "variavel",
        frequency: "unico",
        paymentMethod: "Pendente",
        status: "pendente",
        reference: "appointment",
        notes: observation || "Criado pela IA do CRM",
        createdBy: authorUserId,
        usersId,
      },
      { transaction },
    );

    const appointment = await Appointment.create(
      {
        usersId,
        petId: pet.id,
        customerId: customer.id,
        serviceId: service.id,
        type: "estetica",
        date: appointmentInfo.date,
        time: appointmentInfo.time,
        observation: observation || "Criado pela IA do CRM",
        whatsapp: true,
        financeId: finance.id,
      },
      { transaction },
    );

    return {
      appointment,
      finance,
    };
  });
}

function combineDateWithMinutes(date, minutes) {
  const combined = new Date(date);
  combined.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return combined;
}

function buildDateOnlyLabel(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTimeLabelFromMinutes(minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

async function suggestAvailableBathSlots({
  usersId,
  control,
  settings,
  fromDate,
  limit = 4,
}) {
  const leadMinutes = Number(control?.scheduling?.minimumLeadMinutes || 0);
  const slotMinutes = Math.max(
    5,
    Number(
      control?.scheduling?.slotMinutes ||
        settings?.intervalAesthetics ||
        10,
    ) || 10,
  );
  const windowStart = getMinutesFromTime(
    normalizeTime(
      control?.scheduling?.allowedTimeStart,
      String(settings?.openingTime || "08:00:00").slice(0, 5),
    ),
  );
  const windowEnd = getMinutesFromTime(
    normalizeTime(
      control?.scheduling?.allowedTimeEnd,
      String(settings?.closingTime || "18:00:00").slice(0, 5),
    ),
  );
  const breakStart = getMinutesFromTime(
    normalizeTime(String(settings?.breakStartTime || "").slice(0, 5), ""),
  );
  const breakEnd = getMinutesFromTime(
    normalizeTime(String(settings?.breakEndTime || "").slice(0, 5), ""),
  );
  const workingDays =
    settings?.workingDays && typeof settings.workingDays === "object"
      ? settings.workingDays
      : {};
  const searchStart = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : new Date();
  const dayStart = new Date(searchStart);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 14);

  const appointments = await Appointment.findAll({
    where: {
      usersId,
      type: "estetica",
      date: {
        [Op.between]: [buildDateOnlyLabel(dayStart), buildDateOnlyLabel(dayEnd)],
      },
    },
    attributes: ["date", "time"],
  });

  const occupied = new Set(
    appointments.map((item) => {
      const time = String(item.time || "").slice(0, 5);
      return `${item.date} ${time}`;
    }),
  );

  const suggestions = [];
  const earliestAllowed = new Date(Date.now() + leadMinutes * 60000);

  for (let offset = 0; offset < 14 && suggestions.length < limit; offset += 1) {
    const currentDay = new Date(dayStart);
    currentDay.setDate(currentDay.getDate() + offset);

    const weekDayId = VALID_WEEK_DAYS[currentDay.getDay()];
    if (!control?.scheduling?.allowedDays?.includes(weekDayId)) continue;
    if (workingDays[weekDayId] === false) continue;

    for (
      let minutes = windowStart;
      minutes <= windowEnd && suggestions.length < limit;
      minutes += slotMinutes
    ) {
      if (
        breakStart != null &&
        breakEnd != null &&
        minutes >= breakStart &&
        minutes < breakEnd
      ) {
        continue;
      }

      const slotDate = combineDateWithMinutes(currentDay, minutes);
      if (slotDate < earliestAllowed) continue;
      if (slotDate < searchStart) continue;

      const dateLabel = buildDateOnlyLabel(slotDate);
      const timeLabel = buildTimeLabelFromMinutes(minutes);
      if (occupied.has(`${dateLabel} ${timeLabel}`)) continue;

      suggestions.push({
        date: dateLabel,
        time: timeLabel,
        label: formatAppointmentLabel({
          parsed: slotDate,
        }),
        dateTime: `${dateLabel}T${timeLabel}`,
      });
    }
  }

  return suggestions;
}

function buildAssistantBathReply({
  pet,
  service,
  appointmentLabel,
  suggestions = [],
  validation,
  createdCustomer,
  createdPet,
}) {
  const intro = [];

  if (createdCustomer) {
    intro.push("cadastrei o tutor");
  }
  if (createdPet) {
    intro.push("cadastrei o pet");
  }

  const introText = intro.length
    ? `Perfeito, ${intro.join(" e ")} e `
    : "Perfeito, ";

  if (appointmentLabel) {
    if (validation?.executionMode === "automatic") {
      return `${introText}ja posso confirmar o ${service.name} do ${pet.name} para ${appointmentLabel}.`;
    }

    if (validation?.executionMode === "approval") {
      return `${introText}montei a proposta de ${service.name} do ${pet.name} para ${appointmentLabel}, mas ela ainda depende da aprovacao interna.`;
    }

    return `${introText}nao consegui confirmar esse horario para ${pet.name}.`;
  }

  if (suggestions.length) {
    const labels = suggestions.slice(0, 3).map((item) => item.label).join(" | ");
    return `${introText}encontrei estes horarios para ${service.name} do ${pet.name}: ${labels}.`;
  }

  return `${introText}ainda nao encontrei um horario valido para ${service.name} do ${pet.name}.`;
}

function mapAppointmentSummary(appointment) {
  if (!appointment) return null;

  const date = String(appointment.date || "").slice(0, 10);
  const time = String(appointment.time || "").slice(0, 5);
  const label = date && time ? `${date} ${time}` : `${date} ${time}`.trim();

  return {
    id: appointment.id,
    date,
    time,
    label,
    status: appointment.status || "agendado",
    serviceName:
      appointment?.Service?.name ||
      appointment?.service?.name ||
      appointment?.serviceName ||
      "",
    financeId: appointment.financeId || null,
  };
}

async function findConversationAppointment({
  usersId,
  appointmentId,
  customerId,
  petId,
}) {
  if (appointmentId) {
    const directAppointment = await Appointment.findOne({
      where: {
        id: appointmentId,
        usersId,
      },
      include: [{ model: Services }],
    });

    if (directAppointment) {
      return directAppointment;
    }
  }

  if (!customerId && !petId) {
    return null;
  }

  const where = {
    usersId,
    status: {
      [Op.notIn]: ["cancelado", "Cancelado", "concluido", "Concluido"],
    },
  };

  if (customerId) where.customerId = customerId;
  if (petId) where.petId = petId;

  return Appointment.findOne({
    where,
    include: [{ model: Services }],
    order: [
      ["date", "ASC"],
      ["time", "ASC"],
    ],
  });
}

async function cancelAppointmentFromAi({ appointment, usersId, authorUserId }) {
  await sequelize.transaction(async (transaction) => {
    await appointment.update(
      { status: "cancelado" },
      { transaction },
    );

    if (appointment.financeId) {
      await Finance.update(
        {
          status: "cancelado",
          paymentMethod: "Cancelado",
        },
        {
          where: {
            id: appointment.financeId,
            usersId,
          },
          transaction,
        },
      );
    }
  });

  return {
    appointmentId: appointment.id,
    financeId: appointment.financeId || null,
    cancelledBy: authorUserId,
  };
}

async function rescheduleAppointmentFromAi({
  appointment,
  appointmentInfo,
  service,
  usersId,
}) {
  await sequelize.transaction(async (transaction) => {
    await appointment.update(
      {
        date: appointmentInfo.date,
        time: appointmentInfo.time,
        serviceId: service?.id || appointment.serviceId,
        status: "agendado",
      },
      { transaction },
    );

    if (appointment.financeId) {
      await Finance.update(
        {
          dueDate: new Date(appointmentInfo.date),
          amount: Number(service?.price || 0),
          status: "pendente",
        },
        {
          where: {
            id: appointment.financeId,
            usersId,
          },
          transaction,
        },
      );
    }
  });

  return {
    appointmentId: appointment.id,
    financeId: appointment.financeId || null,
  };
}

function buildAssistantRescheduleReply({
  petName,
  serviceName,
  targetLabel,
  validation,
}) {
  if (validation?.executionMode === "automatic") {
    return `Perfeito, ja posso remarcar ${serviceName} do ${petName} para ${targetLabel}.`;
  }

  if (validation?.executionMode === "approval") {
    return `Montei a remarcacao de ${serviceName} do ${petName} para ${targetLabel}, mas ainda depende da aprovacao interna.`;
  }

  return `Nao consegui remarcar ${serviceName} do ${petName} para ${targetLabel}.`;
}

function buildAssistantCancelReply({ petName, serviceName, validation }) {
  if (validation?.executionMode === "automatic") {
    return `Posso cancelar ${serviceName} do ${petName} e avisar o tutor.`;
  }

  if (validation?.executionMode === "approval") {
    return `Preparei o cancelamento de ${serviceName} do ${petName}, mas ele ainda precisa de aprovacao interna.`;
  }

  return `Nao consegui cancelar ${serviceName} do ${petName} pela regra atual.`;
}

function buildKnowledgeReply({
  question,
  services = [],
  settings,
  customer,
  pet,
}) {
  const normalized = normalizeSearchable(question);
  const opening = String(settings?.openingTime || "08:00:00").slice(0, 5);
  const closing = String(settings?.closingTime || "18:00:00").slice(0, 5);
  const topServices = services.slice(0, 4);

  if (normalized.includes("horario") || normalized.includes("funciona")) {
    return `Nosso horario base de atendimento vai de ${opening} ate ${closing}. Se quiser, eu tambem posso sugerir os proximos horarios livres para o atendimento.`;
  }

  if (
    normalized.includes("banho") ||
    normalized.includes("tosa") ||
    normalized.includes("servico") ||
    normalized.includes("serviço")
  ) {
    const listed = topServices.length
      ? topServices
          .map((item) => `${item.name}${item.price != null ? ` por R$ ${Number(item.price || 0).toFixed(2)}` : ""}`)
          .join(" | ")
      : "Banho e tosa conforme o porte e o servico escolhido";
    return `Consigo te orientar pelos servicos cadastrados aqui no sistema. Alguns exemplos: ${listed}. Se quiser, eu ja monto uma proposta para ${pet?.name || "o pet"}.`;
  }

  if (normalized.includes("cadastro") || normalized.includes("documento")) {
    return `Consigo adiantar o cadastro por aqui. Para isso eu preciso pelo menos do nome e WhatsApp do tutor, e o nome do pet.`;
  }

  if (customer?.name || pet?.name) {
    return `Consigo seguir com esse atendimento usando o cadastro de ${customer?.name || "tutor"}${pet?.name ? ` e do pet ${pet.name}` : ""}. Se quiser, posso sugerir horarios ou montar uma resposta pronta.`;
  }

  return `Posso responder usando os dados reais do sistema, sugerir horarios, cadastrar tutor e pet, ou montar uma proposta de atendimento.`;
}

async function logAiAction({
  usersId,
  conversationId = null,
  customerId = null,
  petId = null,
  appointmentId = null,
  financeId = null,
  authorUserId = null,
  actionType,
  status = "proposed",
  summary = "",
  assistantReply = "",
  approvalRequired = false,
  approvedByHuman = false,
  executed = false,
  payload = {},
}) {
  return CrmAiActionLog.create({
    usersId,
    conversationId,
    customerId,
    petId,
    appointmentId,
    financeId,
    authorUserId,
    actionType,
    status,
    summary,
    assistantReply,
    approvalRequired,
    approvedByHuman,
    executed,
    payload,
  });
}

function getPublicPlan() {
  return {
    id: "crm-ai-premium",
    name: "IA CRM Premium",
    provider: "Google Gemini",
    price: CRM_AI_PRICE,
    currency: "BRL",
    billing_cycle: "monthly",
    description: "IA comercial do ViaPet com regras personalizadas, assistencia no CRM e automacoes premium.",
    benefits: [
      "Conversa com IA dentro do CRM",
      "Permissoes de agenda, cliente e pet",
      "Bloqueio por assinatura premium",
      "Base pronta para integrar com Google Gemini",
    ],
  };
}

function computeAccess(subscription) {
  if (!subscription) return { canAccess: false, status: "no_subscription" };
  const expiry = subscription.next_billing_date ? new Date(subscription.next_billing_date) : null;
  const isExpired = subscription.status === "active" && expiry && expiry < new Date();
  return {
    canAccess: subscription.status === "active" && !isExpired,
    status: isExpired ? "expired" : subscription.status,
  };
}

async function getCrmAiAccess(usersId) {
  const subscription = await CrmAiSubscription.findOne({
    where: { user_id: usersId },
    order: [["created_at", "DESC"]],
  });

  if (!subscription) {
    return {
      subscription: null,
      access: { canAccess: false, status: "no_subscription" },
    };
  }

  const access = computeAccess(subscription);
  if (access.status === "expired" && subscription.status !== "expired") {
    await subscription.update({ status: "expired" });
  }

  return {
    subscription,
    access,
  };
}

async function requireCrmAiAccess(usersId, res) {
  const { subscription, access } = await getCrmAiAccess(usersId);
  if (access.canAccess) {
    return { allowed: true, subscription, access };
  }

  res.status(403).json({
    success: false,
    error: "A IA CRM nao esta liberada para esta conta.",
    data: {
      canAccess: false,
      status: access.status,
      subscription: subscription
        ? {
            id: subscription.id,
            status: access.status,
            amount: Number(subscription.amount || 0),
            currency: subscription.currency,
            payment_status: subscription.payment_status,
            next_billing_date: subscription.next_billing_date,
          }
        : null,
    },
  });

  return { allowed: false, subscription, access };
}

router.get("/plans", (req, res) => {
  return res.json({
    success: true,
    plan: getPublicPlan(),
  });
});

router.get("/subscription", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const { subscription, access } = await getCrmAiAccess(usersId);

    if (!subscription) {
      return res.json({
        success: true,
        plan: getPublicPlan(),
        canAccess: false,
        subscription: null,
      });
    }

    return res.json({
      success: true,
      plan: getPublicPlan(),
      canAccess: access.canAccess,
      subscription: {
        id: subscription.id,
        status: access.status,
        amount: Number(subscription.amount || 0),
        currency: subscription.currency,
        payment_status: subscription.payment_status,
        payment_preference_id: subscription.payment_preference_id,
        payment_id: subscription.payment_id,
        external_reference: subscription.external_reference,
        activated_at: subscription.activated_at,
        next_billing_date: subscription.next_billing_date,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar assinatura da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar assinatura da IA CRM",
      details: error.message,
    });
  }
});

router.get("/control", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const { control } = await getOrCreateControlSettings(usersId);

    return res.json({
      success: true,
      data: control,
    });
  } catch (error) {
    console.error("Erro ao carregar controle da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao carregar controle da IA CRM",
      details: error.message,
    });
  }
});

router.post("/control", auth, owner, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const { settings, whatsappConnection } = await getOrCreateControlSettings(usersId);
    const control = sanitizeControlSettings(req.body || {});

    settings.whatsappConnection = {
      ...whatsappConnection,
      crmAiControl: control,
    };

    await settings.save();

    return res.json({
      success: true,
      message: "Controle da IA CRM atualizado com sucesso.",
      data: control,
    });
  } catch (error) {
    console.error("Erro ao salvar controle da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao salvar controle da IA CRM",
      details: error.message,
    });
  }
});

router.post("/control/evaluate", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const { control } = await getOrCreateControlSettings(usersId);
    const actionType = String(req.body?.actionType || "").trim().toLowerCase();
    const payload = req.body?.payload && typeof req.body.payload === "object"
      ? req.body.payload
      : {};

    if (!actionType) {
      return res.status(400).json({
        success: false,
        error: "Informe o tipo de acao para validar.",
      });
    }

    const result = evaluateControlAction(control, actionType, payload);

    return res.json({
      success: true,
      data: {
        actionType,
        ...result,
      },
    });
  } catch (error) {
    console.error("Erro ao validar acao da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao validar acao da IA CRM",
      details: error.message,
    });
  }
});

router.post("/assistant/schedule-bath", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const crmAiAccess = await requireCrmAiAccess(usersId, res);
    if (!crmAiAccess.allowed) return;
    const {
      conversationId,
      customerId,
      petId,
      serviceId,
      serviceQuery,
      appointmentAt,
      tutorConfirmed,
      humanApproved,
      execute,
      suggestSlots,
      notes,
      customerDraft,
      petDraft,
    } = req.body || {};

    const { control, settings } = await getOrCreateControlSettings(usersId);
    const appointmentInfo = appointmentAt ? parseAppointmentDateTime(appointmentAt) : null;
    const wantsSuggestions =
      normalizeBoolean(suggestSlots, false) || !appointmentInfo;

    const conversation = await resolveConversationContext(usersId, conversationId);
    const customerById = await resolveCustomerForAi(usersId, conversation, customerId);
    const customerByPhone =
      customerById ||
      (customerDraft?.phone
        ? await findCustomerByPhone(usersId, customerDraft.phone)
        : null);
    const existingCustomer = customerByPhone;
    const shouldCreateCustomer =
      !existingCustomer &&
      Boolean(String(customerDraft?.name || "").trim() || String(customerDraft?.phone || "").trim());

    if (!existingCustomer && !shouldCreateCustomer) {
      return res.status(404).json({
        success: false,
        error: "Tutor nao encontrado. Informe os dados do tutor para a IA continuar.",
      });
    }

    const petById = existingCustomer
      ? await resolvePetForAi(usersId, conversation, petId)
      : null;
    const petByName =
      petById ||
      (existingCustomer && petDraft?.name
        ? await findPetByName(usersId, existingCustomer.id, petDraft.name)
        : null);
    const existingPet = petByName;
    const shouldCreatePet =
      !existingPet && Boolean(String(petDraft?.name || "").trim());

    if (!existingPet && !shouldCreatePet) {
      return res.status(404).json({
        success: false,
        error: "Pet nao encontrado. Informe os dados do pet para a IA continuar.",
      });
    }

    const service = await resolveBathService(usersId, serviceId, serviceQuery || "Banho");

    if (!service) {
      return res.status(404).json({
        success: false,
        error: "Nao encontrei um servico de banho/estetica para usar com a IA.",
      });
    }

    const validation = evaluateControlAction(control, "schedule_appointment", {
      agendaType: "estetica",
      serviceCategory: service.category || serviceQuery || "Banho",
      appointmentAt: appointmentInfo?.raw || "",
      tutorConfirmed,
      isNewCustomer: shouldCreateCustomer,
      isNewPet: shouldCreatePet,
    });

    let existingAppointment = null;
    if (appointmentInfo && existingCustomer && existingPet) {
      existingAppointment = await Appointment.findOne({
        where: {
          usersId,
          customerId: existingCustomer.id,
          petId: existingPet.id,
          date: appointmentInfo.date,
          time: appointmentInfo.time,
        },
        include: [{ model: Services }],
      });

      if (existingAppointment) {
        validation.allowed = false;
        validation.executionMode = "blocked";
        validation.reasons = [
          ...(validation.reasons || []),
          "Ja existe um agendamento nesse mesmo horario para esse pet.",
        ];
      }
    }

    const baseDate = appointmentInfo?.parsed || new Date();
    const slotSuggestions = await suggestAvailableBathSlots({
      usersId,
      control,
      settings,
      fromDate: baseDate,
      limit: 4,
    });

    const effectiveCustomer = existingCustomer || {
      id: "",
      name: String(customerDraft?.name || conversation?.customerName || "").trim(),
      phone: normalizePhone(customerDraft?.phone || conversation?.phone || ""),
      email: String(customerDraft?.email || "").trim() || "",
    };
    const effectivePet = existingPet || {
      id: "",
      name: String(petDraft?.name || conversation?.petName || "").trim(),
      species: String(petDraft?.species || "").trim() || "",
      breed: String(petDraft?.breed || "").trim() || "",
    };
    const appointmentLabel = appointmentInfo
      ? formatAppointmentLabel(appointmentInfo)
      : "";

    const proposal = {
      conversationId: conversation?.id || "",
      customer: {
        id: effectiveCustomer.id || "",
        name: effectiveCustomer.name || "",
        phone: effectiveCustomer.phone || "",
        email: effectiveCustomer.email || "",
        willCreate: shouldCreateCustomer,
      },
      pet: {
        id: effectivePet.id || "",
        name: effectivePet.name || "",
        species: effectivePet.species || "",
        breed: effectivePet.breed || "",
        willCreate: shouldCreatePet,
      },
      service: {
        id: service.id,
        name: service.name,
        category: service.category,
        price: Number(service.price || 0),
      },
      appointment: {
        date: appointmentInfo?.date || "",
        time: appointmentInfo?.timeLabel || "",
        label: appointmentLabel,
        type: "estetica",
      },
      slotSuggestions,
      validation,
      canExecuteNow:
        validation.allowed &&
        Boolean(appointmentInfo) &&
        (validation.executionMode === "automatic" ||
          normalizeBoolean(humanApproved, false)),
      assistantReply:
        buildAssistantBathReply({
          pet: effectivePet,
          service,
          appointmentLabel,
          suggestions: slotSuggestions,
          validation,
          createdCustomer: shouldCreateCustomer,
          createdPet: shouldCreatePet,
        }),
    };

    if (!normalizeBoolean(execute, false)) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: proposal.customer.id || null,
        petId: proposal.pet.id || null,
        authorUserId: req.user.id,
        actionType: "schedule_bath",
        status: "proposed",
        summary: `Proposta de ${service.name} para ${proposal.pet.name || "pet"}`,
        assistantReply: proposal.assistantReply,
        approvalRequired: proposal.validation?.executionMode === "approval",
        approvedByHuman: normalizeBoolean(humanApproved, false),
        executed: false,
        payload: proposal,
      });
      return res.json({
        success: true,
        data: proposal,
      });
    }

    if (!validation.allowed) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: proposal.customer.id || null,
        petId: proposal.pet.id || null,
        authorUserId: req.user.id,
        actionType: "schedule_bath",
        status: "blocked",
        summary: "Proposta de banho bloqueada",
        assistantReply: proposal.assistantReply,
        approvalRequired: proposal.validation?.executionMode === "approval",
        approvedByHuman: normalizeBoolean(humanApproved, false),
        executed: false,
        payload: proposal,
      });
      return res.status(409).json({
        success: false,
        error: "A proposta foi bloqueada pelas regras da IA.",
        data: proposal,
      });
    }

    if (!appointmentInfo) {
      return res.status(409).json({
        success: false,
        error: "Escolha um horario para executar o agendamento.",
        data: proposal,
      });
    }

    if (
      validation.executionMode === "approval" &&
      !normalizeBoolean(humanApproved, false)
    ) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: proposal.customer.id || null,
        petId: proposal.pet.id || null,
        authorUserId: req.user.id,
        actionType: "schedule_bath",
        status: "waiting_approval",
        summary: "Proposta de banho aguardando aprovacao",
        assistantReply: proposal.assistantReply,
        approvalRequired: true,
        approvedByHuman: false,
        executed: false,
        payload: proposal,
      });
      return res.status(409).json({
        success: false,
        error: "Essa acao ainda exige aprovacao humana antes de executar.",
        data: proposal,
      });
    }

    let customer = existingCustomer;
    if (!customer && shouldCreateCustomer) {
      customer = await createCustomerForAi(usersId, {
        ...customerDraft,
        phone: customerDraft?.phone || conversation?.phone || "",
        name: customerDraft?.name || conversation?.customerName || conversation?.title || "",
      });
    }

    if (!customer) {
      return res.status(409).json({
        success: false,
        error: "Nao foi possivel resolver ou criar o tutor para executar a acao.",
        data: proposal,
      });
    }

    let pet = existingPet;
    if (!pet && shouldCreatePet) {
      pet = await createPetForAi(usersId, customer.id, {
        ...petDraft,
        name: petDraft?.name || conversation?.petName || "",
      });
    }

    if (!pet) {
      return res.status(409).json({
        success: false,
        error: "Nao foi possivel resolver ou criar o pet para executar a acao.",
        data: proposal,
      });
    }

    if (conversation) {
      await conversation.update({
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
        petId: pet.id,
        petName: pet.name,
        title: pet.name || customer.name || conversation.title,
      });
    }

    const observation = String(notes || "").trim() || "Criado pela IA do CRM";
    const created = await createAppointmentFromAi({
      usersId,
      authorUserId: req.user.id,
      customer,
      pet,
      service,
      appointmentInfo,
      observation,
    });

    if (conversation) {
      await appendConversationSystemMessage({
        usersId,
        conversation,
        authorUserId: req.user.id,
        customerId: customer.id,
        petId: pet.id,
        body: `ViaPet IA agendou ${service.name} para ${pet.name} em ${formatAppointmentLabel(appointmentInfo)}.`,
        payload: {
          action: "schedule_bath",
          appointmentId: created.appointment.id,
          financeId: created.finance.id,
        },
      });
    }

    await logAiAction({
      usersId,
      conversationId: conversation?.id || null,
      customerId: customer.id,
      petId: pet.id,
      appointmentId: created.appointment.id,
      financeId: created.finance.id,
      authorUserId: req.user.id,
      actionType: "schedule_bath",
      status: "executed",
      summary: `Agendamento criado para ${pet.name}`,
      assistantReply: proposal.assistantReply,
      approvalRequired: proposal.validation?.executionMode === "approval",
      approvedByHuman: normalizeBoolean(humanApproved, false),
      executed: true,
      payload: {
        ...proposal,
        appointmentId: created.appointment.id,
        financeId: created.finance.id,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Agendamento criado com sucesso pela IA.",
      data: {
        ...proposal,
        appointmentId: created.appointment.id,
      financeId: created.finance.id,
      executed: true,
        customer: {
          ...proposal.customer,
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
        },
        pet: {
          ...proposal.pet,
          id: pet.id,
          name: pet.name,
          species: pet.species,
          breed: pet.breed,
        },
      },
    });
  } catch (error) {
    console.error("Erro ao agendar banho pela IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao agendar banho pela IA CRM",
      details: error.message,
    });
  }
});

router.post("/assistant/upsert-contact", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const crmAiAccess = await requireCrmAiAccess(usersId, res);
    if (!crmAiAccess.allowed) return;
    const { conversationId, customerDraft, petDraft, execute } = req.body || {};
    const { control } = await getOrCreateControlSettings(usersId);
    const conversation = await resolveConversationContext(usersId, conversationId);

    const customerById = await resolveCustomerForAi(
      usersId,
      conversation,
      customerDraft?.id,
    );
    const customerByPhone =
      customerById ||
      (customerDraft?.phone
        ? await findCustomerByPhone(usersId, customerDraft.phone)
        : null);
    const existingCustomer = customerByPhone;
    const shouldCreateCustomer =
      !existingCustomer &&
      Boolean(
        String(customerDraft?.name || "").trim() ||
          String(customerDraft?.phone || "").trim(),
      );

    if (!existingCustomer && !shouldCreateCustomer) {
      return res.status(400).json({
        success: false,
        error: "Informe pelo menos nome ou telefone do tutor.",
      });
    }

    const customerValidation = evaluateControlAction(control, "create_customer", {
      isNewCustomer: shouldCreateCustomer,
    });

    const existingPet =
      existingCustomer && petDraft?.name
        ? await findPetByName(usersId, existingCustomer.id, petDraft.name)
        : null;
    const shouldCreatePet =
      !existingPet && Boolean(String(petDraft?.name || "").trim());

    const petValidation = evaluateControlAction(control, "create_pet", {
      isNewPet: shouldCreatePet,
    });

    const proposal = {
      conversationId: conversation?.id || "",
      customer: {
        id: existingCustomer?.id || "",
        name:
          existingCustomer?.name ||
          String(customerDraft?.name || conversation?.customerName || "").trim(),
        phone:
          existingCustomer?.phone ||
          normalizePhone(customerDraft?.phone || conversation?.phone || ""),
        email:
          existingCustomer?.email || String(customerDraft?.email || "").trim(),
        willCreate: shouldCreateCustomer,
      },
      pet: {
        id: existingPet?.id || "",
        name:
          existingPet?.name ||
          String(petDraft?.name || conversation?.petName || "").trim(),
        species:
          existingPet?.species || String(petDraft?.species || "").trim(),
        breed: existingPet?.breed || String(petDraft?.breed || "").trim(),
        willCreate: shouldCreatePet,
      },
      validation: {
        customer: customerValidation,
        pet: petValidation,
      },
      canExecuteNow:
        normalizeBoolean(execute, false) &&
        customerValidation.allowed &&
        petValidation.allowed,
      assistantReply: shouldCreatePet
        ? "Posso adiantar o cadastro do tutor e do pet por aqui e deixar tudo pronto para o atendimento."
        : "O cadastro ja esta vinculado nesta conversa.",
    };

    if (!normalizeBoolean(execute, false)) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: proposal.customer.id || null,
        petId: proposal.pet.id || null,
        authorUserId: req.user.id,
        actionType: "upsert_contact",
        status: "proposed",
        summary: "Proposta de cadastro/vinculo",
        assistantReply: proposal.assistantReply,
        approvalRequired:
          proposal.validation?.customer?.executionMode === "approval" ||
          proposal.validation?.pet?.executionMode === "approval",
        approvedByHuman: false,
        executed: false,
        payload: proposal,
      });
      return res.json({
        success: true,
        data: proposal,
      });
    }

    if (!customerValidation.allowed || !petValidation.allowed) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: proposal.customer.id || null,
        petId: proposal.pet.id || null,
        authorUserId: req.user.id,
        actionType: "upsert_contact",
        status: "blocked",
        summary: "Cadastro bloqueado pelas regras",
        assistantReply: proposal.assistantReply,
        approvalRequired: false,
        approvedByHuman: false,
        executed: false,
        payload: proposal,
      });
      return res.status(409).json({
        success: false,
        error: "O cadastro foi bloqueado pelas regras da IA.",
        data: proposal,
      });
    }

    let customer = existingCustomer;
    if (!customer && shouldCreateCustomer) {
      customer = await createCustomerForAi(usersId, customerDraft || {});
    }

    let pet = existingPet;
    if (!pet && shouldCreatePet) {
      pet = await createPetForAi(usersId, customer?.id, petDraft || {});
    }

    if (conversation) {
      await conversation.update({
        customerId: customer?.id || null,
        customerName: customer?.name || conversation.customerName,
        phone: customer?.phone || conversation.phone,
        petId: pet?.id || null,
        petName: pet?.name || conversation.petName,
        title: pet?.name || customer?.name || conversation.title,
      });

      await appendConversationSystemMessage({
        usersId,
        conversation,
        authorUserId: req.user.id,
        customerId: customer?.id || null,
        petId: pet?.id || null,
        body: `ViaPet IA atualizou o cadastro da conversa${customer?.name ? ` com o tutor ${customer.name}` : ""}${pet?.name ? ` e o pet ${pet.name}` : ""}.`,
        payload: {
          action: "upsert_contact",
          customerId: customer?.id || null,
          petId: pet?.id || null,
        },
      });
    }

    await logAiAction({
      usersId,
      conversationId: conversation?.id || null,
      customerId: customer?.id || null,
      petId: pet?.id || null,
      authorUserId: req.user.id,
      actionType: "upsert_contact",
      status: "executed",
      summary: "Cadastro atualizado pela IA",
      assistantReply: proposal.assistantReply,
      approvalRequired: false,
      approvedByHuman: true,
      executed: true,
      payload: {
        ...proposal,
        customerId: customer?.id || null,
        petId: pet?.id || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Cadastro vinculado com sucesso pela IA.",
      data: {
        ...proposal,
        executed: true,
        customer: {
          ...proposal.customer,
          id: customer?.id || "",
          name: customer?.name || proposal.customer.name,
          phone: customer?.phone || proposal.customer.phone,
          email: customer?.email || proposal.customer.email,
        },
        pet: {
          ...proposal.pet,
          id: pet?.id || "",
          name: pet?.name || proposal.pet.name,
          species: pet?.species || proposal.pet.species,
          breed: pet?.breed || proposal.pet.breed,
        },
      },
    });
  } catch (error) {
    console.error("Erro ao atualizar cadastro pela IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao atualizar cadastro pela IA CRM",
      details: error.message,
    });
  }
});

router.post("/assistant/reschedule-appointment", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const crmAiAccess = await requireCrmAiAccess(usersId, res);
    if (!crmAiAccess.allowed) return;
    const {
      conversationId,
      appointmentId,
      customerId,
      petId,
      appointmentAt,
      humanApproved,
      execute,
    } = req.body || {};

    const { control, settings } = await getOrCreateControlSettings(usersId);
    const conversation = await resolveConversationContext(usersId, conversationId);
    const targetAppointment = await findConversationAppointment({
      usersId,
      appointmentId,
      customerId: customerId || conversation?.customerId || "",
      petId: petId || conversation?.petId || "",
    });

    if (!targetAppointment) {
      return res.status(404).json({
        success: false,
        error: "Nao encontrei um agendamento ativo para remarcar.",
      });
    }

    const appointmentInfo = parseAppointmentDateTime(appointmentAt);
    if (!appointmentInfo) {
      const suggestions = await suggestAvailableBathSlots({
        usersId,
        control,
        settings,
        fromDate: new Date(),
        limit: 4,
      });

      const suggestedResponse = {
        appointment: mapAppointmentSummary(targetAppointment),
        slotSuggestions: suggestions,
        validation: {
          allowed: true,
          executionMode: "approval",
          reasons: [],
          warnings: ["Escolha um dos horarios sugeridos para remarcar."],
        },
        assistantReply: suggestions.length
          ? `Posso remarcar para estes horarios: ${suggestions.map((item) => item.label).join(" | ")}.`
          : "No momento nao encontrei horarios livres para remarcar.",
      };

      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: customerId || conversation?.customerId || null,
        petId: petId || conversation?.petId || null,
        appointmentId: targetAppointment.id,
        authorUserId: req.user.id,
        actionType: "reschedule_appointment",
        status: "proposed",
        summary: "Sugestao de horarios para remarcacao",
        assistantReply: suggestedResponse.assistantReply,
        approvalRequired: true,
        approvedByHuman: false,
        executed: false,
        payload: suggestedResponse,
      });

      return res.json({
        success: true,
        data: suggestedResponse,
      });
    }

    const validation = evaluateControlAction(control, "schedule_appointment", {
      agendaType: "estetica",
      serviceCategory: targetAppointment?.Service?.category || "Estetica",
      appointmentAt: appointmentInfo.raw,
      tutorConfirmed: true,
      isNewCustomer: false,
      isNewPet: false,
    });

    const conflict = await Appointment.findOne({
      where: {
        usersId,
        petId: targetAppointment.petId,
        date: appointmentInfo.date,
        time: appointmentInfo.time,
        id: { [Op.ne]: targetAppointment.id },
        status: {
          [Op.notIn]: ["cancelado", "Cancelado", "concluido", "Concluido"],
        },
      },
    });

    if (conflict) {
      validation.allowed = false;
      validation.executionMode = "blocked";
      validation.reasons = [
        ...(validation.reasons || []),
        "Ja existe outro agendamento nesse horario para esse pet.",
      ];
    }

    const proposal = {
      appointment: mapAppointmentSummary(targetAppointment),
      target: {
        date: appointmentInfo.date,
        time: appointmentInfo.timeLabel,
        label: formatAppointmentLabel(appointmentInfo),
      },
      validation,
      assistantReply: buildAssistantRescheduleReply({
        petName: conversation?.petName || "o pet",
        serviceName:
          targetAppointment?.Service?.name || "o atendimento",
        targetLabel: formatAppointmentLabel(appointmentInfo),
        validation,
      }),
    };

    if (!normalizeBoolean(execute, false)) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: customerId || conversation?.customerId || null,
        petId: petId || conversation?.petId || null,
        appointmentId: targetAppointment.id,
        authorUserId: req.user.id,
        actionType: "reschedule_appointment",
        status: "proposed",
        summary: "Proposta de remarcacao",
        assistantReply: proposal.assistantReply,
        approvalRequired: proposal.validation?.executionMode === "approval",
        approvedByHuman: normalizeBoolean(humanApproved, false),
        executed: false,
        payload: proposal,
      });
      return res.json({ success: true, data: proposal });
    }

    if (!validation.allowed) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: customerId || conversation?.customerId || null,
        petId: petId || conversation?.petId || null,
        appointmentId: targetAppointment.id,
        authorUserId: req.user.id,
        actionType: "reschedule_appointment",
        status: "blocked",
        summary: "Remarcacao bloqueada",
        assistantReply: proposal.assistantReply,
        approvalRequired: proposal.validation?.executionMode === "approval",
        approvedByHuman: normalizeBoolean(humanApproved, false),
        executed: false,
        payload: proposal,
      });
      return res.status(409).json({
        success: false,
        error: "A remarcacao foi bloqueada pelas regras da IA.",
        data: proposal,
      });
    }

    if (
      validation.executionMode === "approval" &&
      !normalizeBoolean(humanApproved, false)
    ) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: customerId || conversation?.customerId || null,
        petId: petId || conversation?.petId || null,
        appointmentId: targetAppointment.id,
        authorUserId: req.user.id,
        actionType: "reschedule_appointment",
        status: "waiting_approval",
        summary: "Remarcacao aguardando aprovacao",
        assistantReply: proposal.assistantReply,
        approvalRequired: true,
        approvedByHuman: false,
        executed: false,
        payload: proposal,
      });
      return res.status(409).json({
        success: false,
        error: "Essa remarcacao ainda exige aprovacao humana.",
        data: proposal,
      });
    }

    const moved = await rescheduleAppointmentFromAi({
      appointment: targetAppointment,
      appointmentInfo,
      service: targetAppointment?.Service || null,
      usersId,
    });

    if (conversation) {
      await appendConversationSystemMessage({
        usersId,
        conversation,
        authorUserId: req.user.id,
        customerId: conversation.customerId || null,
        petId: conversation.petId || null,
        body: `ViaPet IA remarcou o atendimento para ${formatAppointmentLabel(appointmentInfo)}.`,
        payload: {
          action: "reschedule_appointment",
          appointmentId: moved.appointmentId,
        },
      });
    }

    await logAiAction({
      usersId,
      conversationId: conversation?.id || null,
      customerId: customerId || conversation?.customerId || null,
      petId: petId || conversation?.petId || null,
      appointmentId: moved.appointmentId,
      authorUserId: req.user.id,
      actionType: "reschedule_appointment",
      status: "executed",
      summary: "Agendamento remarcado pela IA",
      assistantReply: proposal.assistantReply,
      approvalRequired: proposal.validation?.executionMode === "approval",
      approvedByHuman: normalizeBoolean(humanApproved, false),
      executed: true,
      payload: proposal,
    });

    return res.status(200).json({
      success: true,
      message: "Agendamento remarcado com sucesso pela IA.",
      data: {
        ...proposal,
        executed: true,
      },
    });
  } catch (error) {
    console.error("Erro ao remarcar agendamento pela IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao remarcar agendamento pela IA CRM",
      details: error.message,
    });
  }
});

router.post("/assistant/cancel-appointment", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const crmAiAccess = await requireCrmAiAccess(usersId, res);
    if (!crmAiAccess.allowed) return;
    const {
      conversationId,
      appointmentId,
      customerId,
      petId,
      humanApproved,
      execute,
    } = req.body || {};

    const { control } = await getOrCreateControlSettings(usersId);
    const conversation = await resolveConversationContext(usersId, conversationId);
    const targetAppointment = await findConversationAppointment({
      usersId,
      appointmentId,
      customerId: customerId || conversation?.customerId || "",
      petId: petId || conversation?.petId || "",
    });

    if (!targetAppointment) {
      return res.status(404).json({
        success: false,
        error: "Nao encontrei um agendamento ativo para cancelar.",
      });
    }

    const validation = evaluateControlAction(control, "cancel_appointment", {});
    const proposal = {
      appointment: mapAppointmentSummary(targetAppointment),
      validation,
      assistantReply: buildAssistantCancelReply({
        petName: conversation?.petName || "o pet",
        serviceName:
          targetAppointment?.Service?.name || "o atendimento",
        validation,
      }),
    };

    if (!normalizeBoolean(execute, false)) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: customerId || conversation?.customerId || null,
        petId: petId || conversation?.petId || null,
        appointmentId: targetAppointment.id,
        authorUserId: req.user.id,
        actionType: "cancel_appointment",
        status: "proposed",
        summary: "Proposta de cancelamento",
        assistantReply: proposal.assistantReply,
        approvalRequired: proposal.validation?.executionMode === "approval",
        approvedByHuman: normalizeBoolean(humanApproved, false),
        executed: false,
        payload: proposal,
      });
      return res.json({ success: true, data: proposal });
    }

    if (!validation.allowed) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: customerId || conversation?.customerId || null,
        petId: petId || conversation?.petId || null,
        appointmentId: targetAppointment.id,
        authorUserId: req.user.id,
        actionType: "cancel_appointment",
        status: "blocked",
        summary: "Cancelamento bloqueado",
        assistantReply: proposal.assistantReply,
        approvalRequired: proposal.validation?.executionMode === "approval",
        approvedByHuman: normalizeBoolean(humanApproved, false),
        executed: false,
        payload: proposal,
      });
      return res.status(409).json({
        success: false,
        error: "O cancelamento foi bloqueado pelas regras da IA.",
        data: proposal,
      });
    }

    if (
      validation.executionMode === "approval" &&
      !normalizeBoolean(humanApproved, false)
    ) {
      await logAiAction({
        usersId,
        conversationId: conversation?.id || null,
        customerId: customerId || conversation?.customerId || null,
        petId: petId || conversation?.petId || null,
        appointmentId: targetAppointment.id,
        authorUserId: req.user.id,
        actionType: "cancel_appointment",
        status: "waiting_approval",
        summary: "Cancelamento aguardando aprovacao",
        assistantReply: proposal.assistantReply,
        approvalRequired: true,
        approvedByHuman: false,
        executed: false,
        payload: proposal,
      });
      return res.status(409).json({
        success: false,
        error: "Esse cancelamento ainda exige aprovacao humana.",
        data: proposal,
      });
    }

    const cancelled = await cancelAppointmentFromAi({
      appointment: targetAppointment,
      usersId,
      authorUserId: req.user.id,
    });

    if (conversation) {
      await appendConversationSystemMessage({
        usersId,
        conversation,
        authorUserId: req.user.id,
        customerId: conversation.customerId || null,
        petId: conversation.petId || null,
        body: `ViaPet IA cancelou o atendimento ${targetAppointment?.Service?.name || ""} agendado para ${mapAppointmentSummary(targetAppointment)?.label}.`,
        payload: {
          action: "cancel_appointment",
          appointmentId: cancelled.appointmentId,
        },
      });
    }

    await logAiAction({
      usersId,
      conversationId: conversation?.id || null,
      customerId: customerId || conversation?.customerId || null,
      petId: petId || conversation?.petId || null,
      appointmentId: cancelled.appointmentId,
      financeId: cancelled.financeId || null,
      authorUserId: req.user.id,
      actionType: "cancel_appointment",
      status: "executed",
      summary: "Agendamento cancelado pela IA",
      assistantReply: proposal.assistantReply,
      approvalRequired: proposal.validation?.executionMode === "approval",
      approvedByHuman: normalizeBoolean(humanApproved, false),
      executed: true,
      payload: proposal,
    });

    return res.status(200).json({
      success: true,
      message: "Agendamento cancelado com sucesso pela IA.",
      data: {
        ...proposal,
        executed: true,
      },
    });
  } catch (error) {
    console.error("Erro ao cancelar agendamento pela IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao cancelar agendamento pela IA CRM",
      details: error.message,
    });
  }
});

router.post("/assistant/answer", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const crmAiAccess = await requireCrmAiAccess(usersId, res);
    if (!crmAiAccess.allowed) return;
    const {
      conversationId,
      customerId,
      petId,
      question,
    } = req.body || {};

    const conversation = await resolveConversationContext(usersId, conversationId);
    const customer = await resolveCustomerForAi(usersId, conversation, customerId);
    const pet = await resolvePetForAi(usersId, conversation, petId);
    const settings = await Settings.findOne({
      where: { usersId },
    });
    const services = await Services.findAll({
      where: { establishment: usersId },
      order: [["name", "ASC"]],
      limit: 6,
    });

    const assistantReply = buildKnowledgeReply({
      question,
      services,
      settings,
      customer,
      pet,
    });

    await logAiAction({
      usersId,
      conversationId: conversation?.id || null,
      customerId: customer?.id || null,
      petId: pet?.id || null,
      authorUserId: req.user.id,
      actionType: "answer",
      status: "proposed",
      summary: "Resposta gerada com base no sistema",
      assistantReply,
      approvalRequired: false,
      approvedByHuman: false,
      executed: false,
      payload: {
        question: String(question || "").trim(),
      },
    });

    return res.json({
      success: true,
      data: {
        question: String(question || "").trim(),
        assistantReply,
        customer: customer
          ? { id: customer.id, name: customer.name, phone: customer.phone }
          : null,
        pet: pet
          ? { id: pet.id, name: pet.name, species: pet.species }
          : null,
        serviceHighlights: services.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          price: Number(item.price || 0),
        })),
      },
    });
  } catch (error) {
    console.error("Erro ao gerar resposta da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao gerar resposta da IA CRM",
      details: error.message,
    });
  }
});

router.get("/assistant/logs", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const crmAiAccess = await requireCrmAiAccess(usersId, res);
    if (!crmAiAccess.allowed) return;
    const where = { usersId };

    if (req.query.conversationId) {
      where.conversationId = String(req.query.conversationId).trim();
    }

    if (req.query.customerId) {
      where.customerId = String(req.query.customerId).trim();
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

    const rows = await CrmAiActionLog.findAll({
      where,
      include: [
        {
          model: Users,
          as: "authorUser",
          attributes: ["id", "name", "role"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
    });

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Erro ao carregar auditoria da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao carregar auditoria da IA CRM",
      details: error.message,
    });
  }
});

router.post("/subscribe", auth, async (req, res) => {
  try {
    const user = await Users.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: "Usuario nao encontrado" });
    }

    const existing = await CrmAiSubscription.findOne({
      where: { user_id: req.user.id, status: ["pending", "active"] },
      order: [["created_at", "DESC"]],
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: "Ja existe uma assinatura ativa ou pendente da IA CRM",
      });
    }

    const id = uuidv4();
    const externalReference = `crm-ai-${id}`;
    const subscription = await CrmAiSubscription.create({
      id,
      user_id: req.user.id,
      status: "pending",
      amount: CRM_AI_PRICE,
      currency: "BRL",
      external_reference: externalReference,
      notes: "Assinatura premium da IA CRM",
    });

    const preference = await createSubscriptionPreference({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
      },
      planType: "crm_ai",
      amount: CRM_AI_PRICE,
      title: "IA CRM Premium ViaPet",
      description: "Desbloqueio da IA CRM premium dentro do ViaPet",
      itemId: "viapet-crm-ai-premium",
      externalReference,
      notificationUrl: `${process.env.API_URL}/api/crm-ai/webhook`,
      backUrls: {
        success: `${process.env.FRONTEND_URL}/crm-ai/success`,
        failure: `${process.env.FRONTEND_URL}/crm-ai/failure`,
        pending: `${process.env.FRONTEND_URL}/crm-ai/pending`,
      },
      customData: {
        feature_key: "crm_ai",
        crm_ai_subscription_id: subscription.id,
      },
    });

    if (!preference.success) {
      await subscription.destroy();
      return res.status(400).json({
        success: false,
        error: "Nao foi possivel gerar o checkout da IA CRM",
        details: preference.error,
      });
    }

    await subscription.update({ payment_preference_id: preference.id });

    return res.json({
      success: true,
      plan: getPublicPlan(),
      subscription: {
        id: subscription.id,
        status: subscription.status,
        amount: Number(subscription.amount || 0),
        currency: subscription.currency,
      },
      payment: {
        preference_id: preference.id,
        checkout_url: preference.init_point,
      },
    });
  } catch (error) {
    console.error("Erro ao criar assinatura da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao criar assinatura da IA CRM",
      details: error.message,
    });
  }
});

router.post("/cancel", auth, async (req, res) => {
  try {
    const subscription = await CrmAiSubscription.findOne({
      where: { user_id: req.user.id, status: ["pending", "active"] },
      order: [["created_at", "DESC"]],
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Nenhuma assinatura ativa ou pendente da IA CRM encontrada",
      });
    }

    await subscription.update({
      status: "cancelled",
      cancelled_at: new Date(),
    });

    return res.json({
      success: true,
      message: "Assinatura da IA CRM cancelada com sucesso.",
      subscription: {
        id: subscription.id,
        status: subscription.status,
      },
    });
  } catch (error) {
    console.error("Erro ao cancelar assinatura da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao cancelar assinatura da IA CRM",
      details: error.message,
    });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    if (!(await validateWebhookSignature(req))) {
      return res.status(401).json({ success: false, error: "Webhook invalido" });
    }

    const result = await processWebhookEvent(req.body);
    if (!result.success || !result.payment) {
      return res.status(200).json({
        success: false,
        processed: false,
        error: result.error || "Evento ignorado",
      });
    }

    const payment = result.payment;
    const metadata = payment.metadata || {};
    const subscriptionId = metadata.crm_ai_subscription_id;
    const externalReference = payment.external_reference || metadata.external_reference;

    if (!subscriptionId && !externalReference) {
      return res.status(200).json({
        success: false,
        processed: false,
        error: "Webhook sem referencia da IA CRM",
      });
    }

    const subscription = await CrmAiSubscription.findOne({
      where: subscriptionId ? { id: subscriptionId } : { external_reference: externalReference },
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Assinatura da IA CRM nao encontrada",
      });
    }

    const paymentStatus = payment.status || "pending";
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    let status = subscription.status;
    if (["approved", "authorized"].includes(paymentStatus)) status = "active";
    if (["cancelled", "rejected", "charged_back", "refunded"].includes(paymentStatus)) status = "cancelled";
    if (["pending", "in_process"].includes(paymentStatus)) status = "pending";

    await subscription.update({
      status,
      payment_status: paymentStatus,
      payment_id: String(payment.id || ""),
      activated_at: status === "active" ? new Date() : subscription.activated_at,
      next_billing_date: status === "active" ? nextBillingDate : subscription.next_billing_date,
    });

    return res.status(200).json({
      success: true,
      processed: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        payment_status: subscription.payment_status,
      },
    });
  } catch (error) {
    console.error("Erro no webhook da IA CRM:", error);
    return res.status(200).json({
      success: false,
      processed: false,
      error: error.message,
    });
  }
});

export default router;
