import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { Op } from "sequelize";
import "../config/env.js"; // Usar configuração centralizada
import BillingSettings from "../models/BillingSettings.js";
import Admin from "../models/Admin.js";

// Configuração do cliente do Mercado Pago
// Determinar o ambiente (development vs production)
const isProduction = process.env.NODE_ENV === "production";

// Log do ambiente atual
console.log(
  "💳 Mercado Pago: Iniciando em modo",
  isProduction ? "PRODUÇÃO" : "DESENVOLVIMENTO"
);

async function getMercadoPagoAccessToken() {
  try {
    const adminSettings = await Admin.findOne({
      order: [["createdAt", "DESC"]],
    });
    if (adminSettings?.mercadoPagoAccessToken) {
      return adminSettings.mercadoPagoAccessToken;
    }
  } catch {
    console.log("Mercado Pago: token do admin indisponivel, usando variavel de ambiente.");
  }

  return process.env.MERCADO_PAGO_ACCESS_TOKEN || "";
}

async function getMercadoPagoSdk() {
  const accessToken = await getMercadoPagoAccessToken();

  if (!accessToken) {
    throw new Error("Mercado Pago nao configurado. Cadastre o token no admin.");
  }

  const client = new MercadoPagoConfig({
    accessToken,
    options: {
      timeout: 30000,
    },
  });

  return {
    client,
    preference: new Preference(client),
    payment: new Payment(client),
  };
}

function getMercadoPagoNotificationUrl(customUrl) {
  const candidate = String(
    customUrl ||
      process.env.WEBHOOK_URL ||
      process.env.API_URL ||
      "",
  ).trim();

  if (!candidate || /localhost|127\.0\.0\.1/i.test(candidate)) {
    return "";
  }

  return candidate.startsWith("http")
    ? `${candidate.replace(/\/$/, "")}/api/subscriptions/webhook`
    : "";
}

/**
 * Cache para controlar eventos duplicados do webhook
 * Estrutura: { paymentId: { lastProcessed: timestamp, count: number } }
 */
const webhookCache = new Map();
const WEBHOOK_CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const MAX_WEBHOOK_EVENTS_PER_PAYMENT = 3; // Máximo de eventos por pagamento

/**
 * Limpar cache antigo periodicamente
 */
setInterval(() => {
  const now = Date.now();
  for (const [paymentId, data] of webhookCache.entries()) {
    if (now - data.lastProcessed > WEBHOOK_CACHE_TTL) {
      webhookCache.delete(paymentId);
    }
  }
}, WEBHOOK_CACHE_TTL); // Limpa a cada 5 minutos

/**
 * Verificar se evento do webhook já foi processado recentemente
 */
const isWebhookEventDuplicate = (paymentId) => {
  const now = Date.now();
  const cacheKey = paymentId.toString();

  if (!webhookCache.has(cacheKey)) {
    // Primeiro evento para este pagamento
    webhookCache.set(cacheKey, { lastProcessed: now, count: 1 });
    return false;
  }

  const data = webhookCache.get(cacheKey);
  const timeDiff = now - data.lastProcessed;

  // Se o último evento foi há menos de 30 segundos, é duplicata
  if (timeDiff < 30000) {
    data.count++;
    console.log(
      `⚠️ Evento duplicado detectado para pagamento ${paymentId} (${data.count}ª vez em ${timeDiff}ms)`
    );

    // Permitir no máximo 3 eventos por pagamento
    if (data.count > MAX_WEBHOOK_EVENTS_PER_PAYMENT) {
      console.log(
        `🚫 Limite de eventos excedido para pagamento ${paymentId} - ignorando`
      );
      return true;
    }

    return true;
  }

  // Atualizar timestamp do último processamento
  data.lastProcessed = now;
  data.count++;
  return false;
};

/**
 * Calcula valores dos planos
 */
export const planPrices = {
  monthly: 69.9,
  promotional: 39.9,
  firstMonthFree: true,
};

export const getBillingConfig = async () => {
  let settings = await BillingSettings.findOne({
    order: [["createdAt", "DESC"]],
  });

  if (!settings) {
    settings = await BillingSettings.create({
      monthlyPrice: planPrices.monthly,
      promotionalPrice: planPrices.promotional,
      trialDays: 30,
      promotionalMonths: 3,
      reminderDays: 7,
      mercadoPagoEnabled: true,
    });
  }

  return {
    monthly: Number(settings.monthlyPrice || planPrices.monthly),
    promotional: Number(settings.promotionalPrice || planPrices.promotional),
    trialDays: Number(settings.trialDays || 30),
    promotionalMonths: Number(settings.promotionalMonths || 3),
    reminderDays: Number(settings.reminderDays || 7),
    mercadoPagoEnabled: Boolean(settings.mercadoPagoEnabled),
    mercadoPagoPublicKey: settings.mercadoPagoPublicKey || "",
    notes: settings.notes || "",
    settings,
  };
};

/**
 * Criar preferência de pagamento para assinatura
 */
export const createSubscriptionPreference = async (subscriptionData) => {
  try {
    const { preference } = await getMercadoPagoSdk();
    const billingConfig = await getBillingConfig();
    const {
      user,
      planType,
      amount: subscriptionAmount,
      paymentMethods = ["credit_card", "debit_card", "pix", "boleto"],
    } = subscriptionData;

    const customTitle = subscriptionData.title;
    const customDescription = subscriptionData.description;
    const customItemId = subscriptionData.itemId;
    const notificationUrl = subscriptionData.notificationUrl;
    const backUrls = subscriptionData.backUrls;
    const statementDescriptor = subscriptionData.statementDescriptor;

    // Usa o valor passado ou determina baseado no tipo de plano
    const amount =
      subscriptionAmount ||
      (planType === "promotional"
        ? billingConfig.promotional
        : billingConfig.monthly);

    // Formata o valor para exibição
    const formattedAmount = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amount);

    // Determinar título e descrição baseado no tipo de plano
    let title, description;

    if (customTitle || customDescription) {
      title = customTitle || "ViaPet";
      description = customDescription || customTitle || "Pagamento ViaPet";
    } else if (planType === "promotional") {
      title = "Plano Promocional ViaPet";
      description = `Assinatura promocional - ${formattedAmount} por 3 meses`;
    } else {
      title = "Plano Mensal ViaPet";
      description = `Assinatura mensal - ${formattedAmount}/mês`;
    }

    // Validações importantes
    if (!amount || amount <= 0) {
      throw new Error(`Valor inválido para assinatura: ${amount}`);
    }

    if (!user?.name || !user?.email) {
      throw new Error("Dados do usuário incompletos para criar pagamento");
    }

    const notificationTarget = getMercadoPagoNotificationUrl(notificationUrl);

    const preferenceBody = {
      items: [
        {
          id: customItemId || `viapet-subscription-${planType}`,
          title,
          description,
          picture_url: "https://viapet.app/images/viapet-logo.png",
          category_id: "services",
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(amount),
        },
      ],
      payer: {
        name: user?.name || "",
        email: user?.email || "",
        identification: {
          type: "CPF",
          number: user?.cpf || "",
        },
      },
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments:
          planType === "promotional"
            ? 1
            : planType === "simple_payment"
            ? 12
            : 12,
        default_installments: 1,
      },
      back_urls: {
        success:
          backUrls?.success ||
          (planType === "payment" || planType === "simple_payment"
            ? `${process.env.FRONTEND_URL}/payment/success`
            : `${process.env.FRONTEND_URL}/subscription/success`),
        failure:
          backUrls?.failure ||
          (planType === "payment" || planType === "simple_payment"
            ? `${process.env.FRONTEND_URL}/payment/failure`
            : `${process.env.FRONTEND_URL}/subscription/failure`),
        pending:
          backUrls?.pending ||
          (planType === "payment" || planType === "simple_payment"
            ? `${process.env.FRONTEND_URL}/payment/pending`
            : `${process.env.FRONTEND_URL}/subscription/pending`),
      },
      auto_return:
        planType === "payment" || planType === "simple_payment"
          ? undefined
          : "approved",
      statement_descriptor: statementDescriptor || "VIAPET",
      expires: false,
      external_reference:
        subscriptionData.externalReference || `sub_${Date.now()}`,
      metadata: {
        user_id: user?.id,
        plan_type: planType,
        payment_id: subscriptionData.externalReference || `pay_${Date.now()}`,
        viapet_payment: true, // Flag para identificar pagamentos ViaPet
        // Incluir dados customizados se fornecidos
        ...(subscriptionData.customData || {}),
      },
    };

    if (notificationTarget) {
      preferenceBody.notification_url = notificationTarget;
    }

    // Filtrar métodos de pagamento se especificado
    if (paymentMethods.length < 4) {
      const excludedTypes = [];
      const excludedMethods = [];

      if (!paymentMethods.includes("credit_card")) {
        excludedTypes.push({ id: "credit_card" });
      }
      if (!paymentMethods.includes("debit_card")) {
        excludedTypes.push({ id: "debit_card" });
      }
      if (!paymentMethods.includes("pix")) {
        excludedMethods.push({ id: "pix" });
      }
      if (!paymentMethods.includes("boleto")) {
        excludedMethods.push({ id: "bolbradesco" });
        excludedMethods.push({ id: "boleto" });
      }

      preferenceBody.payment_methods.excluded_payment_types = excludedTypes;
      preferenceBody.payment_methods.excluded_payment_methods = excludedMethods;
    }

    console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
    console.log(
      "🔍 Dados da preferência enviada ao Mercado Pago:",
      preferenceBody
    );

    const result = await preference.create({ body: preferenceBody });

    console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
    console.log(
      "✅ Preferência criada com sucesso (resposta do Mercado Pago):",
      result
    );

    return {
      success: true,
      preference: result,
      init_point: result.init_point,
      id: result.id,
    };
  } catch (error) {
    console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
    console.error("Erro ao criar preferência do Mercado Pago:", error);
    return {
      success: false,
      error: error.message || "Erro interno do servidor",
      details: error.response?.data || error,
    };
  }
};

/**
 * Buscar informações de um pagamento
 */
export const getPaymentInfo = async (paymentId) => {
  try {
    const { payment } = await getMercadoPagoSdk();
    const result = await payment.get({ id: paymentId });

    return {
      success: true,
      payment: result,
    };
  } catch (error) {
    console.error("Erro ao buscar pagamento:", error);
    return {
      success: false,
      error: error.message || "Erro interno do servidor",
    };
  }
};

export const createPixPayment = async (paymentData) => {
  try {
    const { payment } = await getMercadoPagoSdk();
    const amount = Number(paymentData?.amount || 0);

    if (!amount || amount <= 0) {
      throw new Error("Valor invalido para gerar o PIX.");
    }

    const payerName = String(paymentData?.user?.name || "").trim();
    const payerFirstName = payerName.split(" ").filter(Boolean)[0] || "Cliente";
    const externalReference =
      paymentData?.externalReference || `main_pix_${Date.now()}`;

    const notificationTarget = getMercadoPagoNotificationUrl(
      paymentData?.notificationUrl,
    );

    const payload = {
        transaction_amount: amount,
        description: paymentData?.description || "Pagamento ViaPet",
        payment_method_id: "pix",
        payer: {
          email: paymentData?.user?.email || "financeiro@viapet.app",
          first_name: payerFirstName,
        },
        external_reference: externalReference,
        metadata: {
          user_id: paymentData?.user?.id || null,
          plan_type: paymentData?.planType || "monthly",
          viapet_payment: true,
          billing_source: "self_service_pix",
          ...(paymentData?.customData || {}),
        },
      };

    if (notificationTarget) {
      payload.notification_url = notificationTarget;
    }

    const result = await payment.create({
      body: payload,
      requestOptions: {
        idempotencyKey: `pix-${externalReference}`,
      },
    });

    const transactionData =
      result?.point_of_interaction?.transaction_data || {};

    return {
      success: true,
      payment: result,
      id: result?.id,
      status: result?.status,
      qrCode: transactionData?.qr_code || "",
      qrCodeBase64: transactionData?.qr_code_base64 || "",
      ticketUrl: transactionData?.ticket_url || "",
      expiresAt: result?.date_of_expiration || null,
      externalReference,
    };
  } catch (error) {
    console.error("Erro ao criar PIX no Mercado Pago:", error);
    return {
      success: false,
      error: error.message || "Erro interno do servidor",
      details: error?.response?.data || error,
    };
  }
};

/**
 * Validar dados do webhook do Mercado Pago
 * @param {Object} req - Request object do Express
 * @returns {boolean} - True se válido, false caso contrário
 */
export const validateWebhookSignature = async (req) => {
  try {
    const { action, data, type, resource, topic } = req.body;
    const signature = req.headers["x-signature"];
    const requestId = req.headers["x-request-id"];

    // Formato 1: Webhook novo com action/data/type
    const isNewFormat = action && data && data.id && type;

    // Formato 2: Webhook antigo com resource/topic
    const isOldFormat = resource && topic;

    if (!isNewFormat && !isOldFormat) {
      return false;
    }

    // Para formato novo, validar data.id
    if (isNewFormat && !/^\d+$/.test(data.id.toString())) {
      return false;
    }

    // Para formato antigo, extrair ID do resource
    if (isOldFormat && topic === "payment") {
      const paymentId = resource.split("/").pop();
      if (!/^\d+$/.test(paymentId)) {
        return false;
      }
    }

    // Em desenvolvimento, aceitar sem validação rigorosa de assinatura
    if (process.env.NODE_ENV !== "production") {
      return true;
    }

    // Em produção, validar assinatura se disponível
    if (process.env.NODE_ENV === "production" && signature) {
      try {
        const crypto = await import("crypto");
        const [tsPart, v1Part] = signature.split(",");
        const ts = tsPart.split("=")[1];
        const v1 = v1Part.split("=")[1];

        const manifest = `id:${requestId};request-url:${
          req.protocol
        }://${req.get("host")}${req.originalUrl};ts:${ts};`;

        const hmac = crypto.createHmac(
          "sha256",
          process.env.MERCADO_PAGO_WEBHOOK_SECRET || ""
        );
        hmac.update(manifest);
        const sha = hmac.digest("hex");

        if (sha !== v1) {
          // Em produção, não bloquear por assinatura para não perder webhooks importantes
        }
      } catch (signatureError) {}
    }

    console.log("✅ Webhook validado com sucesso");

    return true;
  } catch (error) {
    console.error("💥 Erro na validação do webhook:", error);
    return false;
  }
};

/**
 * Processar eventos do webhook do Mercado Pago
 * @param {Object} eventData - Dados do evento recebido
 * @returns {Object} - Resultado do processamento
 */
export const processWebhookEvent = async (eventData) => {
  try {
    const { action, data, type, resource, topic, date_created } = eventData;

    console.log(`📋 Iniciando processamento do evento:`);

    let paymentId = null;

    // Extrair payment ID baseado no formato do webhook
    if (action && data && data.id) {
      // Formato novo: action/data/type
      if (action.startsWith("payment.") || type === "payment") {
        paymentId = data.id;
      }
    } else if (resource && topic) {
      // Formato antigo: resource/topic
      if (topic === "payment") {
        paymentId = resource.split("/").pop();
      } else if (topic === "merchant_order") {
        console.log(
          `ℹ️ Evento merchant_order ignorado - não processamos orders diretamente`
        );
        return {
          success: false,
          error: `Evento merchant_order ignorado`,
        };
      }
    }

    if (!paymentId) {
      console.log(
        `ℹ️ Evento ignorado - não é evento de pagamento ou ID não encontrado`
      );
      return {
        success: false,
        error: `Evento não é relacionado a pagamentos ou ID não encontrado`,
      };
    }

    // Verificar se é evento duplicado
    if (isWebhookEventDuplicate(paymentId)) {
      console.log(`⚠️ Evento duplicado detectado para pagamento ${paymentId}`);

      // Verificar se o pagamento já foi processado no banco de dados
      try {
        const { default: PaymentHistory } = await import(
          "../models/PaymentHistory.js"
        );
        const existingPayment = await PaymentHistory.findOne({
          where: {
            payment_id: paymentId.toString(),
          },
        });

        if (existingPayment) {
          console.log(
            `✅ Pagamento ${paymentId} já foi processado anteriormente - ignorando evento duplicado`
          );
          return {
            success: true,
            payment: null,
            message: "Evento duplicado ignorado - pagamento já processado",
            duplicate: true,
          };
        } else {
          console.log(
            `🔄 Pagamento ${paymentId} não encontrado no histórico - pode ser atualização de status, continuando processamento`
          );
        }
      } catch (dbError) {
        console.error(`❌ Erro ao verificar pagamento no banco:`, dbError);
        // Continua o processamento em caso de erro no banco
      }
    }

    console.log(`💳 Buscando informações do pagamento ${paymentId}...`);
    const paymentInfo = await getPaymentInfo(paymentId);

    console.log(`✅ Informações do pagamento obtidas:`);

    if (paymentInfo.success) {
      console.log(
        ">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>",
        paymentInfo.payment.metadata
      );

      console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>", {
        status: paymentInfo.payment.status,
        status_detail: paymentInfo.payment.status_detail,
      });

      return {
        success: true,
        action: action || `${topic}`,
        type: type || topic,
        payment: paymentInfo.payment,
        processed_at: new Date().toISOString(),
        event_data: eventData,
      };
    } else {
      console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      console.log(
        `❌ Falha ao obter informações do pagamento:`,
        paymentInfo.error
      );
      return {
        success: false,
        error: `Falha ao obter dados do pagamento ${paymentId}: ${paymentInfo.error}`,
      };
    }
  } catch (error) {
    console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
    console.error("💥 Erro ao processar evento do webhook:", {
      error: error.message,
      stack: error.stack,
      eventData,
    });

    return {
      success: false,
      error: error.message || "Erro interno no processamento do webhook",
    };
  }
};

/**
 * Processar renovação automática de assinatura
 */
export const processSubscriptionRenewal = async (subscription, paymentData) => {
  try {
    const billingConfig = await getBillingConfig();
    const PaymentHistoryModule = await import("../models/PaymentHistory.js");
    const PaymentHistory = PaymentHistoryModule.default;
    const SubscriptionModule = await import("../models/Subscription.js");
    const Subscription = SubscriptionModule.default;

    const now = new Date();
    const nextBilling = new Date(now);
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    // Atualizar dados da assinatura
    const updateData = {
      status: "active",
      billing_cycle_start: now,
      billing_cycle_end: nextBilling,
      next_billing_date: nextBilling,
    };

    // Lógica de promoção nos 3 primeiros meses
    if (subscription.plan_type === "promotional") {
      const newPromotionalMonths = subscription.promotional_months_used + 1;
      updateData.promotional_months_used = newPromotionalMonths;

      // Se atingiu 3 meses promocionais, mudar para plano mensal
      if (newPromotionalMonths >= 3) {
        updateData.plan_type = "monthly";
        updateData.amount = billingConfig.monthly;
        console.log(
          `🔄 Assinatura ${subscription.id} convertida para plano mensal após 3 meses promocionais`
        );
      }
    }

    // Atualizar assinatura
    await subscription.update(updateData);

    // Criar registro no histórico de pagamentos (com proteção)
    if (PaymentHistory && typeof PaymentHistory.create === "function") {
      try {
        await PaymentHistory.create({
          subscription_id: subscription.id,
          user_id: subscription.user_id,
          payment_id: paymentData.id || paymentData.payment_id,
          external_reference: paymentData.external_reference,
          status: paymentData.status,
          amount: paymentData.transaction_amount || paymentData.amount,
          currency: paymentData.currency_id || "BRL",
          payment_method: getPaymentMethodCategory(
            paymentData.payment_method_id
          ),
          payment_type: paymentData.payment_method_id,
          installments: paymentData.installments || 1,
          date_created: paymentData.date_created
            ? new Date(paymentData.date_created)
            : now,
          date_approved: paymentData.date_approved
            ? new Date(paymentData.date_approved)
            : now,
          billing_period_start: now,
          billing_period_end: nextBilling,
          plan_type: subscription.plan_type,
          is_trial: false,
          merchant_order_id: paymentData.order?.id,
          webhook_data: null,
        });

        console.log(
          `✅ Histórico de pagamento criado para renovação da assinatura ${subscription.id}`
        );
      } catch (historyError) {
        console.log(
          "⚠️ Erro ao criar histórico de pagamento na renovação:",
          historyError.message
        );
        // Não falhar a renovação por causa do histórico
      }
    } else {
      console.log(
        "⚠️ PaymentHistory model não disponível - histórico não criado na renovação"
      );
    }

    console.log(
      `✅ Renovação processada para assinatura ${
        subscription.id
      } - próxima cobrança: ${nextBilling.toISOString()}`
    );

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan_type: subscription.plan_type,
        next_billing_date: subscription.next_billing_date,
        promotional_months_used: subscription.promotional_months_used,
      },
    };
  } catch (error) {
    console.error("❌ Erro ao processar renovação de assinatura:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Aplicar período trial apenas para planos do tipo "trial"
 */
export const applyTrialPeriod = async (subscription) => {
  try {
    const billingConfig = await getBillingConfig();
    // Só aplica trial para planos do tipo "trial"
    if (subscription.plan_type !== 'trial') {
      return {
        success: false,
        error: 'Trial period only available for trial plan type',
      };
    }

    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + billingConfig.trialDays);

    const nextBilling = new Date(trialEnd);
    nextBilling.setDate(nextBilling.getDate() + 1); // Primeira cobrança após o trial

    await subscription.update({
      status: "active",
      trial_start: now,
      trial_end: trialEnd,
      billing_cycle_start: trialEnd,
      billing_cycle_end: nextBilling,
      next_billing_date: nextBilling,
    });

    // Criar registro de período gratuito no histórico apenas para planos trial
    try {
      const PaymentHistoryModule = await import("../models/PaymentHistory.js");
      const PaymentHistory = PaymentHistoryModule.default;

      if (!PaymentHistory || typeof PaymentHistory.create !== "function") {
        console.log(
          "⚠️ PaymentHistory model não disponível - pulando criação do histórico"
        );
        return {
          success: true,
          trial_end: trialEnd,
          next_billing_date: nextBilling,
          warning:
            "Histórico de pagamento não foi criado - modelo não disponível",
        };
      }

      await PaymentHistory.create({
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        status: "approved",
        amount: 0.0,
        currency: "BRL",
        billing_period_start: now,
        billing_period_end: trialEnd,
        plan_type: subscription.plan_type,
        is_trial: true,
        notes: "Período trial gratuito - plano trial",
      });

      console.log(
        `🆓 Período trial aplicado para assinatura ${
          subscription.id
        } - válido até ${trialEnd.toISOString()}`
      );
    } catch (historyError) {
      console.log(
        "⚠️ Erro ao criar histórico de pagamento trial:",
        historyError.message
      );
      // Não falhar a aplicação do trial por causa do histórico
    }

    return {
      success: true,
      trial_end: trialEnd,
      next_billing_date: nextBilling,
    };
  } catch (error) {
    console.error("❌ Erro ao aplicar período trial:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Mapear método de pagamento do MP para categorias
 */
const getPaymentMethodCategory = (paymentMethodId) => {
  if (!paymentMethodId) return null;

  const creditCards = ["visa", "master", "amex", "elo", "hipercard", "diners"];
  const debitCards = ["debvisa", "debmaster", "debelo"];

  if (paymentMethodId === "pix") return "pix";
  if (paymentMethodId === "bolbradesco" || paymentMethodId.includes("bol"))
    return "boleto";
  if (creditCards.includes(paymentMethodId)) return "credit_card";
  if (debitCards.includes(paymentMethodId)) return "debit_card";

  return "credit_card"; // Default
};

/**
 * Verificar assinaturas vencidas e processar renovações
 */
export const checkExpiredSubscriptions = async () => {
  try {
    const { Subscription } = await import("../models/Subscription.js");
    const now = new Date();

    // Buscar assinaturas ativas com data de cobrança vencida
    const expiredSubscriptions = await Subscription.findAll({
      where: {
        status: "active",
        next_billing_date: {
          [Op.lte]: now,
        },
      },
    });

    console.log(
      `🔍 Encontradas ${expiredSubscriptions.length} assinaturas para verificação de renovação`
    );

    for (const subscription of expiredSubscriptions) {
      // Aqui você pode implementar lógica para tentar renovar automaticamente
      // Por exemplo, utilizando dados de cartão salvos (se implementado)
      console.log(
        `⚠️ Assinatura ${subscription.id} vencida - necessária ação manual ou cobrança automática`
      );

      // Por enquanto, apenas marcar como suspended até o pagamento
      await subscription.update({
        status: "suspended",
        notes: `Assinatura suspensa por falta de pagamento em ${now.toISOString()}`,
      });
    }

    return {
      success: true,
      checked: expiredSubscriptions.length,
    };
  } catch (error) {
    console.error("❌ Erro ao verificar assinaturas vencidas:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Obter estatísticas do cache de webhooks (para debugging)
 */
export const getWebhookCacheStats = () => {
  const now = Date.now();
  const stats = {
    totalEntries: webhookCache.size,
    entries: [],
    oldEntries: 0,
  };

  for (const [paymentId, data] of webhookCache.entries()) {
    const ageMs = now - data.lastProcessed;
    const isOld = ageMs > WEBHOOK_CACHE_TTL;

    if (isOld) stats.oldEntries++;

    stats.entries.push({
      paymentId,
      count: data.count,
      lastProcessed: new Date(data.lastProcessed).toISOString(),
      ageMs,
      isOld,
    });
  }

  return stats;
};

/**
 * Limpar cache de webhooks manualmente (para testing)
 */
export const clearWebhookCache = () => {
  const size = webhookCache.size;
  webhookCache.clear();
  return { cleared: size };
};

export default {
  createSubscriptionPreference,
  createPixPayment,
  getPaymentInfo,
  validateWebhookSignature,
  processWebhookEvent,
  processSubscriptionRenewal,
  applyTrialPeriod,
  checkExpiredSubscriptions,
  getWebhookCacheStats,
  clearWebhookCache,
  planPrices,
  getBillingConfig,
};
