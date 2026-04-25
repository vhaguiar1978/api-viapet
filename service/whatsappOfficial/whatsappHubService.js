import { Op } from "sequelize";
import Appointment from "../../models/Appointment.js";
import CrmConversation from "../../models/CrmConversation.js";
import CrmConversationMessage from "../../models/CrmConversationMessage.js";
import Custumers from "../../models/Custumers.js";
import Finance from "../../models/Finance.js";
import Pets from "../../models/Pets.js";
import Users from "../../models/Users.js";
import WhatsappConnection from "../../models/WhatsappConnection.js";
import WhatsappWebhookLog from "../../models/WhatsappWebhookLog.js";
import { appendOutboundMessage, findOrCreateConversation } from "./crmConversationService.js";
import { createWhatsappMessage } from "./whatsappMessageService.js";
import { DEFAULT_TEMPLATE_VARIABLES, listTemplates } from "./whatsappTemplateService.js";
import { normalizePhone } from "./phone.js";

function formatCurrencyBr(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDateBr(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, 5);
}

function safeText(value) {
  return String(value || "").trim();
}

export async function createTechnicalLog(companyId, payload = {}) {
  return WhatsappWebhookLog.create({
    companyId: companyId || null,
    usersId: companyId || null,
    payloadJson: payload.payload || {},
    eventType: payload.eventType || "manual",
    logType: payload.logType || "action",
    description: payload.description || null,
    processed: payload.processed !== undefined ? Boolean(payload.processed) : true,
    errorMessage: payload.errorMessage || null,
  });
}

async function loadContextEntities(companyId, options = {}) {
  const {
    customerId = null,
    petId = null,
    appointmentId = null,
    financeId = null,
  } = options;

  const company = await Users.findByPk(companyId, {
    attributes: ["id", "name", "phone"],
  });

  const appointment = appointmentId
    ? await Appointment.findOne({
        where: {
          id: appointmentId,
          usersId: companyId,
        },
      })
    : null;

  const finance = financeId || appointment?.financeId
    ? await Finance.findOne({
        where: {
          id: financeId || appointment?.financeId,
          usersId: companyId,
        },
      })
    : null;

  let customer = customerId
    ? await Custumers.findOne({
        where: {
          id: customerId,
          usersId: companyId,
        },
      })
    : null;

  let pet = petId
    ? await Pets.findOne({
        where: {
          id: petId,
          usersId: companyId,
        },
      })
    : null;

  if (!customer && appointment?.customerId) {
    customer = await Custumers.findOne({
      where: {
        id: appointment.customerId,
        usersId: companyId,
      },
    });
  }

  if (!pet && appointment?.petId) {
    pet = await Pets.findOne({
      where: {
        id: appointment.petId,
        usersId: companyId,
      },
    });
  }

  if (!customer && pet?.custumerId) {
    customer = await Custumers.findOne({
      where: {
        id: pet.custumerId,
        usersId: companyId,
      },
    });
  }

  return {
    company,
    customer,
    pet,
    appointment,
    finance,
  };
}

export async function buildTemplateContext(companyId, payload = {}) {
  const entities = await loadContextEntities(companyId, payload);
  const rawValue =
    payload.value ??
    entities.finance?.netAmount ??
    entities.finance?.amount ??
    entities.appointment?.amount ??
    null;

  return {
    entities,
    values: {
      "{nome_cliente}":
        safeText(payload.customerName) ||
        safeText(entities.customer?.name),
      "{nome_pet}":
        safeText(payload.petName) ||
        safeText(entities.pet?.name),
      "{data_agendamento}":
        safeText(payload.appointmentDate) ||
        formatDateBr(entities.appointment?.date),
      "{hora_agendamento}":
        safeText(payload.appointmentTime) ||
        normalizeTime(entities.appointment?.time),
      "{valor}":
        rawValue !== null && rawValue !== undefined
          ? formatCurrencyBr(rawValue)
          : "",
      "{nome_empresa}":
        safeText(payload.companyName) ||
        safeText(entities.company?.name),
    },
  };
}

export function renderTemplateBody(templateBody = "", context = {}) {
  let result = String(templateBody || "");
  for (const variable of DEFAULT_TEMPLATE_VARIABLES) {
    const safeValue = safeText(context?.[variable]);
    result = result.split(variable).join(safeValue);
  }
  return result.trim();
}

export async function launchSimpleWhatsapp(companyId, payload = {}) {
  const contextResult = await buildTemplateContext(companyId, payload);
  const { entities, values } = contextResult;
  const phone = normalizePhone(
    payload.phone ||
      entities.customer?.phone ||
      payload.customerPhone ||
      "",
  );

  if (!phone) {
    throw new Error("Telefone do cliente nao encontrado para abrir o WhatsApp.");
  }

  const renderedMessage = renderTemplateBody(payload.message || "", values);
  const templateName = safeText(payload.templateName || "");
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(renderedMessage)}`;
  const conversation = await findOrCreateConversation({
    companyId,
    phone,
    customer: entities.customer,
    pet: entities.pet,
    contactName: entities.customer?.name || values["{nome_cliente}"] || phone,
    source: "whatsapp-link",
  });

  await appendOutboundMessage({
    companyId,
    conversation,
    body: renderedMessage || "[link] Conversa iniciada no WhatsApp",
    messageType: "text",
    payload: {
      mode: "simple",
      launchContext: payload.originContext || "manual",
      templateName,
    },
    sentAt: new Date(),
  });

  await createWhatsappMessage({
    companyId,
    conversationId: conversation.id,
    customerId: entities.customer?.id || null,
    petId: entities.pet?.id || null,
    phone,
    direction: "outbound",
    origin: "link",
    messageType: "text",
    templateName: templateName || null,
    body: renderedMessage,
    status: "initiated",
    rawPayload: {
      mode: "simple",
      originContext: payload.originContext || "manual",
      waUrl: url,
    },
    sentAt: new Date(),
  });

  await createTechnicalLog(companyId, {
    logType: "simple-launch",
    eventType: "simple_launch",
    description: `Acao de WhatsApp simples iniciada para ${phone}.`,
    payload: {
      phone,
      conversationId: conversation.id,
      templateName,
      originContext: payload.originContext || "manual",
      message: renderedMessage,
      url,
    },
  });

  return {
    url,
    phone,
    message: renderedMessage,
    conversationId: conversation.id,
    values,
  };
}

export async function listWhatsappActivity(companyId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 30), 1), 200);
  const messages = await CrmConversationMessage.findAll({
    where: {
      usersId: companyId,
      channel: "whatsapp",
    },
    order: [["createdAt", "DESC"]],
    limit,
  });

  const conversationIds = Array.from(
    new Set(messages.map((message) => message.conversationId).filter(Boolean)),
  );
  const conversations = conversationIds.length
    ? await CrmConversation.findAll({
        where: {
          id: {
            [Op.in]: conversationIds,
          },
          usersId: companyId,
        },
        order: [["lastMessageAt", "DESC"]],
      })
    : [];

  const byConversationId = new Map(
    conversations.map((conversation) => [String(conversation.id), conversation]),
  );

  return messages.map((message) => {
    const conversation = byConversationId.get(String(message.conversationId)) || null;
    return {
      id: message.id,
      conversationId: message.conversationId,
      customerName:
        conversation?.customerName || conversation?.title || "Contato",
      petName: conversation?.petName || "",
      phone: conversation?.phone || "",
      direction: message.direction,
      origin:
        message?.payload?.mode === "simple" || conversation?.source === "whatsapp-link"
          ? "link"
          : "api",
      status: message.status,
      messageType: message.messageType,
      message: message.body || "",
      lastAt: message.sentAt || message.receivedAt || message.createdAt,
      stage: conversation?.stage || "prospectar",
      source: conversation?.source || "crm",
      assignedUserId: conversation?.assignedUserId || null,
    };
  });
}

export async function listWhatsappInbox(companyId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 40), 1), 200);
  const rows = await CrmConversation.findAll({
    where: {
      usersId: companyId,
      channel: "whatsapp",
      isArchived: false,
    },
    order: [["lastMessageAt", "DESC"]],
    limit,
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title || row.customerName || "Contato",
    customerName: row.customerName || "",
    petName: row.petName || "",
    phone: row.phone || "",
    lastMessagePreview: row.lastMessagePreview || "",
    lastMessageAt: row.lastMessageAt || null,
    status: row.status,
    stage: row.stage,
    unreadCount: Number(row.unreadCount || 0),
    source: row.source || "crm",
    assignedUserId: row.assignedUserId || null,
  }));
}

export async function listRecentWhatsappLogs(companyId, limit = 20) {
  const rows = await WhatsappWebhookLog.findAll({
    where: {
      [Op.or]: [
        { companyId },
        { usersId: companyId },
      ],
    },
    order: [["createdAt", "DESC"]],
    limit: Math.min(Math.max(Number(limit || 20), 1), 100),
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.logType || row.eventType || "evento",
    eventType: row.eventType || "unknown",
    description: row.description || row.errorMessage || "",
    processed: Boolean(row.processed),
    errorMessage: row.errorMessage || "",
    createdAt: row.createdAt,
  }));
}

export async function buildWhatsappHubOverview(companyId) {
  const [connection, templates, activity, inbox, logs] = await Promise.all([
    WhatsappConnection.findOne({
      where: { companyId },
      order: [["updatedAt", "DESC"]],
    }),
    listTemplates(companyId),
    listWhatsappActivity(companyId, { limit: 40 }),
    listWhatsappInbox(companyId, { limit: 20 }),
    listRecentWhatsappLogs(companyId, 20),
  ]);

  return {
    connection,
    templates,
    activity,
    inbox,
    logs,
  };
}
