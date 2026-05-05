import { Op } from "sequelize";
import Subscription from "../models/Subscription.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";

// Catalogo central de planos. Mantenha sincronizado com a UI (planLimits.js do frontend).
export const PLAN_DEFINITIONS = {
  trial: {
    label: "Trial (gratis)",
    price: "R$ 0,00",
    messagesPerMonth: 100,
    attendants: 1,
    aiEnabled: false,
    automationsEnabled: false,
  },
  promotional: {
    label: "Promocional",
    price: "R$ 39,90/mes",
    messagesPerMonth: 1000,
    attendants: 3,
    aiEnabled: true,
    automationsEnabled: true,
  },
  monthly: {
    label: "Mensal",
    price: "R$ 69,90/mes",
    messagesPerMonth: 50000,
    attendants: 10,
    aiEnabled: true,
    automationsEnabled: true,
  },
};

// Plano padrao para usuarios que ainda nao tem Subscription registrada
const DEFAULT_PLAN_KEY = "trial";

export function getPlanDefinition(planKey) {
  return PLAN_DEFINITIONS[planKey] || PLAN_DEFINITIONS[DEFAULT_PLAN_KEY];
}

export async function getUserPlan(userId) {
  if (!userId) return { planKey: DEFAULT_PLAN_KEY, plan: getPlanDefinition(DEFAULT_PLAN_KEY), subscription: null };

  // Busca a assinatura ativa mais recente do usuario
  const sub = await Subscription.findOne({
    where: {
      user_id: userId,
      status: { [Op.in]: ["active", "pending"] },
    },
    order: [["created_at", "DESC"]],
  });

  const planKey = sub?.plan_type || DEFAULT_PLAN_KEY;
  return {
    planKey,
    plan: getPlanDefinition(planKey),
    subscription: sub,
  };
}

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export async function countOutboundMessagesThisMonth(userId) {
  return CrmConversationMessage.count({
    where: {
      usersId: userId,
      direction: "outbound",
      createdAt: { [Op.gte]: startOfMonth() },
    },
  });
}

// Checa um limite especifico. Retorna { allowed, used, limit, remaining, planKey }
export async function checkLimit(userId, limitKey) {
  const { plan, planKey } = await getUserPlan(userId);

  if (limitKey === "messagesPerMonth") {
    const used = await countOutboundMessagesThisMonth(userId);
    const limit = Number(plan.messagesPerMonth || 0);
    return {
      allowed: used < limit,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      planKey,
    };
  }

  if (limitKey === "aiEnabled") {
    // Plano geral cobre? Se sim, libera direto.
    if (plan.aiEnabled) {
      return { allowed: true, used: 0, limit: 1, remaining: 1, planKey };
    }
    // Caso contrario, checa liberacao manual via CrmAiSubscription (admin liberou
    // gratis/trial/pago manual). Isso evita o caso "admin liberou mas /control bloqueia".
    const aiSub = await CrmAiSubscription.findOne({
      where: { user_id: userId, status: "active" },
      order: [["created_at", "DESC"]],
    });
    if (aiSub) {
      const expiry = aiSub.next_billing_date ? new Date(aiSub.next_billing_date) : null;
      const expired = expiry && expiry < new Date();
      if (!expired) {
        return { allowed: true, used: 0, limit: 1, remaining: 1, planKey, source: "crmAiSubscription" };
      }
    }
    return { allowed: false, used: 0, limit: 1, remaining: 0, planKey };
  }

  if (limitKey === "automationsEnabled") {
    if (plan.automationsEnabled) {
      return { allowed: true, used: 0, limit: 1, remaining: 1, planKey };
    }
    // Mesma logica: se a IA foi liberada manualmente, automacoes seguem junto.
    const aiSub = await CrmAiSubscription.findOne({
      where: { user_id: userId, status: "active" },
      order: [["created_at", "DESC"]],
    });
    if (aiSub) {
      const expiry = aiSub.next_billing_date ? new Date(aiSub.next_billing_date) : null;
      const expired = expiry && expiry < new Date();
      if (!expired) {
        return { allowed: true, used: 0, limit: 1, remaining: 1, planKey, source: "crmAiSubscription" };
      }
    }
    return { allowed: false, used: 0, limit: 1, remaining: 0, planKey };
  }

  return { allowed: true, used: 0, limit: Infinity, remaining: Infinity, planKey };
}

// Resumo completo para a UI
export async function getPlanStatus(userId) {
  const { plan, planKey, subscription } = await getUserPlan(userId);
  const messagesUsed = await countOutboundMessagesThisMonth(userId);

  // Verifica se ha CrmAiSubscription manual ativa (admin liberou IA)
  let crmAiManualActive = false;
  try {
    const aiSub = await CrmAiSubscription.findOne({
      where: { user_id: userId, status: "active" },
      order: [["created_at", "DESC"]],
    });
    if (aiSub) {
      const expiry = aiSub.next_billing_date ? new Date(aiSub.next_billing_date) : null;
      const expired = expiry && expiry < new Date();
      crmAiManualActive = !expired;
    }
  } catch {
    // segue sem o complemento manual
  }

  const aiEnabled = Boolean(plan.aiEnabled || crmAiManualActive);
  const automationsEnabled = Boolean(plan.automationsEnabled || crmAiManualActive);

  return {
    planKey,
    plan,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          payment_status: subscription.payment_status,
          next_billing_date: subscription.next_billing_date,
          billing_cycle_end: subscription.billing_cycle_end,
        }
      : null,
    usage: {
      messagesThisMonth: messagesUsed,
      messagesLimit: plan.messagesPerMonth,
      messagesRemaining: Math.max(0, plan.messagesPerMonth - messagesUsed),
      messagesPercent: plan.messagesPerMonth > 0
        ? Math.min(100, Math.round((messagesUsed / plan.messagesPerMonth) * 100))
        : 0,
    },
    features: {
      aiEnabled,
      automationsEnabled,
      attendants: plan.attendants,
      // bandeira para a UI saber que a liberacao veio do admin (manual)
      manualOverride: crmAiManualActive && !plan.aiEnabled,
    },
  };
}

// Middleware express. Uso: router.post('/x', authenticate, enforcePlanLimit('messagesPerMonth'), handler)
export function enforcePlanLimit(limitKey) {
  return async function planLimitMiddleware(req, res, next) {
    try {
      const userId = req.user?.establishment || req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Usuario nao identificado" });
      }
      const result = await checkLimit(userId, limitKey);
      if (!result.allowed) {
        return res.status(402).json({
          message: "Limite do plano atingido",
          limitKey,
          ...result,
          upgradeHint: result.planKey === "trial"
            ? "Faca upgrade para o plano Promocional ou Mensal."
            : "Considere o plano Mensal ou entre em contato.",
        });
      }
      // Anexa info ao req pra ser usada pelo handler se quiser
      req.planLimitInfo = result;
      next();
    } catch (error) {
      console.error("[planLimits] Erro:", error.message);
      // Em caso de erro do middleware, deixa passar para nao bloquear o sistema
      next();
    }
  };
}
