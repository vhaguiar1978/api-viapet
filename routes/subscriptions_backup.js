import express from "express";
import { v4 as uuidv4 } from "uuid";
import { Op } from "sequelize";
import Subscription from "../models/Subscription.js";
import PaymentHistory from "../models/PaymentHistory.js";
import Users from "../models/Users.js";
import {
  createSubscriptionPreference,
  getPaymentInfo,
  validateWebhookSignature,
  processWebhookEvent,
  processSubscriptionRenewal,
  applyTrialPeriod,
  planPrices,
} from "../service/mercadopago.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// ==================== CACHE LOCAL PARA CONTROLE DE WEBHOOKS DUPLICADOS ====================

/**
 * Cache local para controlar eventos duplicados do webhook
 * Estrutura: { eventKey: { timestamp: number, processed: boolean, paymentId: string } }
 */
const webhookEventCache = new Map();
const WEBHOOK_CACHE_TTL = 10 * 60 * 1000; // 10 minutos
const WEBHOOK_PROCESSING_WINDOW = 30000; // 30 segundos para processar

/**
 * Cache para respostas de consulta de assinatura (evitar consultas repetidas)
 * Estrutura: { userId: { timestamp: number, data: object } }
 */
const subscriptionResponseCache = new Map();
const SUBSCRIPTION_CACHE_TTL = 30 * 1000; // 30 segundos para cache de resposta

/**
 * Cache para rate limiting de consultas por usuário
 * Estrutura: { userId: { count: number, resetTime: number } }
 */
const userQueryRateLimit = new Map();
const RATE_LIMIT_WINDOW = 10 * 1000; // 10 segundos
const RATE_LIMIT_MAX_REQUESTS = 3; // máximo 3 consultas por 10 segundos

/**
 * Limpar cache antigo periodicamente
 */
setInterval(() => {
  const now = Date.now();
  let removedCount = 0;

  // Limpar cache de webhooks
  for (const [eventKey, data] of webhookEventCache.entries()) {
    if (now - data.timestamp > WEBHOOK_CACHE_TTL) {
      webhookEventCache.delete(eventKey);
      removedCount++;
    }
  }

  // Limpar cache de respostas de assinatura
  for (const [userId, data] of subscriptionResponseCache.entries()) {
    if (now - data.timestamp > SUBSCRIPTION_CACHE_TTL) {
      subscriptionResponseCache.delete(userId);
    }
  }

  // Limpar rate limiting expirado
  for (const [userId, data] of userQueryRateLimit.entries()) {
    if (now > data.resetTime) {
      userQueryRateLimit.delete(userId);
    }
  }

  if (removedCount > 0) {
    console.log(
      `🧹 Cache de webhooks limpo: ${removedCount} eventos antigos removidos`
    );
  }
}, WEBHOOK_CACHE_TTL / 2); // Limpa a cada 5 minutos

/**
 * Verificar rate limiting para consultas de assinatura
 */
function checkSubscriptionQueryRateLimit(userId) {
  const now = Date.now();

  if (!userQueryRateLimit.has(userId)) {
    userQueryRateLimit.set(userId, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  const userData = userQueryRateLimit.get(userId);

  // Se passou da janela de tempo, resetar
  if (now > userData.resetTime) {
    userData.count = 1;
    userData.resetTime = now + RATE_LIMIT_WINDOW;
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  // Verificar se ainda está dentro do limite
  if (userData.count >= RATE_LIMIT_MAX_REQUESTS) {
    const waitTime = Math.ceil((userData.resetTime - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      waitTime: waitTime,
      message: `Muitas consultas. Aguarde ${waitTime}s`,
    };
  }

  userData.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - userData.count,
  };
}

/**
 * Verificar cache de resposta de assinatura
 */
function getSubscriptionFromCache(userId) {
  const cached = subscriptionResponseCache.get(userId);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > SUBSCRIPTION_CACHE_TTL) {
    subscriptionResponseCache.delete(userId);
    return null;
  }

  console.log(`📋 Retornando assinatura do cache para usuário: ${userId}`);
  return cached.data;
}

/**
 * Salvar resposta de assinatura no cache
 */
function cacheSubscriptionResponse(userId, responseData) {
  subscriptionResponseCache.set(userId, {
    timestamp: Date.now(),
    data: responseData,
  });
  console.log(`💾 Resposta de assinatura cacheada para usuário: ${userId}`);
}

/**
 * Gerar chave única para evento do webhook
 */
function generateWebhookEventKey(eventData, headers) {
  // Verificar se evento é processável antes de criar chave
  if (!isEventProcessable(eventData)) {
    console.log(
      `⚠️ Evento não processável - tipo: ${
        eventData.topic || eventData.type || "unknown"
      }`
    );
    return null; // Não criar chave para eventos não processáveis
  }

  // Usar múltiplos identificadores para criar chave única
  const paymentId = extractPaymentIdFromEvent(eventData);
  const requestId = headers["x-request-id"] || "no-request-id";
  const timestamp = Math.floor(Date.now() / 1000); // Timestamp em segundos

  // Se tem paymentId, usar ele como base
  if (paymentId) {
    const eventKey = `payment_${paymentId}_${
      eventData.action || eventData.topic || "unknown"
    }`;
    console.log(`🔑 Chave do evento IDENTIFICADA: ${eventKey}`);
    return eventKey;
  }

  // Fallback para outros tipos de evento de pagamento (sem payment ID identificado)
  const fallbackKey = `event_${requestId}_${timestamp}`;
  console.log(`⚠️ Chave do evento GENÉRICA (sem payment ID): ${fallbackKey}`);
  console.log(`❓ Tipo de evento sem payment ID:`, {
    type: eventData.type,
    topic: eventData.topic,
    action: eventData.action,
    hasData: !!eventData.data,
    hasResource: !!eventData.resource,
  });

  return fallbackKey;
}

/**
 * Verificar se evento é processável (de pagamento)
 */
function isEventProcessable(eventData) {
  // Verificar se é merchant_order (ignorar)
  if (eventData.topic === "merchant_order") {
    console.log("ℹ️ Evento merchant_order detectado - será ignorado");
    return false;
  }

  // Verificar se é evento de pagamento válido
  const isPaymentEvent =
    (eventData.data?.id && eventData.type === "payment") ||
    (eventData.resource && eventData.topic === "payment") ||
    (eventData.action && eventData.action.startsWith("payment.")) ||
    (eventData.id && !eventData.topic); // Formato direto

  return isPaymentEvent;
}

/**
 * Extrair payment ID do evento
 */
function extractPaymentIdFromEvent(eventData) {
  // Só fazer debug se for evento processável
  if (!isEventProcessable(eventData)) {
    return null;
  }

  console.log("🔍 DEBUG: Extraindo payment ID do evento:", {
    hasData: !!eventData.data,
    dataId: eventData.data?.id,
    type: eventData.type,
    topic: eventData.topic,
    resource: eventData.resource,
    directId: eventData.id,
    action: eventData.action,
  });

  // Formato novo: { data: { id: "123" }, type: "payment" }
  if (eventData.data && eventData.data.id && eventData.type === "payment") {
    const paymentId = eventData.data.id.toString();
    console.log(`✅ Payment ID extraído do formato NOVO: ${paymentId}`);
    return paymentId;
  }

  // Formato antigo: { resource: "https://api.../payments/123", topic: "payment" }
  if (eventData.resource && eventData.topic === "payment") {
    const match = eventData.resource.match(/payments\/(\d+)/);
    if (match) {
      const paymentId = match[1];
      console.log(`✅ Payment ID extraído do formato ANTIGO: ${paymentId}`);
      return paymentId;
    }
  }

  // Formato direto com ID
  if (eventData.id && !eventData.topic) {
    const paymentId = eventData.id.toString();
    console.log(`✅ Payment ID extraído do formato DIRETO: ${paymentId}`);
    return paymentId;
  }

  console.log(
    "❌ NENHUM payment ID encontrado - evento será ignorado ou terá chave genérica"
  );
  return null;
}

/**
 * Verificar se evento já está sendo processado ou foi processado
 */
function isEventDuplicated(eventKey, paymentId) {
  const now = Date.now();

  // Verificar por chave exata
  if (webhookEventCache.has(eventKey)) {
    const cached = webhookEventCache.get(eventKey);
    const timeDiff = now - cached.timestamp;

    console.log(
      `⚠️ Evento duplicado detectado por chave: ${eventKey} (${timeDiff}ms ago)`
    );

    if (cached.processed) {
      console.log(`✅ Evento ${eventKey} já foi processado com sucesso`);
      return { isDuplicate: true, reason: "already_processed" };
    }

    if (timeDiff < WEBHOOK_PROCESSING_WINDOW) {
      console.log(
        `🔄 Evento ${eventKey} ainda está sendo processado (${timeDiff}ms)`
      );
      return { isDuplicate: true, reason: "currently_processing" };
    }
  }

  // Se tem paymentId, verificar se há outros eventos para o mesmo pagamento
  if (paymentId) {
    for (const [key, data] of webhookEventCache.entries()) {
      if (data.paymentId === paymentId && key !== eventKey) {
        const timeDiff = now - data.timestamp;

        if (timeDiff < WEBHOOK_PROCESSING_WINDOW) {
          console.log(
            `⚠️ Pagamento ${paymentId} já sendo processado em outro evento (${timeDiff}ms)`
          );
          return { isDuplicate: true, reason: "payment_being_processed" };
        }

        if (data.processed) {
          console.log(
            `✅ Pagamento ${paymentId} já foi processado em evento anterior`
          );
          return { isDuplicate: true, reason: "payment_already_processed" };
        }
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Marcar evento como sendo processado
 */
function markEventAsProcessing(eventKey, paymentId) {
  webhookEventCache.set(eventKey, {
    timestamp: Date.now(),
    processed: false,
    paymentId: paymentId,
    status: "processing",
  });

  console.log(
    `📋 Evento marcado como processando: ${eventKey} (payment: ${paymentId})`
  );
}

/**
 * Marcar evento como processado
 */
function markEventAsProcessed(eventKey, success = true) {
  if (webhookEventCache.has(eventKey)) {
    const cached = webhookEventCache.get(eventKey);
    cached.processed = true;
    cached.success = success;
    cached.completedAt = Date.now();

    console.log(
      `✅ Evento marcado como ${
        success ? "processado com sucesso" : "falhou"
      }: ${eventKey}`
    );
  }
}

// ==================== FIM DO CACHE LOCAL ====================

/**
 * GET /api/subscriptions/plans
 * Retorna informações dos planos disponíveis (endpoint público)
 */
router.get("/plans", (req, res) => {
  try {
    const plans = {
      monthly: {
        id: "monthly",
        name: "Plano Mensal",
        price: planPrices.monthly,
        currency: "BRL",
        description: "Acesso completo ao ViaPet",
        benefits: [
          "Agendamento ilimitado de consultas",
          "Histórico completo dos pets",
          "Lembretes automáticos",
          "Suporte prioritário",
          "Acesso ao app móvel",
          "Backup automático dos dados",
        ],
        billing_cycle: "monthly",
        trial_period: {
          enabled: false,
          duration_days: 0,
          description: "Pagamento imediato necessário",
        },
      },
      promotional: {
        id: "promotional",
        name: "Promoção Especial",
        price: planPrices.promotional,
        original_price: planPrices.monthly,
        currency: "BRL",
        description: "Oferta especial por tempo limitado",
        benefits: [
          "Agendamento ilimitado de consultas",
          "Histórico completo dos pets",
          "Lembretes automáticos",
          "Suporte prioritário",
          "Acesso ao app móvel",
          "Backup automático dos dados",
          "⭐ OFERTA: R$ 39,90 nos 3 primeiros meses!",
        ],
        billing_cycle: "monthly",
        promotional_period: {
          enabled: true,
          duration_months: 3,
          price: planPrices.promotional,
          description: "R$ 39,90 nos 3 primeiros meses, depois R$ 69,90/mês",
        },
        trial_period: {
          enabled: false,
          duration_days: 0,
          description: "Pagamento imediato necessário",
        },
      },
    };

    res.json({
      success: true,
      plans,
      current_promotion: {
        enabled: true,
        title: "Oferta Especial de Lançamento!",
        subtitle: "R$ 39,90 nos 3 primeiros meses + 1º mês grátis",
        expires_at: "2025-12-31T23:59:59.000Z",
      },
    });
  } catch (error) {
    console.error("Erro ao buscar planos:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
    });
  }
});

/**
 * POST /api/subscriptions/create
 * Criar nova assinatura e preferência de pagamento
 */
router.post("/create", auth, async (req, res) => {
  try {
    const { plan_type = "monthly", payment_methods } = req.body;
    const userId = req.user.id; // ID do usuário do token JWT

    // Buscar dados do usuário
    const user = await Users.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Usuário não encontrado",
      });
    }

    // Verificar se o usuário já tem uma assinatura ativa
    const existingSubscription = await Subscription.findOne({
      where: {
        user_id: userId,
        status: ["active", "pending"],
      },
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        error: "Você já possui uma assinatura ativa ou pendente",
        subscription: existingSubscription,
      });
    }

    // Verificar se usuário já usou plano promocional anteriormente
    if (plan_type === 'promotional') {
      const previousPromotionalSubscription = await Subscription.findOne({
        where: {
          user_id: userId,
          plan_type: 'promotional'
        }
      });

      if (previousPromotionalSubscription) {
        return res.status(400).json({
          success: false,
          error: "O plano promocional só pode ser acionado uma vez",
          error_code: "PROMOTIONAL_ALREADY_USED"
        });
      }
    }

    // Validar tipo de plano
    if (!["monthly", "promotional"].includes(plan_type)) {
      return res.status(400).json({
        success: false,
        error: "Tipo de plano inválido",
      });
    }

    // Criar registro da assinatura no banco
    const subscriptionId = uuidv4();
    const amount =
      plan_type === "promotional" ? planPrices.promotional : planPrices.monthly;

    const subscription = await Subscription.create({
      id: subscriptionId,
      user_id: userId,
      plan_type,
      status: "pending",
      amount,
      currency: "BRL",
      promotional_months_used: 0,
    });

    // Aplicar período trial apenas para planos do tipo "trial"
    if (plan_type === 'trial') {
      const trialResult = await applyTrialPeriod(subscription);

      if (!trialResult.success) {
        console.error("Erro ao aplicar período trial:", trialResult.error);
        // Não falha a criação da assinatura, apenas loga o erro
      } else {
        console.log(
          `🆓 Período trial aplicado para novo usuário ${user.name} (${user.email})`
        );
      }
    } else {
      // Para planos monthly e promotional, ativar imediatamente sem trial
      await subscription.update({
        status: "active",
        billing_cycle_start: new Date(),
        next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Próximo billing em 30 dias
      });
      
      console.log(
        `💳 Assinatura ${plan_type} ativada para usuário ${user.name} (${user.email}) - sem período trial`
      );
    }

    // Para planos monthly e promotional, criar preferência de pagamento imediatamente
    // Para planos trial, a preferência será criada quando o período trial estiver próximo do fim

    const isTrialPlan = plan_type === 'trial';
    const trialDaysRemaining = isTrialPlan && subscription.trial_end 
      ? Math.ceil((new Date(subscription.trial_end) - new Date()) / (1000 * 60 * 60 * 24))
      : 0;

    res.json({
      success: true,
      subscription: {
        id: subscription.id,
        plan_type: subscription.plan_type,
        amount: subscription.amount,
        status: subscription.status,
        trial_start: subscription.trial_start,
        trial_end: subscription.trial_end,
        next_billing_date: subscription.next_billing_date,
        is_trial: isTrialPlan,
        trial_days_remaining: trialDaysRemaining,
      },
      message: isTrialPlan 
        ? "Período trial ativado! Aproveite 1 mês grátis dos recursos do ViaPet."
        : `Assinatura ${plan_type} ativada! Pagamento necessário para continuar usando os recursos.`,
      payment: {
        required: !isTrialPlan,
        trial_period: isTrialPlan,
        next_payment_date: subscription.next_billing_date,
      },
    });
  } catch (error) {
    console.error("Erro ao criar assinatura:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

/**
 * POST /api/subscriptions/create-payment
 * Cria uma preferência de pagamento no Mercado Pago
 * Suporta dois formatos:
 * 1. Com auth: { plan_type, amount } - extrai dados do usuário do token JWT
 * 2. Sem auth: { userId, email, amount, description } - dados fornecidos diretamente
 * [UPDATED]
 */
router.post("/create-payment", async (req, res) => {
  try {
    console.log("🔥 CREATE-PAYMENT ENDPOINT CHAMADO!", {
      timestamp: new Date().toISOString(),
      body: req.body,
      hasAuth: !!req.headers.authorization,
      userAgent: req.headers["user-agent"],
      origin: req.headers.origin,
    });

    let userId, userEmail, paymentAmount, paymentDescription;

    // Verificar se há token de autorização
    const authHeader = req.headers.authorization;
    const hasAuth = authHeader && authHeader.startsWith("Bearer ");

    const { plan_type, amount } = req.body;

    if (hasAuth) {
      // Formato 1: Com autenticação - extrair dados do token

      if (!amount) {
        return res.status(400).json({
          error: "Campo obrigatório: amount",
        });
      }

      // Extrair usuário do token JWT
      try {
        const token = authHeader.split(" ")[1];
        const jwt = await import("jsonwebtoken");
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
      } catch (error) {
        return res.status(401).json({
          error: "Token inválido",
        });
      }

      paymentAmount = parseFloat(amount);
      paymentDescription = plan_type
        ? `Pagamento ViaPet - Plano ${
            plan_type === "promotional" ? "Promocional" : "Mensal"
          }`
        : "Pagamento ViaPet";
    } else {
      // Formato 2: Sem autenticação - dados fornecidos diretamente
      const { userId: directUserId, email, amount, description } = req.body;

      if (!directUserId || !email || !amount || !description) {
        return res.status(400).json({
          error: "Campos obrigatórios: userId, email, amount, description",
        });
      }

      userId = directUserId;
      userEmail = email;
      paymentAmount = parseFloat(amount);
      paymentDescription = description;
    }

    // Buscar usuário
    const user = await Users.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // Usar email do usuário do banco se não foi fornecido
    if (!userEmail) {
      userEmail = user.email;
    }

    // Usar service centralizado para criar preferência (removendo duplicação)
    const preferenceData = {
      user: {
        id: user.id,
        name: user.name,
        email: userEmail,
        cpf: user.cpf,
      },
      planType: plan_type,
      amount: paymentAmount,
      externalReference: `pay_${userId}_${Date.now()}`,
      customData: {
        title: paymentDescription,
        category: "payment",
        user_id: userId,
        is_viapet_payment: true,
      },
    };

    const preference = await createSubscriptionPreference(preferenceData);

    if (!preference.success) {
      console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      return res.status(400).json({
        error: "Erro ao criar preferência de pagamento",
        details: preference.error,
      });
    }

    console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
    console.log(
      `✅ Checkout simples criado para usuário ${userId} (${userEmail}):`,
      preference.id
    );

    const responseData = {
      success: true,
      preference_id: preference.id,
      init_point: preference.init_point,
      sandbox_init_point:
        preference.preference?.sandbox_init_point ||
        preference.sandbox_init_point,
    };

    console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
    console.log("📤 Enviando resposta para frontend:", responseData);

    res.json(responseData);
  } catch (error) {
    console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
    console.error("Erro ao criar checkout:", error);
    res.status(500).json({
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

/**
 * POST /api/subscriptions/webhook
 * Webhook para receber notificações do Mercado Pago
 *
 * Eventos suportados:
 * - payment.created: Novo pagamento criado
 * - payment.updated: Status do pagamento atualizado
 * - payment.approved: Pagamento aprovado
 * - payment.rejected: Pagamento rejeitado
 * - payment.cancelled: Pagamento cancelado
 */
router.post("/webhook", async (req, res) => {
  const startTime = Date.now();
  let eventKey = null;

  try {
    console.log("🔔 Mercado Pago Webhook recebido:", {
      timestamp: new Date().toISOString(),
      body: req.body,
      headers: {
        "x-signature": req.headers["x-signature"],
        "x-request-id": req.headers["x-request-id"],
      },
    });

    // Verificar se evento é processável antes de continuar
    if (!isEventProcessable(req.body)) {
      console.log(
        `🚫 Evento ignorado - tipo não processável: ${
          req.body.topic || req.body.type || "unknown"
        }`
      );

      return res.status(200).json({
        received: true,
        processed: false,
        ignored: true,
        reason: `Evento ${
          req.body.topic || req.body.type || "unknown"
        } não é processado pelo sistema`,
        message: "Evento ignorado - tipo não suportado",
      });
    }

    // Gerar chave única para este evento (só para eventos processáveis)
    eventKey = generateWebhookEventKey(req.body, req.headers);
    const paymentId = extractPaymentIdFromEvent(req.body);

    // Se não conseguiu gerar chave, o evento não é válido
    if (!eventKey) {
      console.log(
        `🚫 Evento ignorado - não foi possível gerar chave de identificação`
      );

      return res.status(200).json({
        received: true,
        processed: false,
        ignored: true,
        reason: "Não foi possível identificar o evento",
        message: "Evento ignorado - formato inválido",
      });
    }

    console.log(`📋 Evento identificado: ${eventKey} (payment: ${paymentId})`);

    // Verificar se é evento duplicado usando cache local
    const duplicateCheck = isEventDuplicated(eventKey, paymentId);

    if (duplicateCheck.isDuplicate) {
      console.log(
        `🚫 Evento duplicado detectado - ${duplicateCheck.reason}. Ignorando processamento.`
      );
      return res.status(200).json({
        received: true,
        processed: false,
        duplicate: true,
        reason: duplicateCheck.reason,
        eventKey: eventKey,
        message: "Evento duplicado ignorado pelo cache local",
      });
    }

    // Marcar evento como sendo processado
    markEventAsProcessing(eventKey, paymentId);

    // Usar validação centralizada
    if (!(await validateWebhookSignature(req))) {
      console.error("❌ Assinatura inválida - possível tentativa de fraude");
      markEventAsProcessed(eventKey, false);
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log(`✅ Webhook validado com sucesso`);
    console.log(`📋 Iniciando processamento do evento:`);

    // Usar processamento centralizado
    const eventResult = await processWebhookEvent(req.body);

    if (!eventResult.success) {
      console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      console.log("⚠️ Falha ao processar evento:", eventResult.error);

      markEventAsProcessed(eventKey, false);

      return res.status(200).json({
        received: true,
        processed: false,
        error: eventResult.error,
        eventKey: eventKey,
      });
    }

    // Verificar se foi um evento duplicado que foi ignorado no service
    if (eventResult.duplicate) {
      console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
      console.log("✅ Evento duplicado ignorado pelo service");

      markEventAsProcessed(eventKey, true);

      return res.status(200).json({
        received: true,
        processed: true,
        duplicate: true,
        message: "Evento duplicado ignorado pelo service",
        eventKey: eventKey,
      });
    }

    const { payment } = eventResult;

    console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
    console.log(`✅ Pagamento processado:`, {
      id: payment.id,
      status: payment.status,
      amount: payment.transaction_amount,
      external_reference: payment.external_reference,
    });

    // Processar pagamento aprovado
    if (payment.status === "approved") {
      await processSimplePaymentApproval(payment);
    }

    // Marcar evento como processado com sucesso
    markEventAsProcessed(eventKey, true);

    const processingTime = Date.now() - startTime;
    console.log(`⏱️ Webhook processado em ${processingTime}ms`);

    res.status(200).json({
      received: true,
      processed: true,
      payment_id: payment.id,
      status: payment.status,
      eventKey: eventKey,
      processingTime: processingTime,
    });
  } catch (error) {
    console.error("💥 Erro no webhook de pagamento simples:", error);

    // Marcar evento como falhou se temos eventKey
    if (eventKey) {
      markEventAsProcessed(eventKey, false);
    }

    const processingTime = Date.now() - startTime;
    console.log(`⏱️ Webhook falhou após ${processingTime}ms`);

    res.status(200).json({
      received: true,
      processed: false,
      error: error.message,
      eventKey: eventKey,
      processingTime: processingTime,
    });
  }
});

/**
 * POST /api/subscriptions/cancel
 * Cancelar assinatura do usuário
 */
router.post("/cancel", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body;

    const subscription = await Subscription.findOne({
      where: {
        user_id: userId,
        status: ["active", "pending"],
      },
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Nenhuma assinatura ativa encontrada",
      });
    }

    await subscription.update({
      status: "cancelled",
      notes: reason
        ? `Cancelado pelo usuário: ${reason}`
        : "Cancelado pelo usuário",
    });

    res.json({
      success: true,
      message: "Assinatura cancelada com sucesso",
      subscription: {
        id: subscription.id,
        status: subscription.status,
      },
    });
  } catch (error) {
    console.error("Erro ao cancelar assinatura:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
    });
  }
});

/**
 * GET /api/subscriptions/my-subscription
 * Retorna informações da assinatura do usuário logado
 */
router.get("/my-subscription", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const requestId = req.headers["x-request-id"] || `req_${Date.now()}`;

    console.log(
      `🔍 [${requestId}] CONSULTA DE ASSINATURA - usuário: ${userId}`
    );
    console.log(
      `📍 [${requestId}] User-Agent: ${
        req.headers["user-agent"]?.substring(0, 50) || "N/A"
      }`
    );
    console.log(`📍 [${requestId}] Origin: ${req.headers.origin || "N/A"}`);
    console.log(`📍 [${requestId}] Referer: ${req.headers.referer || "N/A"}`);

    // Verificar rate limiting
    const rateLimitCheck = checkSubscriptionQueryRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      console.log(
        `⚠️ [${requestId}] RATE LIMIT ATINGIDO para usuário ${userId}: ${rateLimitCheck.message}`
      );
      return res.status(429).json({
        success: false,
        error: "Muitas consultas",
        message: rateLimitCheck.message,
        waitTime: rateLimitCheck.waitTime,
        requestId: requestId,
      });
    }

    console.log(
      `📊 [${requestId}] Rate limit OK - restantes: ${rateLimitCheck.remaining}`
    );

    // Verificar cache de resposta
    const cachedResponse = getSubscriptionFromCache(userId);
    if (cachedResponse) {
      console.log(
        `📋 [${requestId}] RETORNANDO DO CACHE para usuário: ${userId}`
      );
      cachedResponse.cached = true;
      cachedResponse.requestId = requestId;
      return res.json(cachedResponse);
    }

    console.log(`💾 [${requestId}] Cache miss - consultando banco de dados`);

    console.log(
      "OBJETO",
      JSON.stringify({
        userId,
        test: "testing",
      })
    );

    // Primeiro, verificar se o usuário existe
    const user = await Users.findByPk(userId);
    if (!user) {
      console.log("❌ Usuário não encontrado:", userId);
      const errorResponse = {
        success: false,
        error: "Usuário não encontrado",
      };
      return res.status(404).json(errorResponse);
    }

    console.log("✅ Usuário encontrado:", user.name);

    // Buscar assinatura ativa do usuário com histórico de pagamentos
    const subscription = await Subscription.findOne({
      where: {
        user_id: userId,
      },
      include: [
        {
          model: PaymentHistory,
          as: "paymentHistory",
          required: false, // LEFT JOIN para permitir assinaturas sem histórico
          order: [["created_at", "DESC"]],
        },
        {
          model: Users,
          as: "user",
          required: true, // INNER JOIN para garantir que o usuário existe
          attributes: ["id", "name", "email"],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    console.log(
      "📊 Resultado da busca:",
      subscription ? "Assinatura encontrada" : "Sem assinatura"
    );

    if (!subscription) {
      console.log("ℹ️ Nenhuma assinatura encontrada para o usuário");
      const response = {
        success: true,
        subscription: null,
        status: "no_subscription",
        message: "Usuário não possui assinatura",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        cached: false,
        rateLimitRemaining: rateLimitCheck.remaining,
      };

      // Cachear resposta por tempo menor para usuários sem assinatura
      cacheSubscriptionResponse(userId, response);
      return res.json(response);
    }

    // Calcular status da assinatura
    const now = new Date();
    let subscriptionStatus = subscription.status;
    let statusLabel = "Ativa";
    let isInTrial = false;
    let daysUntilExpiry = null;

    // Verificar se está no período trial
    if (subscription.trial_start && subscription.trial_end) {
      const trialStart = new Date(subscription.trial_start);
      const trialEnd = new Date(subscription.trial_end);

      if (now >= trialStart && now <= trialEnd) {
        isInTrial = true;
        statusLabel = "Período Gratuito";
        daysUntilExpiry = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      }
    }

    // Verificar se a assinatura está vencida
    if (
      subscription.next_billing_date &&
      now > new Date(subscription.next_billing_date)
    ) {
      if (subscriptionStatus === "active") {
        subscriptionStatus = "expired";
        statusLabel = "Vencida";

        // Atualizar status no banco de dados para refletir que está vencida
        await subscription.update({ status: "expired" });
        console.log(
          `⏰ Assinatura ${subscription.id} marcada como vencida automaticamente`
        );
      }
    }

    // Calcular próxima renovação
    let nextRenewalDate = subscription.next_billing_date;
    if (isInTrial && subscription.trial_end) {
      nextRenewalDate = subscription.trial_end;
    }

    // Preparar dados de resposta
    const responseData = {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscriptionStatus,
        statusLabel,
        plan_type: subscription.plan_type,
        amount: parseFloat(subscription.amount),
        currency: subscription.currency,
        created_at: subscription.created_at,
        trial_start: subscription.trial_start,
        trial_end: subscription.trial_end,
        billing_cycle_start: subscription.billing_cycle_start,
        billing_cycle_end: subscription.billing_cycle_end,
        next_billing_date: nextRenewalDate,
        promotional_months_used: subscription.promotional_months_used,
        isInTrial,
        daysUntilExpiry,
        user: subscription.user,
      },
      paymentHistory: subscription.paymentHistory || [],
      planInfo: {
        name:
          subscription.plan_type === "promotional"
            ? "Plano Promocional"
            : "Plano Mensal",
        price:
          subscription.plan_type === "promotional"
            ? planPrices.promotional
            : planPrices.monthly,
        originalPrice: planPrices.monthly,
        isPromotional: subscription.plan_type === "promotional",
        promotionalMonthsRemaining:
          subscription.plan_type === "promotional"
            ? Math.max(0, 3 - subscription.promotional_months_used)
            : 0,
      },
      cached: false,
      rateLimitRemaining: rateLimitCheck.remaining,
    };

    // Cachear resposta
    cacheSubscriptionResponse(userId, responseData);

    res.json(responseData);
  } catch (error) {
    console.error("❌ Erro ao buscar assinatura:", {
      userId: req.user?.id,
      error: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name,
    });

    // Se for erro de associação/relação
    if (error.name === "SequelizeEagerLoadingError") {
      return res.status(500).json({
        success: false,
        error: "Erro ao carregar dados relacionados da assinatura",
        details: error.message,
      });
    }

    // Se for erro de conexão com banco
    if (
      error.name === "SequelizeConnectionError" ||
      error.name === "SequelizeConnectionRefusedError"
    ) {
      return res.status(503).json({
        success: false,
        error: "Serviço temporariamente indisponível",
        details: "Erro de conexão com o banco de dados",
      });
    }

    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      message: error.message,
      requestId: req.headers["x-request-id"] || uuidv4(),
    });
  }
});

/**
 * GET /api/subscriptions/payment-history
 * Retorna histórico de pagamentos do usuário logado
 */
router.get("/payment-history", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const offset = (page - 1) * limit;

    const { count, rows: payments } = await PaymentHistory.findAndCountAll({
      where: {
        user_id: userId,
      },
      include: [
        {
          model: Subscription,
          as: "subscription",
          attributes: ["id", "plan_type", "amount"],
        },
      ],
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    // Calcular estatísticas
    const totalPaid = await PaymentHistory.sum("amount", {
      where: {
        user_id: userId,
        status: "approved",
      },
    });

    const lastPayment = payments.length > 0 ? payments[0] : null;

    res.json({
      success: true,
      payments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
      statistics: {
        totalPaid: totalPaid || 0,
        totalPayments: count,
        lastPaymentDate: lastPayment
          ? lastPayment.date_approved || lastPayment.created_at
          : null,
        lastPaymentAmount: lastPayment ? parseFloat(lastPayment.amount) : 0,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar histórico de pagamentos:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
    });
  }
});

/**
 * POST /api/subscriptions/update-status
 * Atualiza status da assinatura (webhook interno ou admin)
 */
router.post("/update-status", auth, async (req, res) => {
  try {
    const { subscriptionId, status, paymentData } = req.body;
    const userId = req.user.id;

    const subscription = await Subscription.findOne({
      where: {
        id: subscriptionId,
        user_id: userId,
      },
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Assinatura não encontrada",
      });
    }

    // Atualizar status da assinatura
    const updateData = { status };

    // Se o pagamento foi aprovado, calcular próxima cobrança
    if (status === "active" && paymentData) {
      const now = new Date();
      const nextBilling = new Date(now);
      nextBilling.setMonth(nextBilling.getMonth() + 1);

      updateData.billing_cycle_start = now;
      updateData.billing_cycle_end = nextBilling;
      updateData.next_billing_date = nextBilling;

      // Se é promoção, incrementar contador de meses promocionais
      if (subscription.plan_type === "promotional") {
        updateData.promotional_months_used =
          subscription.promotional_months_used + 1;

        // Se atingiu 3 meses promocionais, mudar para plano mensal
        if (updateData.promotional_months_used >= 3) {
          updateData.plan_type = "monthly";
          updateData.amount = planPrices.monthly;
        }
      }

      // Criar registro no histórico de pagamentos
      if (paymentData.payment_id) {
        await PaymentHistory.create({
          subscription_id: subscription.id,
          user_id: userId,
          payment_id: paymentData.payment_id,
          status: paymentData.status || "approved",
          amount: paymentData.amount || subscription.amount,
          currency: subscription.currency,
          payment_method: paymentData.payment_method,
          payment_type: paymentData.payment_type,
          installments: paymentData.installments || 1,
          date_created: paymentData.date_created || now,
          date_approved: paymentData.date_approved || now,
          billing_period_start: now,
          billing_period_end: nextBilling,
          plan_type: subscription.plan_type,
          is_trial: false,
          webhook_data: null,
        });
      }
    }

    await subscription.update(updateData);

    res.json({
      success: true,
      message: "Status da assinatura atualizado com sucesso",
      subscription: {
        id: subscription.id,
        status: subscription.status,
        next_billing_date: subscription.next_billing_date,
      },
    });
  } catch (error) {
    console.error("Erro ao atualizar status da assinatura:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
    });
  }
});

/**
 * ADMIN ROUTES
 * Rotas administrativas para gerenciar assinaturas
 */

/**
 * GET /api/subscriptions/admin/all-subscriptions
 * Lista todas as assinaturas com dados dos usuários (ADMIN ONLY)
 */
router.get("/admin/all-subscriptions", async (req, res) => {
  try {
    console.log("🔍 Buscando todas as assinaturas do banco de dados...");

    const subscriptions = await Subscription.findAll({
      include: [
        {
          model: Users,
          as: "user",
          attributes: ["id", "name", "email", "createdAt"],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    console.log(`✅ Encontradas ${subscriptions.length} assinaturas no banco`);

    // Calcular se está em trial period
    const subscriptionsWithTrialInfo = subscriptions.map((subscription) => {
      const createdDate = new Date(subscription.created_at);
      const now = new Date();
      const daysDifference = Math.floor(
        (now - createdDate) / (1000 * 60 * 60 * 24)
      );

      const isInTrial =
        subscription.plan_type === "monthly" &&
        subscription.status === "active" &&
        daysDifference <= 30;

      return {
        ...subscription.toJSON(),
        isInTrial,
      };
    });

    res.json({
      success: true,
      subscriptions: subscriptionsWithTrialInfo,
      total: subscriptions.length,
      summary: {
        active: subscriptions.filter((s) => s.status === "active").length,
        pending: subscriptions.filter((s) => s.status === "pending").length,
        expired: subscriptions.filter((s) => s.status === "expired").length,
        cancelled: subscriptions.filter((s) => s.status === "cancelled").length,
        suspended: subscriptions.filter((s) => s.status === "suspended").length,
      },
    });
  } catch (error) {
    console.error("❌ Erro ao buscar todas as assinaturas:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

/**
 * GET /api/subscriptions/admin/payment-history/:userId
 * Busca histórico de pagamentos de um usuário específico (ADMIN ONLY)
 */
router.get("/admin/payment-history/:userId", auth, async (req, res) => {
  try {
    // Verificar se o usuário é admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        error:
          "Acesso negado. Apenas administradores podem acessar esta funcionalidade.",
      });
    }

    const { userId } = req.params;

    // Verificar se o usuário existe
    const user = await Users.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Usuário não encontrado",
      });
    }

    // Buscar assinatura do usuário
    const subscription = await Subscription.findOne({
      where: { user_id: userId },
    });

    if (!subscription) {
      return res.json({
        success: true,
        paymentHistory: [],
        message: "Usuário não possui assinatura",
      });
    }

    // Buscar histórico de pagamentos
    const paymentHistory = await PaymentHistory.findAll({
      where: { subscription_id: subscription.id },
      order: [["created_at", "DESC"]],
    });

    // Adicionar entrada para trial period se aplicável
    const createdDate = new Date(subscription.created_at);
    const now = new Date();
    const daysDifference = Math.floor(
      (now - createdDate) / (1000 * 60 * 60 * 24)
    );

    const isInTrial =
      subscription.plan_type === "monthly" &&
      subscription.status === "active" &&
      daysDifference <= 30;

    let historyWithTrial = [...paymentHistory];

    if (isInTrial || daysDifference <= 35) {
      // Mostrar trial mesmo se passou um pouco
      // Adicionar entrada de trial no início
      const trialEntry = {
        id: `trial-${subscription.id}`,
        subscription_id: subscription.id,
        amount: 0,
        status: "approved",
        is_trial: true,
        created_at: subscription.created_at,
        date_approved: subscription.created_at,
        payment_method: null,
        billing_period_start: subscription.created_at,
        billing_period_end: new Date(
          createdDate.getTime() + 30 * 24 * 60 * 60 * 1000
        ),
      };

      historyWithTrial.unshift(trialEntry);
    }

    res.json({
      success: true,
      paymentHistory: historyWithTrial,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan_type: subscription.plan_type,
        created_at: subscription.created_at,
        isInTrial,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar histórico de pagamentos:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
    });
  }
});

/**
 * PUT /api/subscriptions/admin/update-status/:subscriptionId
 * Atualiza status de uma assinatura (ADMIN ONLY)
 */
router.put("/admin/update-status/:subscriptionId", auth, async (req, res) => {
  try {
    // Verificar se o usuário é admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        error:
          "Acesso negado. Apenas administradores podem acessar esta funcionalidade.",
      });
    }

    const { subscriptionId } = req.params;
    const { status, reason } = req.body;

    // Validar status
    const validStatuses = [
      "active",
      "pending",
      "expired",
      "cancelled",
      "suspended",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Status inválido",
      });
    }

    // Buscar assinatura
    const subscription = await Subscription.findByPk(subscriptionId, {
      include: [
        {
          model: Users,
          as: "user",
          attributes: ["id", "name", "email"],
        },
      ],
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Assinatura não encontrada",
      });
    }

    const oldStatus = subscription.status;

    // Atualizar status
    await subscription.update({
      status,
      admin_notes:
        reason || `Status alterado manualmente de ${oldStatus} para ${status}`,
    });

    // Log da ação admin (opcional - criar tabela de logs se necessário)
    console.log(
      `Admin ${
        req.user.id
      } alterou status da assinatura ${subscriptionId} de ${oldStatus} para ${status}. Motivo: ${
        reason || "Não informado"
      }`
    );

    res.json({
      success: true,
      message: "Status da assinatura atualizado com sucesso",
      subscription: {
        id: subscription.id,
        user: subscription.user,
        oldStatus,
        newStatus: status,
        reason: reason || "Não informado",
      },
    });
  } catch (error) {
    console.error("Erro ao atualizar status da assinatura:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
    });
  }
});

/**
 * PUT /api/subscriptions/admin/grant-total-free/:subscriptionId
 * Concede gratuidade total até 2050 para uma assinatura (ADMIN ONLY)
 */
router.put("/admin/grant-total-free/:subscriptionId", async (req, res) => {
  try {
    console.log("🎁 Concessão de gratuidade total solicitada");

    const { subscriptionId } = req.params;
    const { reason } = req.body;

    // Buscar assinatura
    const subscription = await Subscription.findByPk(subscriptionId, {
      include: [
        {
          model: Users,
          as: "user",
          attributes: ["id", "name", "email"],
        },
      ],
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Assinatura não encontrada",
      });
    }

    // Definir data de fim em 2050
    const freeUntil = new Date("2050-12-31T23:59:59.000Z");
    const oldNextBilling = subscription.next_billing_date;

    // Atualizar assinatura
    await subscription.update({
      status: "active",
      next_billing_date: freeUntil,
      billing_cycle_end: freeUntil,
      notes: `${
        subscription.notes || ""
      }\n[${new Date().toISOString()}] GRATUIDADE TOTAL até 2050 - ${
        reason || "Concedida pelo administrador"
      }`,
    });

    console.log(
      `✅ Gratuidade total concedida para ${subscription.user.name} até 2050`
    );

    res.json({
      success: true,
      message: "Gratuidade total concedida com sucesso",
      subscription: {
        id: subscription.id,
        user: subscription.user,
        oldNextBilling,
        newNextBilling: freeUntil,
        reason: reason || "Gratuidade total concedida",
      },
    });
  } catch (error) {
    console.error("❌ Erro ao conceder gratuidade total:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

/**
 * PUT /api/subscriptions/admin/grant-monthly-free/:subscriptionId
 * Concede gratuidade por meses para uma assinatura (ADMIN ONLY)
 */
router.put("/admin/grant-monthly-free/:subscriptionId", async (req, res) => {
  try {
    console.log("📅 Concessão de gratuidade mensal solicitada");

    const { subscriptionId } = req.params;
    const { months, reason } = req.body;

    // Validar entrada
    if (!months || months <= 0 || months > 120) {
      return res.status(400).json({
        success: false,
        error: "Número de meses deve ser entre 1 e 120",
      });
    }

    // Buscar assinatura
    const subscription = await Subscription.findByPk(subscriptionId, {
      include: [
        {
          model: Users,
          as: "user",
          attributes: ["id", "name", "email"],
        },
      ],
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Assinatura não encontrada",
      });
    }

    // Calcular nova data de cobrança
    const currentNextBilling = new Date(
      subscription.next_billing_date || new Date()
    );
    const newNextBilling = new Date(currentNextBilling);
    newNextBilling.setMonth(newNextBilling.getMonth() + parseInt(months));

    // Calcular nova data de fim do ciclo
    const newBillingEnd = new Date(newNextBilling);
    newBillingEnd.setDate(newBillingEnd.getDate() - 1);

    const oldNextBilling = subscription.next_billing_date;

    // Atualizar assinatura
    await subscription.update({
      status: "active",
      next_billing_date: newNextBilling,
      billing_cycle_end: newBillingEnd,
      notes: `${
        subscription.notes || ""
      }\n[${new Date().toISOString()}] GRATUIDADE de ${months} mês(es) - ${
        reason || "Concedida pelo administrador"
      }`,
    });

    console.log(
      `✅ ${months} mês(es) de gratuidade concedido(s) para ${subscription.user.name}`
    );

    res.json({
      success: true,
      message: `${months} mês(es) de gratuidade concedido(s) com sucesso`,
      subscription: {
        id: subscription.id,
        user: subscription.user,
        monthsAdded: months,
        oldNextBilling,
        newNextBilling,
        reason: reason || `Gratuidade de ${months} mês(es) concedida`,
      },
    });
  } catch (error) {
    console.error("❌ Erro ao conceder gratuidade mensal:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

/**
 * GET /api/subscriptions/webhook-cache-status
 * Endpoint para verificar status do cache de webhooks (APENAS DESENVOLVIMENTO)
 */
router.get("/webhook-cache-status", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res
      .status(404)
      .json({ error: "Endpoint não disponível em produção" });
  }

  try {
    const now = Date.now();
    const cacheEntries = [];

    for (const [eventKey, data] of webhookEventCache.entries()) {
      const age = now - data.timestamp;
      cacheEntries.push({
        eventKey,
        paymentId: data.paymentId,
        processed: data.processed,
        success: data.success,
        status: data.status,
        ageMs: age,
        ageSeconds: Math.round(age / 1000),
        timestamp: new Date(data.timestamp).toISOString(),
        completedAt: data.completedAt
          ? new Date(data.completedAt).toISOString()
          : null,
      });
    }

    // Ordenar por timestamp (mais recente primeiro)
    cacheEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    res.json({
      success: true,
      cache: {
        totalEntries: webhookEventCache.size,
        ttlMs: WEBHOOK_CACHE_TTL,
        processingWindowMs: WEBHOOK_PROCESSING_WINDOW,
        entries: cacheEntries,
      },
      statistics: {
        processing: cacheEntries.filter((e) => !e.processed).length,
        completed: cacheEntries.filter((e) => e.processed).length,
        successful: cacheEntries.filter((e) => e.success === true).length,
        failed: cacheEntries.filter((e) => e.success === false).length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erro ao obter status do cache:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao obter status do cache",
      details: error.message,
    });
  }
});

/**
 * POST /api/subscriptions/clear-webhook-cache
 * Endpoint para limpar cache de webhooks (APENAS DESENVOLVIMENTO)
 */
router.post("/clear-webhook-cache", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res
      .status(404)
      .json({ error: "Endpoint não disponível em produção" });
  }

  try {
    const sizeBefore = webhookEventCache.size;
    webhookEventCache.clear();

    console.log(
      `🧹 Cache de webhooks limpo manualmente: ${sizeBefore} eventos removidos`
    );

    res.json({
      success: true,
      message: "Cache de webhooks limpo com sucesso",
      entriesRemoved: sizeBefore,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erro ao limpar cache:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao limpar cache",
      details: error.message,
    });
  }
});

/**
 * POST /api/subscriptions/test-webhook
 * Endpoint para testar processamento de webhook (APENAS DESENVOLVIMENTO)
 */
router.post("/test-webhook", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res
      .status(404)
      .json({ error: "Endpoint não disponível em produção" });
  }

  try {
    console.log("🧪 TESTE DE WEBHOOK INICIADO");

    // Simular dados de pagamento aprovado
    const mockPaymentData = {
      id: "test_payment_123",
      status: "approved",
      transaction_amount: 1.0,
      currency_id: "BRL",
      payment_method_id: "pix",
      external_reference:
        "pay_b8247818-4488-42ed-97ef-87b3ff2d916a_1756670447523",
      payer: {
        email: "fulano2@fulano.com",
        identification: {
          type: "CPF",
          number: "12345678901",
        },
      },
      date_created: new Date().toISOString(),
      date_approved: new Date().toISOString(),
      metadata: {
        user_id: "b8247818-4488-42ed-97ef-87b3ff2d916a",
        is_viapet_payment: true,
        category: "payment",
      },
    };

    // Processar como se fosse um pagamento real aprovado
    console.log("🎉 Simulando pagamento aprovado:", mockPaymentData);

    await processSimplePaymentApproval(mockPaymentData);

    res.json({
      success: true,
      message: "Webhook de teste processado com sucesso",
      mock_payment: mockPaymentData,
      processed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erro no teste de webhook:", error);
    res.status(500).json({
      success: false,
      error: "Erro no teste de webhook",
      details: error.message,
    });
  }
});

/**
 * GET /api/subscriptions/webhook-cache-stats
 * Endpoint para verificar estatísticas do cache de webhooks (APENAS DESENVOLVIMENTO)
 */
router.get("/webhook-cache-stats", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res
      .status(404)
      .json({ error: "Endpoint não disponível em produção" });
  }

  try {
    const { getWebhookCacheStats } = await import("../service/mercadopago.js");
    const stats = getWebhookCacheStats();

    res.json({
      success: true,
      webhook_cache: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erro ao obter estatísticas do cache:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao obter estatísticas do cache",
      details: error.message,
    });
  }
});

/**
 * POST /api/subscriptions/clear-webhook-cache
 * Endpoint para limpar cache de webhooks (APENAS DESENVOLVIMENTO)
 */
router.post("/clear-webhook-cache", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res
      .status(404)
      .json({ error: "Endpoint não disponível em produção" });
  }

  try {
    const { clearWebhookCache } = await import("../service/mercadopago.js");
    const result = clearWebhookCache();

    res.json({
      success: true,
      message: "Cache de webhooks limpo com sucesso",
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erro ao limpar cache:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao limpar cache",
      details: error.message,
    });
  }
});

// ==================== FUNÇÕES AUXILIARES ====================

/**
 * Processar aprovação de pagamento simples (removendo duplicação da lógica)
 * @param {Object} paymentData - Dados do pagamento aprovado
 */
async function processSimplePaymentApproval(paymentData) {
  try {
    // VERIFICAÇÃO INICIAL: Evitar processamento duplicado
    const existingPayment = await PaymentHistory.findOne({
      where: {
        payment_id: paymentData.id.toString(),
      },
    });

    if (existingPayment) {
      console.log(
        `⚠️ PAGAMENTO DUPLICADO DETECTADO: ${paymentData.id} já processado anteriormente`
      );
      console.log(`📋 Pagamento existente:`, {
        id: existingPayment.id,
        payment_id: existingPayment.payment_id,
        status: existingPayment.status,
        amount: existingPayment.amount,
        user_id: existingPayment.user_id,
        created_at: existingPayment.created_at,
      });
      return; // Sai da função imediatamente
    }

    // Extrair user_id do external_reference ou metadata
    const userId = extractUserIdFromPayment(paymentData);

    if (!userId) {
      console.error(
        "❌ Usuário não identificado no pagamento:",
        paymentData.id
      );
      return;
    }

    console.log(`🎉 PAGAMENTO SIMPLES APROVADO para usuário ${userId}!`);

    // Buscar dados do usuário primeiro
    const user = await Users.findByPk(userId);
    if (!user) {
      console.error(`❌ Usuário ${userId} não encontrado no banco`);
      return;
    }

    // Buscar ou criar uma assinatura para pagamentos simples
    let subscription = await Subscription.findOne({
      where: { user_id: userId },
    });

    if (!subscription) {
      // Determinar tipo de plano a partir dos metadados ou baseado no valor
      let planType = "monthly"; // padrão

      // Prioridade 1: usar metadata.plan_type se disponível
      if (paymentData.metadata?.plan_type) {
        planType = paymentData.metadata.plan_type;
        console.log(`📋 Tipo de plano detectado via metadata: ${planType}`);
      } else {
        // Prioridade 2: determinar pelo valor do pagamento
        const paymentAmount = paymentData.transaction_amount || 0;
        if (paymentAmount === planPrices.promotional) {
          planType = "promotional";
        }
        console.log(
          `💰 Tipo de plano detectado via valor: ${planType} (R$ ${paymentAmount})`
        );
      }

      console.log(
        `📝 Criando assinatura ${planType} para pagamento do usuário ${userId}`
      );

      subscription = await Subscription.create({
        id: uuidv4(),
        user_id: userId,
        plan_type: planType,
        status: "active",
        amount: paymentData.transaction_amount || 0,
        currency: "BRL",
        promotional_months_used: 0,
      });
    } else {
      // Se a assinatura existe, verificar se está vencida e reativar
      const now = new Date();
      let needsUpdate = false;
      const updateData = {};

      // Se status não for ativo, reativar (incluindo pending, expired, cancelled, suspended)
      if (subscription.status !== "active") {
        console.log(
          `🔄 Ativando assinatura ${subscription.status} para usuário ${userId} após pagamento aprovado`
        );
        updateData.status = "active";
        needsUpdate = true;
      }

      // Verificar se o tipo de plano mudou baseado nos metadados do pagamento
      if (
        paymentData.metadata?.plan_type &&
        paymentData.metadata.plan_type !== subscription.plan_type
      ) {
        console.log(
          `🔄 Mudando tipo de plano de ${subscription.plan_type} para ${paymentData.metadata.plan_type}`
        );
        updateData.plan_type = paymentData.metadata.plan_type;
        needsUpdate = true;
      }

      // Calcular nova data de cobrança baseada no tipo de plano (usar o atualizado se mudou)
      const currentPlanType = updateData.plan_type || subscription.plan_type;
      let nextBilling = new Date(now);

      if (currentPlanType === "promotional") {
        // Plano promocional: próximos 3 meses
        nextBilling.setMonth(nextBilling.getMonth() + 3);
        console.log(
          `📅 Próxima cobrança promocional: ${nextBilling.toLocaleDateString()}`
        );
      } else {
        // Plano mensal: próximo mês
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        console.log(
          `📅 Próxima cobrança mensal: ${nextBilling.toLocaleDateString()}`
        );
      }

      updateData.billing_cycle_start = now;
      updateData.billing_cycle_end = nextBilling;
      updateData.next_billing_date = nextBilling;
      updateData.amount = paymentData.transaction_amount || subscription.amount;
      needsUpdate = true;

      // Se é um plano promocional (original ou atualizado), incrementar contador
      const finalPlanType = updateData.plan_type || subscription.plan_type;
      if (finalPlanType === "promotional") {
        const newPromotionalCount = subscription.promotional_months_used + 1;
        updateData.promotional_months_used = newPromotionalCount;

        // Se atingiu 3 meses promocionais, mudar para plano mensal
        if (newPromotionalCount >= 3) {
          console.log(
            `🔄 Atualizando plano promocional para mensal (${newPromotionalCount}/3 meses usados)`
          );
          updateData.plan_type = "monthly";
          updateData.amount = planPrices.monthly;
        }
      }

      if (needsUpdate) {
        await subscription.update(updateData);
        // Recarregar a instância para ter os dados atualizados
        await subscription.reload();
        console.log(
          `✅ Assinatura atualizada para status ativo - próxima cobrança: ${nextBilling.toLocaleDateString()}`
        );
      }
    }

    // Registrar no histórico de pagamentos
    const now = new Date();

    // Calcular período de cobrança baseado no tipo de plano
    let billingPeriodEnd = new Date(now);

    if (subscription.plan_type === "promotional") {
      // Plano promocional: 3 meses
      billingPeriodEnd.setMonth(billingPeriodEnd.getMonth() + 3);
      console.log(
        `📅 Período promocional: 3 meses até ${billingPeriodEnd.toLocaleDateString()}`
      );
    } else {
      // Plano mensal: 1 mês
      billingPeriodEnd.setMonth(billingPeriodEnd.getMonth() + 1);
      console.log(
        `📅 Período mensal: 1 mês até ${billingPeriodEnd.toLocaleDateString()}`
      );
    }

    await PaymentHistory.create({
      subscription_id: subscription.id,
      user_id: userId,
      payment_id: paymentData.id.toString(),
      external_reference: paymentData.external_reference,
      status: "approved",
      amount: paymentData.transaction_amount,
      currency: paymentData.currency_id || "BRL",
      payment_method: paymentData.payment_type_id,
      date_created: new Date(paymentData.date_created),
      date_approved: new Date(paymentData.date_approved),
      billing_period_start: now,
      billing_period_end: billingPeriodEnd,
      webhook_data: null,
      plan_type: paymentData.metadata.plan_type,
      is_trial: false,
    });

    console.log(
      `✅ Pagamento simples processado para ${user.name} (${user.email})`
    );

    console.log("📋 Metadados do pagamento:", {
      metadata: paymentData.metadata,
      planTypeFromMetadata: paymentData.metadata?.plan_type,
      finalPlanType: subscription.plan_type,
    });

    // Recarregar assinatura para garantir dados atualizados nos logs
    await subscription.reload();

    console.log("✅ Status da assinatura após pagamento:", {
      subscriptionId: subscription.id,
      status: subscription.status,
      nextBillingDate: subscription.next_billing_date,
      planType: subscription.plan_type,
      amount: subscription.amount,
      billingPeriod:
        subscription.plan_type === "promotional" ? "3 meses" : "1 mês",
    });

    // AQUI: Implementar lógica específica para pagamentos simples
    // Exemplos:
    // - Confirmar agendamento
    // - Liberar acesso temporário
    // - Enviar email de confirmação
    // - Ativar funcionalidade específica
    // - etc.

    console.log("💰 Detalhes do pagamento aprovado:", {
      paymentId: paymentData.id,
      userId: userId,
      amount: paymentData.transaction_amount,
      payerEmail: paymentData.payer?.email,
      dateApproved: paymentData.date_approved,
      planType: subscription.plan_type,
      billingPeriodEnd: billingPeriodEnd.toLocaleDateString(),
    });
  } catch (error) {
    console.error(
      "❌ Erro ao processar aprovação de pagamento simples:",
      error
    );
    throw error;
  }
}

/**
 * Extrair user_id do pagamento (múltiplas tentativas)
 * @param {Object} paymentData - Dados do pagamento
 * @returns {string|null} - ID do usuário ou null
 */
function extractUserIdFromPayment(paymentData) {
  // Método 1: metadata.user_id (prioridade)
  if (paymentData.metadata?.user_id) {
    return paymentData.metadata.user_id.toString();
  }

  // Método 2: external_reference no formato "simple_userId_timestamp" ou "sub_userId_timestamp"
  if (paymentData.external_reference) {
    // Para formato "simple_userId_timestamp" ou "sub_userId_timestamp"
    if (paymentData.external_reference.includes("_")) {
      const parts = paymentData.external_reference.split("_");
      if (parts.length >= 3) {
        return parts[1]; // userId está na posição 1
      }
    }

    // External reference direto (se for numérico)
    if (!isNaN(paymentData.external_reference)) {
      return paymentData.external_reference;
    }
  }

  return null;
}

export default router;
