// Trigger da IA do CRM para mensagens recebidas via Meta WhatsApp Business API.
// Espelha o comportamento do Baileys (service/baileys.js) para que clientes em
// API oficial recebam respostas automáticas iguais aos de Baileys.

import CrmConversation from "../../models/CrmConversation.js";
import CrmConversationMessage from "../../models/CrmConversationMessage.js";
import { generateAutoReply } from "../crmAutoReply.js";
import { sendTextMessage } from "./whatsappSendService.js";

const DEBOUNCE_MS = 6000;

const aiTimers = new Map();
const aiLocks = new Set();

export function scheduleMetaAutoReply({ companyId, conversation, customer, phone }) {
  if (!conversation?.id || !companyId) return;

  const conversationId = conversation.id;
  const existing = aiTimers.get(conversationId);
  if (existing) {
    clearTimeout(existing);
    console.log(`[Meta IA] Debounce: cancelando timer anterior ${conversationId.slice(0, 8)}`);
  }

  const timer = setTimeout(async () => {
    aiTimers.delete(conversationId);

    if (aiLocks.has(conversationId)) {
      console.log(`[Meta IA] Lock ativo ${conversationId.slice(0, 8)}, pulando`);
      return;
    }
    aiLocks.add(conversationId);

    try {
      await processMetaAutoReply({ companyId, conversationId, customer, phone });
    } catch (err) {
      console.error(`[Meta IA] Erro inesperado em ${conversationId.slice(0, 8)}:`, err?.message || err);
    } finally {
      aiLocks.delete(conversationId);
    }
  }, DEBOUNCE_MS);

  aiTimers.set(conversationId, timer);
}

async function processMetaAutoReply({ companyId, conversationId, customer, phone }) {
  const fresh = await CrmConversation.findByPk(conversationId);
  if (!fresh) {
    console.log(`[Meta IA] Conversa ${conversationId.slice(0, 8)} não encontrada, abortando`);
    return;
  }
  if (fresh.status === "closed") {
    console.log(`[Meta IA] Conversa ${conversationId.slice(0, 8)} fechada, abortando`);
    return;
  }

  const lastInbound = await CrmConversationMessage.findOne({
    where: { conversationId, direction: "inbound" },
    order: [["createdAt", "DESC"]],
    attributes: ["body", "createdAt"],
  });
  const messageBody = String(lastInbound?.body || "").trim();
  if (!messageBody) {
    console.log(`[Meta IA] Sem inbound recente em ${conversationId.slice(0, 8)}, abortando`);
    return;
  }

  // Carrega pets do cliente — mesmo padrão do Baileys (campo legado custumerId)
  let customerPets = [];
  if (customer?.id) {
    try {
      const { default: PetsModel } = await import("../../models/Pets.js");
      customerPets = await PetsModel.findAll({
        where: { usersId: companyId, custumerId: customer.id },
        attributes: ["id", "name", "species", "breed", "sex", "birthdate"],
        limit: 10,
      });
    } catch (_) {}
  }

  const result = await generateAutoReply({
    usersId: companyId,
    conversation: fresh,
    customer,
    pet: customerPets[0] || null,
    pets: customerPets,
    body: messageBody,
  });

  if (!result?.replied || !result.reply) {
    if (result?.reason) {
      console.log(`[Meta IA] Auto-reply pulado em ${conversationId.slice(0, 8)} (${result.reason})`);
    }
    return;
  }

  console.log(`[Meta IA] Respondendo ${conversationId.slice(0, 8)}: ${result.reply.substring(0, 60)}`);

  // Pequeno delay para parecer mais natural (igual Baileys)
  await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)));

  try {
    await sendTextMessage({
      companyId,
      to: phone,
      body: result.reply,
      conversationId,
    });
    await CrmConversation.update(
      {
        lastMessagePreview: result.reply.substring(0, 100),
        lastMessageAt: new Date(),
        lastOutboundAt: new Date(),
      },
      { where: { id: conversationId } },
    );
  } catch (sendErr) {
    console.error(`[Meta IA] Falha ao enviar resposta para ${phone}:`, sendErr?.message || sendErr);
  }
}
