import express from "express";
import { v4 as uuidv4 } from "uuid";
import Subscription from "../models/Subscription.js";
import PaymentHistory from "../models/PaymentHistory.js";
import Users from "../models/Users.js";
import {
  createSubscriptionPreference,
  validateWebhookSignature,
  processWebhookEvent,
  planPrices,
  getBillingConfig,
} from "../service/mercadopago.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

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
      trial: {
        id: "trial",
        name: "Período Trial",
        price: 0.00,
        currency: "BRL",
        description: "1 mês gratuito para novos usuários",
        benefits: [
          "Agendamento ilimitado de consultas",
          "Histórico completo dos pets",
          "Lembretes automáticos",
          "Suporte prioritário",
          "Acesso ao app móvel",
          "Backup automático dos dados",
          "🎁 Completamente gratuito por 30 dias!",
        ],
        billing_cycle: "trial",
        trial_period: {
          enabled: true,
          duration_days: 30,
          description: "1 mês completamente grátis",
        },
      },
    };

    res.json({
      success: true,
      plans,
      current_promotion: {
        enabled: true,
        title: "Oferta Especial de Lançamento!",
        subtitle: "Escolha o melhor plano para seus pets",
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
 * SEM PERÍODO TRIAL PARA MONTHLY E PROMOTIONAL
 */
router.post("/create", auth, async (req, res) => {
  try {
    const billingConfig = await getBillingConfig();
    const { plan_type = "monthly", payment_methods } = req.body;
    const userId = req.user.id;

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
        error: "Usuário já possui uma assinatura ativa ou pendente",
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
    if (!["monthly", "promotional", "trial"].includes(plan_type)) {
      return res.status(400).json({
        success: false,
        error: "Tipo de plano inválido",
      });
    }

    // Definir valores baseado no tipo de plano
    let amount;
    switch (plan_type) {
      case "promotional":
        amount = billingConfig.promotional;
        break;
      case "monthly":
        amount = billingConfig.monthly;
        break;
      case "trial":
        amount = 0.00;
        break;
      default:
        amount = billingConfig.monthly;
    }

    // Criar registro da assinatura no banco
    const subscription = await Subscription.create({
      id: uuidv4(),
      user_id: userId,
      plan_type,
      status: plan_type === "trial" ? "active" : "pending",
      amount,
      currency: "BRL",
      promotional_months_used: 0,
    });

    // Para plano trial: aplicar período gratuito
    if (plan_type === 'trial') {
      const now = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + billingConfig.trialDays);

      await subscription.update({
        trial_start: now,
        trial_end: trialEnd,
        billing_cycle_start: trialEnd,
        next_billing_date: trialEnd,
      });

      return res.json({
        success: true,
        subscription: {
          id: subscription.id,
          plan_type: subscription.plan_type,
          amount: subscription.amount,
          status: subscription.status,
          trial_start: subscription.trial_start,
          trial_end: subscription.trial_end,
          next_billing_date: subscription.next_billing_date,
          is_trial: true,
        },
        message: "Período trial ativado! Aproveite 1 mês grátis dos recursos do ViaPet.",
        payment: {
          required: false,
          trial_period: true,
          next_payment_date: subscription.next_billing_date,
        },
      });
    }

    // Para planos monthly e promotional: criar preferência de pagamento imediatamente
    const preferenceData = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
      },
      planType: plan_type,
      amount: amount,
    };

    const preference = await createSubscriptionPreference(preferenceData);

    if (!preference.success) {
      return res.status(400).json({
        error: "Erro ao criar preferência de pagamento",
        details: preference.error,
      });
    }

    // Atualizar subscription com preference_id
    await subscription.update({
      payment_preference_id: preference.id,
    });

    res.json({
      success: true,
      subscription: {
        id: subscription.id,
        plan_type: subscription.plan_type,
        amount: subscription.amount,
        status: subscription.status,
        is_trial: false,
      },
      message: `Assinatura ${plan_type} criada! Prossiga para o pagamento.`,
      payment: {
        required: true,
        trial_period: false,
        preference_id: preference.id,
        init_point: preference.init_point,
        checkout_url: preference.init_point,
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
 * GET /api/subscriptions/my-subscription
 * Retorna informações da assinatura do usuário logado
 */
router.get("/my-subscription", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Buscar assinatura do usuário
    const subscription = await Subscription.findOne({
      where: {
        user_id: userId,
      },
      include: [
        {
          model: PaymentHistory,
          as: "paymentHistory",
          required: false,
          order: [["created_at", "DESC"]],
        },
        {
          model: Users,
          as: "user",
          required: true,
          attributes: ["id", "name", "email"],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    if (!subscription) {
      return res.json({
        success: true,
        subscription: null,
        status: "no_subscription",
        message: "Usuário não possui assinatura",
      });
    }

    // Calcular status da assinatura
    const now = new Date();
    let subscriptionStatus = subscription.status;
    let isInTrial = false;
    let daysUntilExpiry = null;

    // Verificar se está no período trial (apenas para plano trial)
    if (subscription.plan_type === 'trial' && subscription.trial_start && subscription.trial_end) {
      const trialStart = new Date(subscription.trial_start);
      const trialEnd = new Date(subscription.trial_end);

      if (now >= trialStart && now <= trialEnd) {
        isInTrial = true;
        daysUntilExpiry = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      }
    }

    // Verificar se a assinatura está vencida
    if (subscription.next_billing_date && now > new Date(subscription.next_billing_date)) {
      if (subscriptionStatus === "active") {
        subscriptionStatus = "expired";
        await subscription.update({ status: "expired" });
      }
    }

    res.json({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscriptionStatus,
        plan_type: subscription.plan_type,
        amount: parseFloat(subscription.amount),
        currency: subscription.currency,
        created_at: subscription.created_at,
        trial_start: subscription.trial_start,
        trial_end: subscription.trial_end,
        next_billing_date: subscription.next_billing_date,
        promotional_months_used: subscription.promotional_months_used,
        isInTrial,
        daysUntilExpiry,
        user: subscription.user,
      },
      paymentHistory: subscription.paymentHistory || [],
    });

  } catch (error) {
    console.error("Erro ao buscar assinatura:", error);
    res.status(500).json({
      success: false,
      error: "Erro interno do servidor",
      message: error.message,
    });
  }
});

/**
 * POST /api/subscriptions/webhook
 * Webhook para receber notificações do Mercado Pago
 */
router.post("/webhook", async (req, res) => {
  try {
    console.log("🔔 Webhook recebido:", req.body);

    // Validar webhook
    if (!(await validateWebhookSignature(req))) {
      console.error("❌ Assinatura inválida");
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Processar evento
    const eventResult = await processWebhookEvent(req.body);

    if (!eventResult.success) {
      console.error("⚠️ Falha ao processar evento:", eventResult.error);
      return res.status(200).json({
        received: true,
        processed: false,
        error: eventResult.error,
      });
    }

    res.status(200).json({
      received: true,
      processed: true,
      payment_id: eventResult.payment?.id,
      status: eventResult.payment?.status,
    });

  } catch (error) {
    console.error("💥 Erro no webhook:", error);
    res.status(200).json({
      received: true,
      processed: false,
      error: error.message,
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
      notes: reason ? `Cancelado pelo usuário: ${reason}` : "Cancelado pelo usuário",
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

export default router;
