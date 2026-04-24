import axios from "axios";
import { getConnectionByCompany } from "./whatsappConnectionService.js";
import { normalizePhone } from "./phone.js";
import { appendOutboundMessage, findOrCreateConversation } from "./crmConversationService.js";
import { createWhatsappMessage } from "./whatsappMessageService.js";
import { resolveCustomerAndPet } from "./whatsappContactResolverService.js";

function buildApiBase(phoneNumberId) {
  return `https://graph.facebook.com/v21.0/${phoneNumberId}`;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function sendTextMessage({
  companyId,
  to,
  body,
  conversationId = null,
}) {
  const { connection, accessToken } = await getConnectionByCompany(companyId);
  if (!connection?.phoneNumberId || !accessToken) {
    throw new Error("Conexao oficial do WhatsApp nao configurada para esta empresa");
  }

  const destination = normalizePhone(to);
  if (!destination) throw new Error("Telefone de destino invalido");

  const response = await axios.post(
    `${buildApiBase(connection.phoneNumberId)}/messages`,
    {
      messaging_product: "whatsapp",
      to: destination,
      type: "text",
      text: { body: String(body || "").trim() },
    },
    { headers: authHeaders(accessToken) },
  );

  const metaMessageId = response?.data?.messages?.[0]?.id || null;
  const { customer, pet } = await resolveCustomerAndPet({
    companyId,
    fromPhone: destination,
  });
  const conversation = await findOrCreateConversation({
    companyId,
    phone: destination,
    customer,
    pet,
    contactName: customer?.name || destination,
  });

  if (conversationId && String(conversation.id) !== String(conversationId)) {
    // keep existing conversation selected by user if provided
    conversation.id = conversationId;
  }

  await appendOutboundMessage({
    companyId,
    conversation,
    body: String(body || "").trim(),
    messageType: "text",
    providerMessageId: metaMessageId,
    payload: response.data || {},
    sentAt: new Date(),
  });

  await createWhatsappMessage({
    companyId,
    conversationId: conversation.id,
    customerId: customer?.id || null,
    petId: pet?.id || null,
    metaMessageId,
    direction: "outbound",
    messageType: "text",
    body: String(body || "").trim(),
    status: "sent",
    rawPayload: response.data || {},
    sentAt: new Date(),
  });

  return {
    conversationId: conversation.id,
    metaMessageId,
    raw: response.data || {},
  };
}

export async function sendTemplateMessage({
  companyId,
  to,
  templateName,
  language = "pt_BR",
  components = [],
  conversationId = null,
}) {
  const { connection, accessToken } = await getConnectionByCompany(companyId);
  if (!connection?.phoneNumberId || !accessToken) {
    throw new Error("Conexao oficial do WhatsApp nao configurada para esta empresa");
  }

  const destination = normalizePhone(to);
  if (!destination) throw new Error("Telefone de destino invalido");

  const response = await axios.post(
    `${buildApiBase(connection.phoneNumberId)}/messages`,
    {
      messaging_product: "whatsapp",
      to: destination,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(Array.isArray(components) && components.length ? { components } : {}),
      },
    },
    { headers: authHeaders(accessToken) },
  );

  const metaMessageId = response?.data?.messages?.[0]?.id || null;
  const { customer, pet } = await resolveCustomerAndPet({
    companyId,
    fromPhone: destination,
  });
  const conversation = await findOrCreateConversation({
    companyId,
    phone: destination,
    customer,
    pet,
    contactName: customer?.name || destination,
  });
  if (conversationId && String(conversation.id) !== String(conversationId)) {
    conversation.id = conversationId;
  }

  await appendOutboundMessage({
    companyId,
    conversation,
    body: `[template] ${templateName}`,
    messageType: "template",
    providerMessageId: metaMessageId,
    payload: response.data || {},
    sentAt: new Date(),
  });

  await createWhatsappMessage({
    companyId,
    conversationId: conversation.id,
    customerId: customer?.id || null,
    petId: pet?.id || null,
    metaMessageId,
    direction: "outbound",
    messageType: "template",
    body: `[template] ${templateName}`,
    status: "sent",
    rawPayload: response.data || {},
    sentAt: new Date(),
  });

  return {
    conversationId: conversation.id,
    metaMessageId,
    raw: response.data || {},
  };
}
