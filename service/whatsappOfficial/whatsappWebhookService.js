import crypto from "crypto";
import WhatsappWebhookLog from "../../models/WhatsappWebhookLog.js";
import {
  getConnectionByPhoneNumberId,
  resolveVerifyToken,
  upsertConnectionForCompany,
} from "./whatsappConnectionService.js";
import { normalizePhone, toDateFromUnix } from "./phone.js";
import { resolveCustomerAndPet } from "./whatsappContactResolverService.js";
import {
  appendInboundMessage,
  findOrCreateConversation,
} from "./crmConversationService.js";
import {
  createWhatsappMessage,
  updateMessageDeliveryStatus,
} from "./whatsappMessageService.js";

function getNested(payload, path, fallback = undefined) {
  const segments = Array.isArray(path) ? path : String(path || "").split(".");
  let cursor = payload;
  for (const key of segments) {
    if (cursor == null || typeof cursor !== "object") return fallback;
    cursor = cursor[key];
  }
  return cursor === undefined ? fallback : cursor;
}

export function parseWebhookPayload(payload = {}) {
  const events = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      const phoneNumberId = String(metadata?.phone_number_id || "").trim();
      const displayPhone = String(metadata?.display_phone_number || "").trim();
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

      for (const message of messages) {
        const firstContact = contacts[0] || {};
        const from = normalizePhone(message?.from);
        const name = String(firstContact?.profile?.name || "").trim();
        const type = String(message?.type || "text").trim().toLowerCase();
        const textBody = String(message?.text?.body || "").trim();
        const imageCaption = String(message?.image?.caption || "").trim();
        const docCaption = String(message?.document?.caption || "").trim();
        const interactiveTitle =
          String(getNested(message, "interactive.button_reply.title", "")).trim() ||
          String(getNested(message, "interactive.list_reply.title", "")).trim();
        const body =
          textBody ||
          imageCaption ||
          docCaption ||
          interactiveTitle ||
          `[${type}]`;
        const mediaUrl =
          message?.image?.id ||
          message?.document?.id ||
          message?.audio?.id ||
          message?.video?.id ||
          null;
        const mimeType =
          message?.image?.mime_type ||
          message?.document?.mime_type ||
          message?.audio?.mime_type ||
          message?.video?.mime_type ||
          null;

        events.push({
          kind: "message",
          eventType: "message",
          phoneNumberId,
          displayPhone,
          messageId: String(message?.id || "").trim() || null,
          from,
          contactName: name,
          messageType: type,
          body,
          mediaUrl,
          mimeType,
          timestamp: toDateFromUnix(message?.timestamp),
          payload: {
            entry,
            change,
            value,
            message,
            contacts,
          },
        });
      }

      for (const statusRow of statuses) {
        events.push({
          kind: "status",
          eventType: "status",
          phoneNumberId,
          displayPhone,
          metaMessageId: String(statusRow?.id || "").trim() || null,
          status: String(statusRow?.status || "").trim().toLowerCase() || "sent",
          recipientId: normalizePhone(statusRow?.recipient_id),
          timestamp: toDateFromUnix(statusRow?.timestamp),
          payload: {
            entry,
            change,
            value,
            status: statusRow,
          },
        });
      }
    }
  }

  return events;
}

export async function isValidWebhookVerifyToken(tokenValue = "") {
  const normalized = String(tokenValue || "").trim();
  if (!normalized) return false;
  if (normalized === String(process.env.WHATSAPP_VERIFY_TOKEN || "genius").trim()) {
    return true;
  }

  // fallback match by cached connection tokens
  // if no direct company context exists at verification time.
  const matches = await (await import("../../models/WhatsappConnection.js")).default.count({
    where: {
      verifyToken: normalized,
    },
  });
  return matches > 0;
}

export function isValidWebhookSignature(req) {
  const appSecret = String(process.env.META_APP_SECRET || "").trim();
  if (!appSecret) return true;
  const signature = String(req?.headers?.["x-hub-signature-256"] || "").trim();
  if (!signature.startsWith("sha256=")) return false;

  const rawBody =
    req?.rawBody ||
    Buffer.from(JSON.stringify(req?.body || {}), "utf8");
  const expected = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function markWebhookLog(logId, updates = {}) {
  if (!logId) return;
  await WhatsappWebhookLog.update(updates, { where: { id: logId } }).catch(() => {});
}

export async function processWebhookPayload(payload = {}) {
  const events = parseWebhookPayload(payload);
  if (!events.length) {
    await WhatsappWebhookLog.create({
      payloadJson: payload || {},
      eventType: "empty",
      logType: "webhook",
      description: "Webhook recebido sem eventos processaveis.",
      processed: true,
    });
    return { events: 0 };
  }

  let processedEvents = 0;
  for (const event of events) {
    const webhookLog = await WhatsappWebhookLog.create({
      payloadJson: event.payload || {},
      eventType: event.eventType || "unknown",
      logType: "webhook",
      description: `Evento ${event.eventType || "unknown"} recebido da Meta.`,
      processed: false,
    });

    try {
      const resolved = await getConnectionByPhoneNumberId(event.phoneNumberId);
      if (!resolved?.connection?.companyId) {
        await markWebhookLog(webhookLog.id, {
          processed: false,
          errorMessage: `phone_number_id nao encontrado: ${event.phoneNumberId || "-"}`,
        });
        continue;
      }

      const companyId = resolved.connection.companyId;
      await markWebhookLog(webhookLog.id, {
        companyId,
        usersId: companyId,
      });

      if (event.kind === "message") {
        const { customer, pet } = await resolveCustomerAndPet({
          companyId,
          fromPhone: event.from,
        });
        const conversation = await findOrCreateConversation({
          companyId,
          phone: event.from,
          customer,
          pet,
          contactName: event.contactName,
        });

        await appendInboundMessage({
          companyId,
          conversation,
          customer,
          pet,
          messageType: event.messageType,
          body: event.body,
          mediaUrl: event.mediaUrl,
          mimeType: event.mimeType,
          providerMessageId: event.messageId,
          status: "received",
          payload: event.payload || {},
          eventDate: event.timestamp,
        });

        await createWhatsappMessage({
          companyId,
          conversationId: conversation.id,
          customerId: customer?.id || null,
          petId: pet?.id || null,
          phone: event.from,
          metaMessageId: event.messageId,
          direction: "inbound",
          origin: "api",
          messageType: event.messageType,
          body: event.body,
          mediaUrl: event.mediaUrl,
          mimeType: event.mimeType,
          status: "received",
          rawPayload: event.payload || {},
          sentAt: null,
        });
      } else if (event.kind === "status") {
        await updateMessageDeliveryStatus({
          metaMessageId: event.metaMessageId,
          status: event.status,
          rawPayload: event.payload || {},
          eventDate: event.timestamp,
        });
      }

      await upsertConnectionForCompany(companyId, {
        phoneNumberId: event.phoneNumberId,
        businessPhone: event.displayPhone || resolved.connection.businessPhone,
        webhookVerified: true,
        status: "connected",
        lastEventAt: event.timestamp || new Date(),
        lastError: null,
        metadata: {
          ...(resolved.connection.metadata || {}),
          lastEventType: event.eventType,
        },
      });

      processedEvents += 1;
      await markWebhookLog(webhookLog.id, { processed: true, errorMessage: null });
    } catch (error) {
      await markWebhookLog(webhookLog.id, {
        processed: false,
        errorMessage: error?.message || "Erro no processamento do webhook",
      });
    }
  }

  return { events: processedEvents };
}

export function buildWebhookChallengeResponse(req) {
  const mode = String(req.query["hub.mode"] || "").trim();
  const token = String(req.query["hub.verify_token"] || "").trim();
  const challenge = String(req.query["hub.challenge"] || "").trim();
  return { mode, token, challenge };
}

export function resolveWebhookStatusForConnection(connection = null) {
  return {
    verifyToken: resolveVerifyToken(connection),
    webhookVerified: Boolean(connection?.webhookVerified),
  };
}
