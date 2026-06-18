// crmAiAssistant.js
// Service unificado para as features de IA do CRM moderno:
//   Fase 1: sugestao de resposta (suggestReplies)
//   Fase 2: resumo automatico (summarizeConversation)
//   Fase 3: classificacao de intencao (classifyIntent)
//   Fase 4: temperatura do lead (computeLeadTemperature)
//   Fase 5: proximas acoes (generateNextActions)
//   Fase 6: assistente interno do CRM (runInternalAssistant)
//
// Reusa groqClient + geminiClient (Groq como primario, Gemini como fallback).
// Persiste resultados em CrmConversation.metadata pra evitar migrations
// (excecao: CrmNextAction para Fase 5).

import { groqChat, GROQ_SMART_MODEL, GROQ_FAST_MODEL } from "./groqClient.js";
import { geminiChat } from "./geminiClient.js";
import { openaiChat, OPENAI_DEFAULT_MODEL } from "./openaiClient.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import Custumers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import Appointment from "../models/Appointment.js";
import Finance from "../models/Finance.js";
import { Op } from "sequelize";

const INTENT_LABELS = {
  agendamento: { label: "Agendamento", color: "#2563eb", icon: "calendar" },
  compra: { label: "Compra", color: "#16a34a", icon: "cart" },
  duvida: { label: "Duvida", color: "#0891b2", icon: "help" },
  reclamacao: { label: "Reclamacao", color: "#dc2626", icon: "alert" },
  cobranca: { label: "Cobranca", color: "#d97706", icon: "money" },
  suporte: { label: "Suporte", color: "#7c3aed", icon: "support" },
  cliente_perdido: { label: "Cliente perdido", color: "#64748b", icon: "ghost" },
};

const TEMPERATURE_BUCKETS = {
  hot: { label: "Quente", color: "#dc2626", min: 70 },
  warm: { label: "Morno", color: "#d97706", min: 40 },
  cold: { label: "Frio", color: "#0ea5e9", min: 0 },
};

// ============================================================
// Helper: chama OpenAI premium com fallback automatico para Groq e Gemini
// ============================================================
async function callAiWithFallback({
  apiKeys,
  messages,
  model,
  temperature = 0.4,
  maxTokens = 600,
  jsonMode = false,
  label = "ai",
}) {
  const errors = [];
  const openaiKey = String(apiKeys?.openai || process.env.OPENAI_API_KEY || "").trim();
  const groqKey = String(apiKeys?.groq || process.env.GROQ_API_KEY || "").trim();
  const geminiKey = String(apiKeys?.gemini || process.env.GEMINI_API_KEY || "").trim();

  if (openaiKey) {
    try {
      const result = await openaiChat({
        apiKey: openaiKey,
        messages,
        model: process.env.OPENAI_CRM_MODEL || OPENAI_DEFAULT_MODEL,
        temperature,
        maxTokens,
        jsonMode,
        reasoningEffort: "low",
      });
      return { ...result, provider: "openai" };
    } catch (err) {
      errors.push(`openai: ${err.message}`);
      console.warn(`[crmAiAssistant:${label}] OpenAI falhou, tentando Groq: ${err.message}`);
    }
  }

  if (groqKey) {
    try {
      const result = await groqChat({
        apiKey: groqKey,
        messages,
        model: model || GROQ_FAST_MODEL,
        temperature,
        maxTokens,
        jsonMode,
      });
      return { ...result, provider: "groq" };
    } catch (err) {
      errors.push(`groq: ${err.message}`);
      console.warn(`[crmAiAssistant:${label}] Groq falhou, tentando Gemini: ${err.message}`);
    }
  }

  if (geminiKey) {
    try {
      const result = await geminiChat({
        apiKey: geminiKey,
        messages,
        temperature,
        maxTokens,
        jsonMode,
      });
      return { ...result, provider: "gemini" };
    } catch (err) {
      errors.push(`gemini: ${err.message}`);
      console.warn(`[crmAiAssistant:${label}] Gemini falhou: ${err.message}`);
    }
  }

  throw new Error(`IA indisponivel (${label}): ${errors.join(" | ") || "sem API key"}`);
}

function parseJsonSafe(text, fallback = null) {
  if (!text) return fallback;
  const trimmed = String(text).trim();
  // Tenta extrair JSON de bloco markdown
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    // Tenta primeiro objeto JSON da string
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

// ============================================================
// Carrega contexto da conversa (mensagens + cliente + pet)
// ============================================================
async function loadConversationContext(conversationId, usersId, { messageLimit = 20 } = {}) {
  const conversation = await CrmConversation.findOne({
    where: { id: conversationId, usersId },
  });
  if (!conversation) {
    throw new Error("Conversa nao encontrada");
  }

  const messages = await CrmConversationMessage.findAll({
    where: { conversationId, usersId },
    order: [["createdAt", "DESC"]],
    limit: messageLimit,
  });

  const ordered = messages.reverse();

  let customer = null;
  if (conversation.customerId) {
    customer = await Custumers.findOne({
      where: { id: conversation.customerId, usersId },
    }).catch(() => null);
  }

  let pet = null;
  if (conversation.petId) {
    pet = await Pets.findOne({
      where: { id: conversation.petId, usersId },
    }).catch(() => null);
  }

  return { conversation, messages: ordered, customer, pet };
}

function formatMessagesForPrompt(messages, { maxChars = 4000 } = {}) {
  const lines = [];
  let total = 0;
  for (const msg of messages) {
    const who =
      msg.direction === "outbound"
        ? msg.authorUserId
          ? "Atendente"
          : "IA"
        : "Cliente";
    const body = String(msg.body || "").replace(/\s+/g, " ").trim();
    if (!body) continue;
    const line = `${who}: ${body}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

// ============================================================
// FASE 1: Sugestao de resposta
// ============================================================
export async function suggestReplies({
  conversationId,
  usersId,
  tone = "amigavel",
  apiKeys = {},
  count = 3,
}) {
  const { conversation, messages, customer, pet } = await loadConversationContext(
    conversationId,
    usersId,
    { messageLimit: 12 },
  );

  if (messages.length === 0) {
    return {
      suggestions: [
        "Oi! Tudo bem? Como posso te ajudar hoje?",
        "Ola! Em que posso ajudar?",
        "Oi! Bem-vindo(a). Me conta o que voce precisa.",
      ],
      provider: "fallback",
      cached: false,
    };
  }

  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound) {
    return {
      suggestions: ["Aguardando o cliente responder."],
      provider: "fallback",
      cached: false,
    };
  }

  const transcript = formatMessagesForPrompt(messages, { maxChars: 2500 });
  const customerName = customer?.name || conversation.customerName || "cliente";
  const petName = pet?.name || conversation.petName || "";

  const toneInstructions = {
    amigavel: "Tom amigavel, caloroso, com emoji ocasional.",
    profissional: "Tom profissional e direto, sem emoji.",
    objetivo: "Tom objetivo e curto, ate 1 frase.",
  };

  const systemPrompt = `Voce e o assistente de um atendente humano de um pet shop.
Sua tarefa: sugerir ${count} respostas curtas para o atendente enviar ao cliente.
${toneInstructions[tone] || toneInstructions.amigavel}

Cliente: ${customerName}${petName ? ` | Pet: ${petName}` : ""}

REGRAS:
- Sugestoes em portugues brasileiro
- Cada sugestao com no maximo 2 frases
- NAO invente dados que nao estao no contexto (datas, precos, horarios)
- NAO confirme agendamento sem o cliente pedir explicitamente
- Se a ultima mensagem do cliente for vaga, sugira perguntas de esclarecimento
- Retorne APENAS JSON valido no formato: { "suggestions": ["...", "...", "..."] }`;

  const userPrompt = `Historico da conversa:
${transcript}

Ultima mensagem do cliente: "${String(lastInbound.body || "").trim()}"

Gere ${count} sugestoes de resposta para o atendente.`;

  let result;
  try {
    result = await callAiWithFallback({
      apiKeys,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      maxTokens: 500,
      jsonMode: true,
      label: "suggestReplies",
    });
  } catch (err) {
    return {
      suggestions: [
        "Posso te ajudar com mais alguma coisa?",
        "Deixa eu verificar e ja te respondo.",
        "Pode me dar mais detalhes pra eu te ajudar melhor?",
      ],
      provider: "fallback",
      error: err.message,
      cached: false,
    };
  }

  const parsed = parseJsonSafe(result.content, {});
  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions.map((s) => String(s || "").trim()).filter(Boolean).slice(0, count)
    : [];

  if (suggestions.length === 0) {
    return {
      suggestions: [
        "Posso te ajudar com mais alguma coisa?",
        "Deixa eu verificar e ja te respondo.",
        "Pode me dar mais detalhes pra eu te ajudar melhor?",
      ],
      provider: result.provider,
      cached: false,
    };
  }

  return {
    suggestions,
    provider: result.provider,
    model: result.model,
    cached: false,
  };
}

// ============================================================
// FASE 2: Resumo automatico da conversa
// ============================================================
export async function summarizeConversation({
  conversationId,
  usersId,
  apiKeys = {},
  force = false,
}) {
  const { conversation, messages } = await loadConversationContext(
    conversationId,
    usersId,
    { messageLimit: 60 },
  );

  const meta = conversation.metadata || {};
  const cached = meta.aiSummary;
  const cachedAt = meta.aiSummaryUpdatedAt;
  const cachedMessageCount = Number(meta.aiSummaryMessageCount || 0);

  // Cache valido: tem resumo, mensagens NAO aumentaram em >=5 desde o ultimo
  if (!force && cached && messages.length - cachedMessageCount < 5) {
    return {
      summary: cached.summary,
      keyPoints: cached.keyPoints || [],
      lastIntent: cached.lastIntent || null,
      pendingItems: cached.pendingItems || [],
      updatedAt: cachedAt,
      cached: true,
      provider: cached.provider || null,
    };
  }

  if (messages.length === 0) {
    return {
      summary: "Conversa sem mensagens ainda.",
      keyPoints: [],
      lastIntent: null,
      pendingItems: [],
      cached: false,
      provider: "fallback",
    };
  }

  const transcript = formatMessagesForPrompt(messages, { maxChars: 6000 });
  const customerName = conversation.customerName || "cliente";

  const systemPrompt = `Voce e um analista de atendimento de pet shop.
Gere um resumo executivo da conversa abaixo em portugues brasileiro.

Retorne APENAS JSON valido no formato:
{
  "summary": "1-2 frases resumindo a conversa",
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"],
  "lastIntent": "agendamento|compra|duvida|reclamacao|cobranca|suporte|cliente_perdido|conversa_geral",
  "pendingItems": ["item pendente 1", "item pendente 2"]
}

REGRAS:
- summary: maximo 200 caracteres
- keyPoints: maximo 5, cada um com no maximo 80 caracteres
- pendingItems: o que ainda falta resolver (vazio se nada)
- Seja factual, nao invente`;

  const userPrompt = `Cliente: ${customerName}

Conversa (${messages.length} mensagens):
${transcript}

Gere o JSON do resumo.`;

  let result;
  try {
    result = await callAiWithFallback({
      apiKeys,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      model: GROQ_SMART_MODEL,
      temperature: 0.3,
      maxTokens: 700,
      jsonMode: true,
      label: "summarize",
    });
  } catch (err) {
    return {
      summary: "Nao foi possivel gerar resumo no momento.",
      keyPoints: [],
      lastIntent: null,
      pendingItems: [],
      cached: false,
      provider: "fallback",
      error: err.message,
    };
  }

  const parsed = parseJsonSafe(result.content, {});
  const summary = {
    summary: String(parsed?.summary || "Conversa sem detalhes.").slice(0, 300),
    keyPoints: Array.isArray(parsed?.keyPoints)
      ? parsed.keyPoints.map((s) => String(s).slice(0, 120)).slice(0, 5)
      : [],
    lastIntent: parsed?.lastIntent || null,
    pendingItems: Array.isArray(parsed?.pendingItems)
      ? parsed.pendingItems.map((s) => String(s).slice(0, 120)).slice(0, 5)
      : [],
    provider: result.provider,
    model: result.model,
  };

  // Persiste no metadata
  const nextMeta = {
    ...meta,
    aiSummary: summary,
    aiSummaryUpdatedAt: new Date().toISOString(),
    aiSummaryMessageCount: messages.length,
  };
  await conversation.update({ metadata: nextMeta });

  return {
    ...summary,
    updatedAt: nextMeta.aiSummaryUpdatedAt,
    cached: false,
  };
}

// ============================================================
// FASE 3: Classificacao de intencao
// ============================================================
export async function classifyIntent({
  conversationId,
  usersId,
  apiKeys = {},
  force = false,
}) {
  const { conversation, messages } = await loadConversationContext(
    conversationId,
    usersId,
    { messageLimit: 30 },
  );

  const meta = conversation.metadata || {};
  const cached = meta.aiIntent;
  const cachedMessageCount = Number(meta.aiIntentMessageCount || 0);

  if (!force && cached && messages.length - cachedMessageCount < 3) {
    return {
      intent: cached.intent,
      confidence: cached.confidence || 0,
      reason: cached.reason || "",
      label: INTENT_LABELS[cached.intent]?.label || cached.intent,
      color: INTENT_LABELS[cached.intent]?.color || "#64748b",
      updatedAt: meta.aiIntentUpdatedAt,
      cached: true,
      provider: cached.provider,
    };
  }

  if (messages.length === 0) {
    return {
      intent: "duvida",
      confidence: 0,
      reason: "Sem mensagens",
      label: INTENT_LABELS.duvida.label,
      color: INTENT_LABELS.duvida.color,
      cached: false,
      provider: "fallback",
    };
  }

  const transcript = formatMessagesForPrompt(messages, { maxChars: 3500 });

  const systemPrompt = `Voce classifica conversas de WhatsApp de pet shop em UMA das categorias:
- agendamento: cliente quer marcar/remarcar/cancelar servico (banho, tosa, consulta etc)
- compra: cliente quer comprar produto (racao, brinquedo, medicamento)
- duvida: pergunta geral sobre servico, preco, horario, localizacao
- reclamacao: cliente esta insatisfeito ou irritado
- cobranca: cliente pergunta sobre boleto, pagamento, debito pendente
- suporte: cliente precisa de ajuda tecnica/orientacao (medicamento, comportamento do pet)
- cliente_perdido: cliente nao responde ha tempos ou disse que vai cancelar/nao volta

Retorne APENAS JSON: { "intent": "...", "confidence": 0.0-1.0, "reason": "breve justificativa em ate 80 chars" }`;

  const userPrompt = `Conversa:
${transcript}

Classifique a intencao principal.`;

  let result;
  try {
    result = await callAiWithFallback({
      apiKeys,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      maxTokens: 200,
      jsonMode: true,
      label: "classifyIntent",
    });
  } catch (err) {
    return {
      intent: "duvida",
      confidence: 0,
      reason: `IA falhou: ${err.message}`,
      label: INTENT_LABELS.duvida.label,
      color: INTENT_LABELS.duvida.color,
      cached: false,
      provider: "fallback",
      error: err.message,
    };
  }

  const parsed = parseJsonSafe(result.content, {});
  const rawIntent = String(parsed?.intent || "duvida").toLowerCase().trim();
  const intent = INTENT_LABELS[rawIntent] ? rawIntent : "duvida";
  const classification = {
    intent,
    confidence: Math.max(0, Math.min(1, Number(parsed?.confidence) || 0.5)),
    reason: String(parsed?.reason || "").slice(0, 120),
    provider: result.provider,
    model: result.model,
  };

  const nextMeta = {
    ...meta,
    aiIntent: classification,
    aiIntentUpdatedAt: new Date().toISOString(),
    aiIntentMessageCount: messages.length,
  };
  await conversation.update({ metadata: nextMeta });

  return {
    ...classification,
    label: INTENT_LABELS[intent].label,
    color: INTENT_LABELS[intent].color,
    updatedAt: nextMeta.aiIntentUpdatedAt,
    cached: false,
  };
}

// ============================================================
// FASE 4: Temperatura do lead (quente/morno/frio)
// ============================================================
//
// Algoritmo deterministico (sem IA), barato e rapido. Combina:
//   - Recencia da ultima mensagem (40%)
//   - Volume de mensagens recentes (15%)
//   - Intencao classificada (25%)
//   - Tem agendamento futuro (20%)
//
// Score 0-100. Quente >=70, Morno 40-69, Frio <40.
export async function computeLeadTemperature({ conversationId, usersId }) {
  const { conversation, messages } = await loadConversationContext(
    conversationId,
    usersId,
    { messageLimit: 50 },
  );

  const meta = conversation.metadata || {};
  const now = Date.now();
  const lastInbound =
    [...messages].reverse().find((m) => m.direction === "inbound") || null;
  const lastMessageAt = lastInbound?.createdAt
    ? new Date(lastInbound.createdAt).getTime()
    : (conversation.lastInboundAt ? new Date(conversation.lastInboundAt).getTime() : 0);

  let recencyScore = 0;
  if (lastMessageAt > 0) {
    const hours = (now - lastMessageAt) / 36e5;
    if (hours <= 2) recencyScore = 40;
    else if (hours <= 24) recencyScore = 30;
    else if (hours <= 72) recencyScore = 20;
    else if (hours <= 168) recencyScore = 10;
    else recencyScore = 0;
  }

  const recentInbound = messages.filter(
    (m) =>
      m.direction === "inbound" &&
      m.createdAt &&
      now - new Date(m.createdAt).getTime() <= 7 * 24 * 36e5,
  ).length;
  const volumeScore = Math.min(15, recentInbound * 3);

  const intent = meta.aiIntent?.intent || null;
  const intentScore = (() => {
    switch (intent) {
      case "agendamento":
        return 25;
      case "compra":
        return 22;
      case "cobranca":
        return 18;
      case "duvida":
        return 12;
      case "suporte":
        return 10;
      case "reclamacao":
        return 8;
      case "cliente_perdido":
        return 0;
      default:
        return 10;
    }
  })();

  let appointmentScore = 0;
  if (conversation.customerId) {
    try {
      const future = await Appointment.findOne({
        where: {
          usersId,
          customerId: conversation.customerId,
          date: { [Op.gte]: new Date() },
        },
      });
      if (future) appointmentScore = 20;
    } catch {
      // tabela appointment pode ter shape diferente; ignora
    }
  }

  const score = recencyScore + volumeScore + intentScore + appointmentScore;
  let bucket = "cold";
  if (score >= TEMPERATURE_BUCKETS.hot.min) bucket = "hot";
  else if (score >= TEMPERATURE_BUCKETS.warm.min) bucket = "warm";

  const temperature = {
    bucket,
    label: TEMPERATURE_BUCKETS[bucket].label,
    color: TEMPERATURE_BUCKETS[bucket].color,
    score,
    breakdown: {
      recency: recencyScore,
      volume: volumeScore,
      intent: intentScore,
      appointment: appointmentScore,
    },
  };

  const nextMeta = {
    ...meta,
    aiTemperature: temperature,
    aiTemperatureUpdatedAt: new Date().toISOString(),
  };
  await conversation.update({ metadata: nextMeta });

  return { ...temperature, updatedAt: nextMeta.aiTemperatureUpdatedAt };
}

// ============================================================
// FASE 5: Proximas acoes automaticas
// ============================================================
//
// Gera lista de proximas acoes baseada em:
//   - Intencao classificada (Fase 3)
//   - Temperatura (Fase 4)
//   - Estado do funil (stage)
//   - Existencia de agendamento/cobranca
//
// Cada acao tem { type, title, description, priority, payload }.
// type ∈ { follow_up, create_task, move_funnel, suggest_slot, remind_charge, reactivate }
export async function generateNextActions({ conversationId, usersId }) {
  const { conversation, customer } = await loadConversationContext(
    conversationId,
    usersId,
    { messageLimit: 5 },
  );

  const meta = conversation.metadata || {};
  const intent = meta.aiIntent?.intent || null;
  const temperature = meta.aiTemperature?.bucket || "cold";
  const stage = conversation.stage || "prospectar";
  const actions = [];

  const hoursSinceInbound = conversation.lastInboundAt
    ? (Date.now() - new Date(conversation.lastInboundAt).getTime()) / 36e5
    : 9999;
  const hoursSinceOutbound = conversation.lastOutboundAt
    ? (Date.now() - new Date(conversation.lastOutboundAt).getTime()) / 36e5
    : 9999;

  // 1) Follow-up se cliente respondeu e ninguem retornou em 4h+
  if (hoursSinceInbound < hoursSinceOutbound && hoursSinceInbound >= 4) {
    actions.push({
      type: "follow_up",
      title: "Enviar follow-up",
      description: `Cliente respondeu ha ${Math.round(hoursSinceInbound)}h e ainda nao foi respondido.`,
      priority: temperature === "hot" ? "high" : "medium",
      payload: { conversationId },
    });
  }

  // 2) Agendamento: sugerir slot
  if (intent === "agendamento") {
    actions.push({
      type: "suggest_slot",
      title: "Sugerir horario na agenda",
      description: "Cliente demonstrou intencao de agendar — proponha 2-3 horarios.",
      priority: "high",
      payload: { conversationId, customerId: conversation.customerId },
    });
    if (stage === "prospectar" || stage === "qualificar") {
      actions.push({
        type: "move_funnel",
        title: "Mover para Levantando necessidades",
        description: "Conversa avancou de prospect para qualificacao real.",
        priority: "medium",
        payload: { conversationId, targetStage: "necessidades" },
      });
    }
  }

  // 3) Compra: criar tarefa de venda
  if (intent === "compra") {
    actions.push({
      type: "create_task",
      title: "Criar tarefa: fechar venda",
      description: "Cliente com intencao de compra — preparar orcamento.",
      priority: temperature === "hot" ? "high" : "medium",
      payload: { conversationId, taskKind: "venda" },
    });
  }

  // 4) Cobranca: lembrar cobranca
  if (intent === "cobranca") {
    actions.push({
      type: "remind_charge",
      title: "Verificar cobranca pendente",
      description: "Cliente perguntou sobre pagamento — checar Financeiro.",
      priority: "high",
      payload: { conversationId, customerId: conversation.customerId },
    });
  }

  // 5) Reclamacao: escalar pra dono / criar tarefa urgente
  if (intent === "reclamacao") {
    actions.push({
      type: "create_task",
      title: "Atender reclamacao com prioridade",
      description: "Cliente esta insatisfeito — responder pessoalmente.",
      priority: "high",
      payload: { conversationId, taskKind: "reclamacao" },
    });
  }

  // 6) Cliente perdido / parado: reativar
  const daysSinceInbound = hoursSinceInbound / 24;
  if (intent === "cliente_perdido" || daysSinceInbound >= 14) {
    actions.push({
      type: "reactivate",
      title: "Reativar cliente parado",
      description: `Sem contato ha ${Math.round(daysSinceInbound)} dias — enviar mensagem de reengajamento.`,
      priority: temperature === "cold" ? "low" : "medium",
      payload: { conversationId, customerId: conversation.customerId },
    });
  }

  // Persiste no metadata pra mostrar no painel
  const nextMeta = {
    ...meta,
    aiNextActions: actions,
    aiNextActionsUpdatedAt: new Date().toISOString(),
  };
  await conversation.update({ metadata: nextMeta });

  return { actions, updatedAt: nextMeta.aiNextActionsUpdatedAt };
}

// ============================================================
// FASE 6: Assistente interno do CRM
// ============================================================
//
// Recebe pergunta em linguagem natural e roteia para uma "tool"
// interna. Cada tool e uma funcao que consulta o BD e retorna dados
// estruturados que o frontend renderiza com cards.
//
// Tools disponiveis:
//   - clientes_sem_resposta
//   - clientes_parados
//   - agenda_amanha
//   - cobrancas_pendentes
//   - resumir_atendimento (conversationId)
//   - criar_mensagem (customerId/conversationId, intent)
//   - criar_campanha (segment)

const ASSISTANT_TOOLS = [
  {
    name: "clientes_sem_resposta",
    description: "Lista conversas com mensagem do cliente nao respondida nas ultimas X horas",
    params: { hoursMin: "number, default 4" },
  },
  {
    name: "clientes_parados",
    description: "Lista clientes sem interacao ha N dias",
    params: { daysMin: "number, default 30" },
  },
  {
    name: "agenda_amanha",
    description: "Lista agendamentos do dia seguinte",
    params: {},
  },
  {
    name: "cobrancas_pendentes",
    description: "Lista cobrancas em aberto no financeiro",
    params: {},
  },
  {
    name: "resumir_atendimento",
    description: "Gera resumo de uma conversa especifica",
    params: { conversationId: "uuid (opcional, se nao tiver pega a mais recente)" },
  },
  {
    name: "criar_mensagem",
    description: "Sugere mensagem para um cliente especifico",
    params: { customerId: "uuid", intencao: "string opcional" },
  },
  {
    name: "criar_campanha",
    description: "Sugere uma campanha de mensagens para um segmento",
    params: { segmento: "string ex 'clientes_parados', 'tutores_de_caes'" },
  },
];

async function toolClientesSemResposta(usersId, params = {}) {
  const hoursMin = Number(params.hoursMin) || 4;
  const cutoff = new Date(Date.now() - hoursMin * 36e5);
  const list = await CrmConversation.findAll({
    where: {
      usersId,
      isArchived: false,
      lastInboundAt: { [Op.ne]: null, [Op.gt]: new Date(Date.now() - 7 * 24 * 36e5) },
      [Op.or]: [
        { lastOutboundAt: null },
        { lastOutboundAt: { [Op.lt]: cutoff } },
      ],
    },
    order: [["lastInboundAt", "DESC"]],
    limit: 30,
  });
  const filtered = list.filter((c) => {
    if (!c.lastInboundAt) return false;
    const inT = new Date(c.lastInboundAt).getTime();
    const outT = c.lastOutboundAt ? new Date(c.lastOutboundAt).getTime() : 0;
    return inT > outT && Date.now() - inT >= hoursMin * 36e5;
  });
  return {
    kind: "list_conversations",
    title: `Clientes sem resposta ha ${hoursMin}h+`,
    count: filtered.length,
    items: filtered.slice(0, 20).map((c) => ({
      id: c.id,
      customerName: c.customerName || "Sem nome",
      phone: c.phone,
      lastInboundAt: c.lastInboundAt,
      lastMessagePreview: c.lastMessagePreview,
      stage: c.stage,
      temperature: c.metadata?.aiTemperature?.bucket || null,
    })),
  };
}

async function toolClientesParados(usersId, params = {}) {
  const daysMin = Number(params.daysMin) || 30;
  const cutoff = new Date(Date.now() - daysMin * 24 * 36e5);
  const list = await CrmConversation.findAll({
    where: {
      usersId,
      isArchived: false,
      [Op.or]: [
        { lastInboundAt: { [Op.lt]: cutoff } },
        { lastInboundAt: null, createdAt: { [Op.lt]: cutoff } },
      ],
    },
    order: [["lastInboundAt", "ASC"]],
    limit: 30,
  });
  return {
    kind: "list_conversations",
    title: `Clientes parados ha ${daysMin} dias+`,
    count: list.length,
    items: list.map((c) => ({
      id: c.id,
      customerName: c.customerName || "Sem nome",
      phone: c.phone,
      lastInboundAt: c.lastInboundAt,
      stage: c.stage,
    })),
  };
}

async function toolAgendaAmanha(usersId) {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  let appts = [];
  try {
    appts = await Appointment.findAll({
      where: {
        usersId,
        date: { [Op.between]: [start, end] },
      },
      order: [["date", "ASC"]],
      limit: 50,
    });
  } catch (err) {
    return { kind: "error", title: "Agenda de amanha", message: err.message };
  }
  return {
    kind: "list_appointments",
    title: `Agenda de amanha (${appts.length})`,
    count: appts.length,
    items: appts.map((a) => ({
      id: a.id,
      date: a.date,
      time: a.time || a.startTime,
      petName: a.petName,
      customerName: a.customerName,
      service: a.serviceName || a.service,
      status: a.status,
    })),
  };
}

async function toolCobrancasPendentes(usersId) {
  let pendings = [];
  try {
    pendings = await Finance.findAll({
      where: {
        usersId,
        [Op.or]: [
          { status: "pending" },
          { paid: false },
        ],
      },
      order: [["createdAt", "DESC"]],
      limit: 30,
    });
  } catch (err) {
    return { kind: "error", title: "Cobrancas pendentes", message: err.message };
  }
  return {
    kind: "list_finance",
    title: `Cobrancas pendentes (${pendings.length})`,
    count: pendings.length,
    items: pendings.map((f) => ({
      id: f.id,
      description: f.description || f.title,
      amount: f.amount || f.value,
      dueDate: f.dueDate || f.date,
      customerName: f.customerName,
      status: f.status,
    })),
  };
}

async function toolResumirAtendimento(usersId, params = {}, apiKeys = {}) {
  let conversationId = params.conversationId;
  if (!conversationId) {
    const recent = await CrmConversation.findOne({
      where: { usersId, isArchived: false },
      order: [["lastMessageAt", "DESC"]],
    });
    if (!recent) {
      return { kind: "empty", title: "Resumir atendimento", message: "Sem conversas." };
    }
    conversationId = recent.id;
  }
  const summary = await summarizeConversation({
    conversationId,
    usersId,
    apiKeys,
  });
  return {
    kind: "conversation_summary",
    title: "Resumo do atendimento",
    conversationId,
    summary: summary.summary,
    keyPoints: summary.keyPoints,
    pendingItems: summary.pendingItems,
  };
}

async function toolCriarMensagem(usersId, params = {}, apiKeys = {}) {
  const intencao = params.intencao || "geral";
  const customerId = params.customerId;
  let customer = null;
  if (customerId) {
    customer = await Custumers.findOne({ where: { id: customerId, usersId } }).catch(() => null);
  }
  const name = customer?.name || "cliente";

  const systemPrompt = `Voce e o atendente de um pet shop. Gere uma mensagem de WhatsApp curta, calorosa, em portugues, para ${name}. Intencao: ${intencao}.
Retorne APENAS JSON: { "message": "..." }`;
  let result;
  try {
    result = await callAiWithFallback({
      apiKeys,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Gere uma mensagem com intencao "${intencao}" para o cliente ${name}.` },
      ],
      temperature: 0.7,
      maxTokens: 300,
      jsonMode: true,
      label: "criarMensagem",
    });
  } catch (err) {
    return { kind: "error", title: "Criar mensagem", message: err.message };
  }
  const parsed = parseJsonSafe(result.content, {});
  return {
    kind: "draft_message",
    title: `Mensagem para ${name}`,
    customerId,
    message: parsed?.message || "Oi! Tudo bem?",
  };
}

async function toolCriarCampanha(usersId, params = {}, apiKeys = {}) {
  const segmento = params.segmento || "clientes_parados";
  const systemPrompt = `Voce e o gerente de marketing de um pet shop. Sugira uma campanha de WhatsApp para o segmento "${segmento}".
Retorne APENAS JSON:
{ "nome": "...", "objetivo": "...", "mensagem_modelo": "...", "publico_alvo": "...", "dica": "..." }`;
  let result;
  try {
    result = await callAiWithFallback({
      apiKeys,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Sugira uma campanha para o segmento ${segmento}.` },
      ],
      temperature: 0.7,
      maxTokens: 500,
      jsonMode: true,
      label: "criarCampanha",
    });
  } catch (err) {
    return { kind: "error", title: "Criar campanha", message: err.message };
  }
  const parsed = parseJsonSafe(result.content, {});
  return {
    kind: "campaign_draft",
    title: `Campanha: ${parsed?.nome || segmento}`,
    segmento,
    objetivo: parsed?.objetivo,
    mensagem_modelo: parsed?.mensagem_modelo,
    publico_alvo: parsed?.publico_alvo,
    dica: parsed?.dica,
  };
}

const TOOL_HANDLERS = {
  clientes_sem_resposta: toolClientesSemResposta,
  clientes_parados: toolClientesParados,
  agenda_amanha: toolAgendaAmanha,
  cobrancas_pendentes: toolCobrancasPendentes,
  resumir_atendimento: toolResumirAtendimento,
  criar_mensagem: toolCriarMensagem,
  criar_campanha: toolCriarCampanha,
};

export async function runInternalAssistant({ usersId, query, apiKeys = {} }) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) {
    return { kind: "empty", title: "Assistente", message: "Faca uma pergunta." };
  }

  // Step 1: a IA escolhe a tool + params
  const toolList = ASSISTANT_TOOLS.map(
    (t) => `- ${t.name}: ${t.description}. Params: ${JSON.stringify(t.params)}`,
  ).join("\n");

  const systemPrompt = `Voce e o assistente interno do CRM de um pet shop. O dono faz perguntas e voce DEVE escolher UMA tool da lista abaixo para responder.

Tools disponiveis:
${toolList}

Retorne APENAS JSON valido:
{ "tool": "nome_da_tool", "params": { ... }, "reply": "frase curta confirmando o que vai mostrar" }

REGRAS:
- Se a pergunta nao se encaixa em nenhuma tool, use "tool": "none" e explique em "reply"
- Use sempre nomes de tool exatos da lista
- params deve seguir o formato indicado`;

  let routerResult;
  try {
    routerResult = await callAiWithFallback({
      apiKeys,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: cleanQuery },
      ],
      temperature: 0.2,
      maxTokens: 300,
      jsonMode: true,
      label: "assistantRouter",
    });
  } catch (err) {
    return { kind: "error", title: "Assistente", message: `IA falhou: ${err.message}` };
  }

  const parsed = parseJsonSafe(routerResult.content, {});
  const toolName = String(parsed?.tool || "none");
  const reply = String(parsed?.reply || "");

  if (toolName === "none" || !TOOL_HANDLERS[toolName]) {
    return {
      kind: "text",
      title: "Assistente",
      message: reply || "Nao entendi sua pergunta. Tente: 'clientes sem resposta', 'agenda de amanha', 'cobrancas pendentes'.",
    };
  }

  const handler = TOOL_HANDLERS[toolName];
  try {
    const data = await handler(usersId, parsed.params || {}, apiKeys);
    return { ...data, reply, tool: toolName };
  } catch (err) {
    return {
      kind: "error",
      title: "Assistente",
      message: `Erro ao executar ${toolName}: ${err.message}`,
    };
  }
}

export const ASSISTANT_TOOL_LIST = ASSISTANT_TOOLS;
export const CRM_INTENT_LABELS = INTENT_LABELS;
export const CRM_TEMPERATURE_BUCKETS = TEMPERATURE_BUCKETS;
