// routes/crmAiAssistant.js
// Endpoints REST para as features de IA do CRM moderno (Fases 1-6).
// Montado em /api/crm-ai-assistant em index.js.
//
// Endpoints:
//   POST /:conversationId/suggest-replies   (Fase 1)
//   GET  /:conversationId/summary           (Fase 2 - le cache ou gera)
//   POST /:conversationId/summary           (Fase 2 - forca regenerar)
//   POST /:conversationId/classify-intent   (Fase 3)
//   GET  /:conversationId/temperature       (Fase 4 - recalcula sempre)
//   POST /:conversationId/next-actions      (Fase 5)
//   POST /:conversationId/execute-action    (Fase 5 - executa uma acao)
//   POST /assistant/query                   (Fase 6)
//   GET  /assistant/tools                   (Fase 6 - lista tools disponiveis)

import express from "express";
import authenticate from "../middlewares/auth.js";
import CrmConversation from "../models/CrmConversation.js";
import Settings from "../models/Settings.js";
import {
  suggestReplies,
  summarizeConversation,
  classifyIntent,
  computeLeadTemperature,
  generateNextActions,
  runInternalAssistant,
  ASSISTANT_TOOL_LIST,
  CRM_INTENT_LABELS,
  CRM_TEMPERATURE_BUCKETS,
} from "../service/crmAiAssistant.js";

const router = express.Router();

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
}

// Recupera as API keys do dono (Settings.whatsappConnection.crmAiControl)
async function loadApiKeys(usersId) {
  try {
    const settings = await Settings.findOne({ where: { usersId } });
    const wc = settings?.whatsappConnection || {};
    const ai = wc.crmAiControl || wc.aiControl || {};
    return {
      openai: ai.openaiApiKey || process.env.OPENAI_API_KEY || "",
      groq: ai.groqApiKey || process.env.GROQ_API_KEY || "",
      gemini: ai.geminiApiKey || process.env.GEMINI_API_KEY || "",
    };
  } catch {
    return {
      openai: process.env.OPENAI_API_KEY || "",
      groq: process.env.GROQ_API_KEY || "",
      gemini: process.env.GEMINI_API_KEY || "",
    };
  }
}

async function ensureConversationOwned(req, res) {
  const usersId = getEstablishmentId(req);
  const conversation = await CrmConversation.findOne({
    where: { id: req.params.conversationId, usersId },
  });
  if (!conversation) {
    res.status(404).json({ message: "Conversa nao encontrada" });
    return null;
  }
  return { usersId, conversation };
}

// ============ FASE 1: SUGESTAO DE RESPOSTA ============
router.post("/:conversationId/suggest-replies", authenticate, async (req, res) => {
  try {
    const ctx = await ensureConversationOwned(req, res);
    if (!ctx) return;
    const apiKeys = await loadApiKeys(ctx.usersId);
    const tone = String(req.body?.tone || "amigavel").toLowerCase();
    const count = Math.max(1, Math.min(5, Number(req.body?.count) || 3));
    const result = await suggestReplies({
      conversationId: ctx.conversation.id,
      usersId: ctx.usersId,
      tone,
      apiKeys,
      count,
    });
    return res.status(200).json({ data: result });
  } catch (err) {
    console.error("[crmAiAssistant] suggest-replies:", err);
    return res.status(500).json({ message: "Erro ao sugerir respostas", error: err.message });
  }
});

// ============ FASE 2: RESUMO ============
router.get("/:conversationId/summary", authenticate, async (req, res) => {
  try {
    const ctx = await ensureConversationOwned(req, res);
    if (!ctx) return;
    const apiKeys = await loadApiKeys(ctx.usersId);
    const result = await summarizeConversation({
      conversationId: ctx.conversation.id,
      usersId: ctx.usersId,
      apiKeys,
      force: false,
    });
    return res.status(200).json({ data: result });
  } catch (err) {
    console.error("[crmAiAssistant] summary GET:", err);
    return res.status(500).json({ message: "Erro ao gerar resumo", error: err.message });
  }
});

router.post("/:conversationId/summary", authenticate, async (req, res) => {
  try {
    const ctx = await ensureConversationOwned(req, res);
    if (!ctx) return;
    const apiKeys = await loadApiKeys(ctx.usersId);
    const result = await summarizeConversation({
      conversationId: ctx.conversation.id,
      usersId: ctx.usersId,
      apiKeys,
      force: true,
    });
    return res.status(200).json({ data: result });
  } catch (err) {
    console.error("[crmAiAssistant] summary POST:", err);
    return res.status(500).json({ message: "Erro ao gerar resumo", error: err.message });
  }
});

// ============ FASE 3: CLASSIFICAR INTENCAO ============
router.post("/:conversationId/classify-intent", authenticate, async (req, res) => {
  try {
    const ctx = await ensureConversationOwned(req, res);
    if (!ctx) return;
    const apiKeys = await loadApiKeys(ctx.usersId);
    const force = Boolean(req.body?.force);
    const result = await classifyIntent({
      conversationId: ctx.conversation.id,
      usersId: ctx.usersId,
      apiKeys,
      force,
    });
    return res.status(200).json({ data: result });
  } catch (err) {
    console.error("[crmAiAssistant] classify-intent:", err);
    return res.status(500).json({ message: "Erro ao classificar intencao", error: err.message });
  }
});

// ============ FASE 4: TEMPERATURA ============
router.get("/:conversationId/temperature", authenticate, async (req, res) => {
  try {
    const ctx = await ensureConversationOwned(req, res);
    if (!ctx) return;
    const result = await computeLeadTemperature({
      conversationId: ctx.conversation.id,
      usersId: ctx.usersId,
    });
    return res.status(200).json({ data: result });
  } catch (err) {
    console.error("[crmAiAssistant] temperature:", err);
    return res.status(500).json({ message: "Erro ao calcular temperatura", error: err.message });
  }
});

// ============ FASE 5: PROXIMAS ACOES ============
router.post("/:conversationId/next-actions", authenticate, async (req, res) => {
  try {
    const ctx = await ensureConversationOwned(req, res);
    if (!ctx) return;
    const result = await generateNextActions({
      conversationId: ctx.conversation.id,
      usersId: ctx.usersId,
    });
    return res.status(200).json({ data: result });
  } catch (err) {
    console.error("[crmAiAssistant] next-actions:", err);
    return res.status(500).json({ message: "Erro ao gerar acoes", error: err.message });
  }
});

// Executa uma acao: por enquanto so move_funnel e dismiss sao executadas server-side.
// As outras (follow_up, suggest_slot etc) abrem fluxo no frontend.
router.post("/:conversationId/execute-action", authenticate, async (req, res) => {
  try {
    const ctx = await ensureConversationOwned(req, res);
    if (!ctx) return;
    const { actionType, payload = {} } = req.body || {};
    const conversation = ctx.conversation;
    const meta = conversation.metadata || {};

    if (actionType === "move_funnel" && payload.targetStage) {
      await conversation.update({ stage: String(payload.targetStage) });
      const remaining = (meta.aiNextActions || []).filter(
        (a) => a.type !== "move_funnel",
      );
      await conversation.update({
        metadata: { ...meta, aiNextActions: remaining },
      });
      return res.status(200).json({ data: { executed: true, newStage: payload.targetStage } });
    }

    if (actionType === "dismiss") {
      const remaining = (meta.aiNextActions || []).filter(
        (a, i) => i !== Number(payload.index),
      );
      await conversation.update({
        metadata: { ...meta, aiNextActions: remaining },
      });
      return res.status(200).json({ data: { executed: true, dismissed: true } });
    }

    return res.status(200).json({
      data: {
        executed: false,
        message: "Acao reconhecida — execute no frontend",
        actionType,
        payload,
      },
    });
  } catch (err) {
    console.error("[crmAiAssistant] execute-action:", err);
    return res.status(500).json({ message: "Erro ao executar acao", error: err.message });
  }
});

// ============ FASE 6: ASSISTENTE INTERNO ============
router.get("/assistant/tools", authenticate, async (req, res) => {
  return res.status(200).json({
    data: {
      tools: ASSISTANT_TOOL_LIST,
      intentLabels: CRM_INTENT_LABELS,
      temperatureBuckets: CRM_TEMPERATURE_BUCKETS,
    },
  });
});

router.post("/assistant/query", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const apiKeys = await loadApiKeys(usersId);
    const query = String(req.body?.query || "").trim();
    if (!query) {
      return res.status(400).json({ message: "Pergunta vazia" });
    }
    const result = await runInternalAssistant({ usersId, query, apiKeys });
    return res.status(200).json({ data: result });
  } catch (err) {
    console.error("[crmAiAssistant] assistant/query:", err);
    return res.status(500).json({ message: "Erro no assistente", error: err.message });
  }
});

export default router;
