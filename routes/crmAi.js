import express from "express";
import { v4 as uuidv4 } from "uuid";
import auth from "../middlewares/auth.js";
import Users from "../models/Users.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";
import { createSubscriptionPreference, processWebhookEvent, validateWebhookSignature } from "../service/mercadopago.js";

const router = express.Router();
const CRM_AI_PRICE = Number(process.env.CRM_AI_PRICE || 49.9);

function getPublicPlan() {
  return {
    id: "crm-ai-premium",
    name: "IA CRM Premium",
    provider: "Google Gemini",
    price: CRM_AI_PRICE,
    currency: "BRL",
    billing_cycle: "monthly",
    description: "IA comercial do ViaPet com regras personalizadas, assistencia no CRM e automacoes premium.",
    benefits: [
      "Conversa com IA dentro do CRM",
      "Permissoes de agenda, cliente e pet",
      "Bloqueio por assinatura premium",
      "Base pronta para integrar com Google Gemini",
    ],
  };
}

function computeAccess(subscription) {
  if (!subscription) return { canAccess: false, status: "no_subscription" };
  const expiry = subscription.next_billing_date ? new Date(subscription.next_billing_date) : null;
  const isExpired = subscription.status === "active" && expiry && expiry < new Date();
  return {
    canAccess: subscription.status === "active" && !isExpired,
    status: isExpired ? "expired" : subscription.status,
  };
}

router.get("/plans", (req, res) => {
  return res.json({
    success: true,
    plan: getPublicPlan(),
  });
});

router.get("/subscription", auth, async (req, res) => {
  try {
    const subscription = await CrmAiSubscription.findOne({
      where: { user_id: req.user.id },
      order: [["created_at", "DESC"]],
    });

    if (!subscription) {
      return res.json({
        success: true,
        plan: getPublicPlan(),
        canAccess: false,
        subscription: null,
      });
    }

    const access = computeAccess(subscription);
    if (access.status === "expired" && subscription.status !== "expired") {
      await subscription.update({ status: "expired" });
    }

    return res.json({
      success: true,
      plan: getPublicPlan(),
      canAccess: access.canAccess,
      subscription: {
        id: subscription.id,
        status: access.status,
        amount: Number(subscription.amount || 0),
        currency: subscription.currency,
        payment_status: subscription.payment_status,
        payment_preference_id: subscription.payment_preference_id,
        payment_id: subscription.payment_id,
        external_reference: subscription.external_reference,
        activated_at: subscription.activated_at,
        next_billing_date: subscription.next_billing_date,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar assinatura da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar assinatura da IA CRM",
      details: error.message,
    });
  }
});

router.post("/subscribe", auth, async (req, res) => {
  try {
    const user = await Users.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: "Usuario nao encontrado" });
    }

    const existing = await CrmAiSubscription.findOne({
      where: { user_id: req.user.id, status: ["pending", "active"] },
      order: [["created_at", "DESC"]],
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: "Ja existe uma assinatura ativa ou pendente da IA CRM",
      });
    }

    const id = uuidv4();
    const externalReference = `crm-ai-${id}`;
    const subscription = await CrmAiSubscription.create({
      id,
      user_id: req.user.id,
      status: "pending",
      amount: CRM_AI_PRICE,
      currency: "BRL",
      external_reference: externalReference,
      notes: "Assinatura premium da IA CRM",
    });

    const preference = await createSubscriptionPreference({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
      },
      planType: "crm_ai",
      amount: CRM_AI_PRICE,
      title: "IA CRM Premium ViaPet",
      description: "Desbloqueio da IA CRM premium dentro do ViaPet",
      itemId: "viapet-crm-ai-premium",
      externalReference,
      notificationUrl: `${process.env.API_URL}/api/crm-ai/webhook`,
      backUrls: {
        success: `${process.env.FRONTEND_URL}/crm-ai/success`,
        failure: `${process.env.FRONTEND_URL}/crm-ai/failure`,
        pending: `${process.env.FRONTEND_URL}/crm-ai/pending`,
      },
      customData: {
        feature_key: "crm_ai",
        crm_ai_subscription_id: subscription.id,
      },
    });

    if (!preference.success) {
      await subscription.destroy();
      return res.status(400).json({
        success: false,
        error: "Nao foi possivel gerar o checkout da IA CRM",
        details: preference.error,
      });
    }

    await subscription.update({ payment_preference_id: preference.id });

    return res.json({
      success: true,
      plan: getPublicPlan(),
      subscription: {
        id: subscription.id,
        status: subscription.status,
        amount: Number(subscription.amount || 0),
        currency: subscription.currency,
      },
      payment: {
        preference_id: preference.id,
        checkout_url: preference.init_point,
      },
    });
  } catch (error) {
    console.error("Erro ao criar assinatura da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao criar assinatura da IA CRM",
      details: error.message,
    });
  }
});

router.post("/cancel", auth, async (req, res) => {
  try {
    const subscription = await CrmAiSubscription.findOne({
      where: { user_id: req.user.id, status: ["pending", "active"] },
      order: [["created_at", "DESC"]],
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Nenhuma assinatura ativa ou pendente da IA CRM encontrada",
      });
    }

    await subscription.update({
      status: "cancelled",
      cancelled_at: new Date(),
    });

    return res.json({
      success: true,
      message: "Assinatura da IA CRM cancelada com sucesso.",
      subscription: {
        id: subscription.id,
        status: subscription.status,
      },
    });
  } catch (error) {
    console.error("Erro ao cancelar assinatura da IA CRM:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao cancelar assinatura da IA CRM",
      details: error.message,
    });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    if (!(await validateWebhookSignature(req))) {
      return res.status(401).json({ success: false, error: "Webhook invalido" });
    }

    const result = await processWebhookEvent(req.body);
    if (!result.success || !result.payment) {
      return res.status(200).json({
        success: false,
        processed: false,
        error: result.error || "Evento ignorado",
      });
    }

    const payment = result.payment;
    const metadata = payment.metadata || {};
    const subscriptionId = metadata.crm_ai_subscription_id;
    const externalReference = payment.external_reference || metadata.external_reference;

    if (!subscriptionId && !externalReference) {
      return res.status(200).json({
        success: false,
        processed: false,
        error: "Webhook sem referencia da IA CRM",
      });
    }

    const subscription = await CrmAiSubscription.findOne({
      where: subscriptionId ? { id: subscriptionId } : { external_reference: externalReference },
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: "Assinatura da IA CRM nao encontrada",
      });
    }

    const paymentStatus = payment.status || "pending";
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    let status = subscription.status;
    if (["approved", "authorized"].includes(paymentStatus)) status = "active";
    if (["cancelled", "rejected", "charged_back", "refunded"].includes(paymentStatus)) status = "cancelled";
    if (["pending", "in_process"].includes(paymentStatus)) status = "pending";

    await subscription.update({
      status,
      payment_status: paymentStatus,
      payment_id: String(payment.id || ""),
      activated_at: status === "active" ? new Date() : subscription.activated_at,
      next_billing_date: status === "active" ? nextBillingDate : subscription.next_billing_date,
    });

    return res.status(200).json({
      success: true,
      processed: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        payment_status: subscription.payment_status,
      },
    });
  } catch (error) {
    console.error("Erro no webhook da IA CRM:", error);
    return res.status(200).json({
      success: false,
      processed: false,
      error: error.message,
    });
  }
});

export default router;
