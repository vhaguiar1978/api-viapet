import { Op } from "sequelize";
import WhatsappMessage from "../../models/WhatsappMessage.js";
import CrmConversationMessage from "../../models/CrmConversationMessage.js";

export async function createWhatsappMessage({
  companyId,
  conversationId = null,
  customerId = null,
  petId = null,
  phone = "",
  metaMessageId = null,
  externalMessageId = null,
  direction = "inbound",
  origin = "api",
  messageType = "text",
  templateName = null,
  body = "",
  mediaUrl = null,
  mimeType = null,
  status = "received",
  errorMessage = null,
  rawPayload = {},
  sentAt = null,
}) {
  return WhatsappMessage.create({
    companyId,
    usersId: companyId,
    conversationId,
    customerId,
    petId,
    phone: phone || null,
    metaMessageId,
    externalMessageId: externalMessageId || metaMessageId,
    direction,
    origin,
    messageType,
    templateName,
    body: body || null,
    mediaUrl,
    mimeType,
    status,
    errorMessage,
    rawPayload,
    sentAt,
  });
}

export async function findWhatsappMessageByMetaId(metaMessageId = "") {
  const normalized = String(metaMessageId || "").trim();
  if (!normalized) return null;
  return WhatsappMessage.findOne({
    where: { metaMessageId: normalized },
    order: [["createdAt", "DESC"]],
  });
}

export async function updateMessageDeliveryStatus({
  metaMessageId,
  status,
  rawPayload = {},
  eventDate = new Date(),
}) {
  const message = await findWhatsappMessageByMetaId(metaMessageId);
  if (!message) return null;

  const now = eventDate || new Date();
  const next = {
    status: String(status || message.status || "sent"),
    rawPayload,
  };

  if (next.status === "sent") next.sentAt = now;
  if (next.status === "delivered") next.deliveredAt = now;
  if (next.status === "read") next.readAt = now;
  if (next.status === "failed") next.failedAt = now;

  await message.update(next);

  await CrmConversationMessage.update(
    {
      status: next.status,
      readAt: next.status === "read" ? now : undefined,
      errorMessage:
        next.status === "failed"
          ? String(rawPayload?.errors?.[0]?.title || rawPayload?.errors?.[0]?.message || "Falha no envio")
          : null,
      payload: rawPayload,
    },
    {
      where: {
        [Op.and]: [
          { usersId: message.companyId },
          { providerMessageId: String(metaMessageId || "").trim() },
        ],
      },
    },
  );

  return message;
}
