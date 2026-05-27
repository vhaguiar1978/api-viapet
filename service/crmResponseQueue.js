import { Op } from "sequelize";
import axios from "axios";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import CrmResponseJob from "../models/CrmResponseJob.js";
import Custumers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import Settings from "../models/Settings.js";
import { generateAutoReply } from "./crmAutoReply.js";

const DEBOUNCE_MS = 6000;
const RETRY_MINUTES = [1, 5, 15];
const ACTIVE_STATUSES = ["pending", "retry"];
const MEDIA_PLACEHOLDER = /^\[(audio|image|video|document|sticker|unknown)\]$/i;

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

async function flagConversationForAttention(conversation, reason, job) {
  const metadata = conversation.metadata && typeof conversation.metadata === "object"
    ? conversation.metadata
    : {};

  await conversation.update({
    status: conversation.status === "closed" ? "pending" : conversation.status,
    metadata: {
      ...metadata,
      responseAttention: {
        reason,
        jobId: job.id,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

async function clearConversationAttention(conversation, jobId) {
  const metadata = conversation.metadata && typeof conversation.metadata === "object"
    ? conversation.metadata
    : {};
  if (metadata.responseAttention?.jobId !== jobId) return;
  const { responseAttention, ...nextMetadata } = metadata;
  await conversation.update({ metadata: nextMetadata });
}

export async function enqueueInboundResponseJob({
  usersId,
  conversation,
  inboundMessage,
  sourceChannel = "official",
  phone = "",
  targetJid = "",
}) {
  if (!usersId || !conversation?.id || !inboundMessage?.id) return null;

  const [job] = await CrmResponseJob.findOrCreate({
    where: { inboundMessageId: inboundMessage.id },
    defaults: {
      usersId,
      conversationId: conversation.id,
      inboundMessageId: inboundMessage.id,
      providerMessageId: inboundMessage.providerMessageId || null,
      sourceChannel,
      messageType: inboundMessage.messageType || "text",
      dueAt: new Date(Date.now() + DEBOUNCE_MS),
      metadata: { phone, targetJid },
    },
  });

  return job;
}

async function sendBaileysReply({ job, conversation, customer, reply }) {
  const { default: BaileysService } = await import("./baileys.js");
  const instance = BaileysService.getInstance(job.usersId, "default");
  const destination =
    job.metadata?.targetJid ||
    conversation.metadata?.baileysJid ||
    conversation.phone;
  if (!destination) throw new Error("Destino Baileys nao encontrado para resposta");

  const sendResult = await instance.sendMessage(destination, reply);
  await CrmConversationMessage.create({
    conversationId: conversation.id,
    usersId: job.usersId,
    customerId: customer?.id || conversation.customerId || null,
    petId: conversation.petId || null,
    direction: "outbound",
    channel: "baileys",
    messageType: "text",
    body: reply,
    providerMessageId: sendResult?.key?.id || `baileys_ai_${Date.now()}`,
    status: "sent",
    sentAt: new Date(),
    payload: { source: "crm_response_queue", responseJobId: job.id },
  });
  await conversation.update({
    lastMessagePreview: reply.substring(0, 100),
    lastMessageAt: new Date(),
    lastOutboundAt: new Date(),
    status: "attending",
  });
}

async function sendOfficialReply({ job, conversation, reply }) {
  const { sendTextMessage } = await import("./whatsappOfficial/whatsappSendService.js");
  const phone = job.metadata?.phone || conversation.phone;
  if (!phone) throw new Error("Telefone nao encontrado para resposta oficial");
  await sendTextMessage({
    companyId: job.usersId,
    to: phone,
    body: reply,
    conversationId: conversation.id,
  });
}

async function sendLegacyCloudReply({ job, conversation, customer, reply }) {
  const settings = await Settings.findOne({ where: { usersId: job.usersId } });
  const config = settings?.whatsappConnection || {};
  const phoneNumberId = config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const token = config.accessToken || process.env.WHATSAPP_TOKEN || "";
  const phone = job.metadata?.phone || conversation.phone;
  if (!phoneNumberId || !token || !phone) {
    throw new Error("WhatsApp Cloud API legado nao configurado para resposta automatica");
  }

  const response = await axios.post(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: String(phone).replace(/\D/g, ""),
      type: "text",
      text: { body: reply },
    },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
  );
  await CrmConversationMessage.create({
    conversationId: conversation.id,
    usersId: job.usersId,
    customerId: customer?.id || conversation.customerId || null,
    petId: conversation.petId || null,
    direction: "outbound",
    channel: "whatsapp",
    messageType: "text",
    body: reply,
    providerMessageId: response?.data?.messages?.[0]?.id || null,
    status: "sent",
    sentAt: new Date(),
    payload: { source: "crm_response_queue", responseJobId: job.id },
  });
  await conversation.update({
    lastMessagePreview: reply.substring(0, 100),
    lastMessageAt: new Date(),
    lastOutboundAt: new Date(),
    status: "attending",
  });
}

async function processResponseJob(job) {
  const attemptNumber = Number(job.attempts || 0) + 1;
  const claimed = await CrmResponseJob.update(
    {
      status: "processing",
      lockedAt: new Date(),
      lastAttemptAt: new Date(),
      attempts: attemptNumber,
    },
    {
      where: {
        id: job.id,
        usersId: job.usersId,
        status: { [Op.in]: ACTIVE_STATUSES },
      },
    },
  );
  if (!Number(claimed?.[0] || 0)) return;

  try {
    const [conversation, inbound] = await Promise.all([
      CrmConversation.findOne({
        where: { id: job.conversationId, usersId: job.usersId },
      }),
      CrmConversationMessage.findOne({
        where: {
          id: job.inboundMessageId,
          conversationId: job.conversationId,
          usersId: job.usersId,
          direction: "inbound",
        },
      }),
    ]);

    if (!conversation || !inbound) {
      await CrmResponseJob.update(
        { status: "failed", lastError: "Conversa ou mensagem recebida nao encontrada." },
        { where: { id: job.id, usersId: job.usersId } },
      );
      return;
    }

    const outbound = await CrmConversationMessage.findOne({
      where: {
        conversationId: conversation.id,
        usersId: job.usersId,
        direction: "outbound",
        createdAt: { [Op.gte]: inbound.createdAt },
      },
    });
    if (outbound) {
      await CrmResponseJob.update(
        { status: "answered", answeredAt: outbound.createdAt, lastError: null },
        { where: { id: job.id, usersId: job.usersId } },
      );
      await clearConversationAttention(conversation, job.id);
      return;
    }

    const newerInbound = await CrmConversationMessage.findOne({
      where: {
        conversationId: conversation.id,
        usersId: job.usersId,
        direction: "inbound",
        createdAt: { [Op.gt]: inbound.createdAt },
      },
    });
    if (newerInbound) {
      await CrmResponseJob.update(
        { status: "skipped", lastError: "Agrupada com mensagem posterior do cliente." },
        { where: { id: job.id, usersId: job.usersId } },
      );
      return;
    }

    const body = String(inbound.body || "").trim();
    const needsMediaInterpretation = inbound.messageType !== "text" && (!body || MEDIA_PLACEHOLDER.test(body));
    if (needsMediaInterpretation) {
      await CrmResponseJob.update(
        { status: "waiting_human", lastError: "Midia recebida requer leitura ou transcricao." },
        { where: { id: job.id, usersId: job.usersId } },
      );
      await flagConversationForAttention(conversation, "media_requires_review", job);
      return;
    }

    const customer = conversation.customerId
      ? await Custumers.findOne({ where: { id: conversation.customerId, usersId: job.usersId } })
      : null;
    const pets = customer?.id
      ? await Pets.findAll({
          where: { usersId: job.usersId, custumerId: customer.id },
          attributes: ["id", "name", "species", "breed", "sex", "birthdate"],
          limit: 10,
        })
      : [];
    const result = await generateAutoReply({
      usersId: job.usersId,
      conversation,
      customer,
      pet: pets[0] || null,
      pets,
      body,
    });

    if (!result?.replied || !result.reply) {
      await CrmResponseJob.update(
        { status: "waiting_human", lastError: result?.reason || "IA nao respondeu automaticamente." },
        { where: { id: job.id, usersId: job.usersId } },
      );
      await flagConversationForAttention(conversation, result?.reason || "manual_reply_required", job);
      return;
    }

    if (job.sourceChannel === "baileys") {
      await sendBaileysReply({ job, conversation, customer, reply: result.reply });
    } else if (job.sourceChannel === "legacy") {
      await sendLegacyCloudReply({ job, conversation, customer, reply: result.reply });
    } else {
      await sendOfficialReply({ job, conversation, reply: result.reply });
    }

    await CrmResponseJob.update(
      { status: "answered", answeredAt: new Date(), lastError: null },
      { where: { id: job.id, usersId: job.usersId } },
    );
    await clearConversationAttention(conversation, job.id);
  } catch (error) {
    const shouldRetry = attemptNumber < Number(job.maxAttempts || 3);
    const retryAfter = RETRY_MINUTES[Math.min(attemptNumber - 1, RETRY_MINUTES.length - 1)];
    await CrmResponseJob.update(
      {
        status: shouldRetry ? "retry" : "failed",
        dueAt: shouldRetry ? addMinutes(new Date(), retryAfter) : job.dueAt,
        lastError: error?.message || "Falha ao processar resposta automatica.",
      },
      { where: { id: job.id, usersId: job.usersId } },
    );

    if (!shouldRetry) {
      const conversation = await CrmConversation.findOne({
        where: { id: job.conversationId, usersId: job.usersId },
      });
      if (conversation) await flagConversationForAttention(conversation, "automatic_reply_failed", job);
    }
    console.error("[CRM RESPONSE QUEUE] Falha ao processar job:", error?.message || error);
  }
}

export async function processPendingResponseJobs({ limit = 20 } = {}) {
  await CrmResponseJob.update(
    {
      status: "retry",
      dueAt: new Date(),
      lockedAt: null,
      lastError: "Processamento interrompido; nova tentativa automatica iniciada.",
    },
    {
      where: {
        status: "processing",
        lockedAt: { [Op.lt]: new Date(Date.now() - 5 * 60 * 1000) },
      },
    },
  );

  const jobs = await CrmResponseJob.findAll({
    where: {
      status: { [Op.in]: ACTIVE_STATUSES },
      dueAt: { [Op.lte]: new Date() },
    },
    order: [["dueAt", "ASC"]],
    limit,
  });

  for (const job of jobs) {
    await processResponseJob(job);
  }

  return jobs.length;
}

export async function retryResponseJob({ usersId, jobId }) {
  const [updated] = await CrmResponseJob.update(
    {
      status: "retry",
      dueAt: new Date(),
      attempts: 0,
      lockedAt: null,
      lastError: null,
    },
    { where: { id: jobId, usersId, status: { [Op.in]: ["failed", "waiting_human"] } } },
  );
  return Boolean(updated);
}

export async function markConversationJobsAnswered({ usersId, conversationId, answeredAt = new Date() }) {
  await CrmResponseJob.update(
    { status: "answered", answeredAt, lastError: null },
    {
      where: {
        usersId,
        conversationId,
        status: { [Op.in]: ["pending", "retry", "processing", "waiting_human", "failed"] },
      },
    },
  );

  const conversation = await CrmConversation.findOne({ where: { id: conversationId, usersId } });
  if (conversation?.metadata?.responseAttention) {
    const { responseAttention, ...metadata } = conversation.metadata;
    await conversation.update({ metadata });
  }
}
