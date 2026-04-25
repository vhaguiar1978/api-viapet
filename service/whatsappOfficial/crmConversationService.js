import CrmConversation from "../../models/CrmConversation.js";
import CrmConversationMessage from "../../models/CrmConversationMessage.js";
import { normalizePhone } from "./phone.js";
import { buildProvisionalLeadName } from "./whatsappContactResolverService.js";

export async function findOrCreateConversation({
  companyId,
  phone,
  customer = null,
  pet = null,
  contactName = "",
  stage = "prospectar",
  source = "whatsapp-cloud-api",
}) {
  const normalizedPhone = normalizePhone(phone);
  let conversation = null;

  if (customer?.id) {
    conversation = await CrmConversation.findOne({
      where: {
        companyId,
        customerId: customer.id,
        isArchived: false,
      },
      order: [["lastMessageAt", "DESC"]],
    });
  }

  if (!conversation && normalizedPhone) {
    conversation = await CrmConversation.findOne({
      where: {
        companyId,
        phone: normalizedPhone,
        isArchived: false,
      },
      order: [["lastMessageAt", "DESC"]],
    });
  }

  const title = customer?.name
    || pet?.name
    || buildProvisionalLeadName(contactName, normalizedPhone);

  if (!conversation) {
    conversation = await CrmConversation.create({
      usersId: companyId,
      companyId,
      customerId: customer?.id || null,
      petId: pet?.id || null,
      phone: normalizedPhone,
      channel: "whatsapp",
      source,
      status: "pending",
      stage,
      title,
      customerName: customer?.name || buildProvisionalLeadName(contactName, normalizedPhone),
      petName: pet?.name || null,
      unreadCount: 0,
      metadata: {
        hooks: {
          aiReady: true,
          agendaReady: true,
          financeReady: true,
        },
      },
    });
  } else {
    await conversation.update({
      usersId: companyId,
      companyId,
      customerId: customer?.id || conversation.customerId,
      petId: pet?.id || conversation.petId,
      customerName:
        customer?.name || conversation.customerName || buildProvisionalLeadName(contactName, normalizedPhone),
      petName: pet?.name || conversation.petName,
      phone: normalizedPhone || conversation.phone,
      stage: conversation.stage || stage,
      source: conversation.source || source,
    });
  }

  return conversation;
}

export async function appendInboundMessage({
  companyId,
  conversation,
  customer = null,
  pet = null,
  messageType = "text",
  body = "",
  mediaUrl = null,
  mimeType = null,
  providerMessageId = null,
  status = "received",
  payload = {},
  eventDate = new Date(),
}) {
  const now = eventDate || new Date();
  const created = await CrmConversationMessage.create({
    conversationId: conversation.id,
    usersId: companyId,
    companyId,
    customerId: customer?.id || conversation.customerId || null,
    petId: pet?.id || conversation.petId || null,
    direction: "inbound",
    channel: "whatsapp",
    messageType,
    body: body || null,
    mediaUrl,
    mimeType,
    providerMessageId,
    status,
    receivedAt: now,
    payload,
  });

  await conversation.update({
    lastMessageAt: now,
    lastInboundAt: now,
    lastMessagePreview: body || `[${messageType}]`,
    unreadCount: Number(conversation.unreadCount || 0) + 1,
    status: conversation.status === "closed" ? "pending" : conversation.status,
  });

  return created;
}

export async function appendOutboundMessage({
  companyId,
  conversation,
  body = "",
  messageType = "text",
  mediaUrl = null,
  mimeType = null,
  providerMessageId = null,
  payload = {},
  sentAt = new Date(),
}) {
  const created = await CrmConversationMessage.create({
    conversationId: conversation.id,
    usersId: companyId,
    companyId,
    customerId: conversation.customerId || null,
    petId: conversation.petId || null,
    direction: "outbound",
    channel: "whatsapp",
    messageType,
    body: body || null,
    mediaUrl,
    mimeType,
    providerMessageId,
    status: "sent",
    sentAt,
    payload,
  });

  await conversation.update({
    lastMessageAt: sentAt,
    lastOutboundAt: sentAt,
    lastMessagePreview: body || `[${messageType}]`,
    unreadCount: 0,
    status: "attending",
  });

  return created;
}
