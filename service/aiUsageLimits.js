import { Op } from "sequelize";
import AiUsageLog from "../models/AiUsageLog.js";
import Subscription from "../models/Subscription.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";

const USD_TO_BRL = Number(process.env.AI_USAGE_USD_TO_BRL || 5.2);

const DEFAULT_AI_LIMITS = {
  trial: Number(process.env.AI_LIMIT_TRIAL_REPLIES || 50),
  promotional: Number(process.env.AI_LIMIT_PROMOTIONAL_REPLIES || 500),
  monthly: Number(process.env.AI_LIMIT_MONTHLY_REPLIES || 2000),
  crmAiSubscription: Number(process.env.AI_LIMIT_CRM_SUBSCRIPTION_REPLIES || 1000),
};

const PRICE_PER_MILLION_USD = {
  openai: { input: 5, output: 30 },
  groq: { input: 0, output: 0 },
  gemini: { input: 0, output: 0 },
  keywords: { input: 0, output: 0 },
  "agenda-availability": { input: 0, output: 0 },
};

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function estimateTokens(text) {
  const chars = String(text || "").length;
  return Math.max(1, Math.ceil(chars / 4));
}

function isActiveWithDate(row) {
  if (!row || row.status !== "active") return false;
  const next = row.next_billing_date || row.billing_cycle_end || row.trial_end || null;
  if (!next) return true;
  return new Date(next) >= new Date();
}

async function resolveAiPlan(userId) {
  const [subscription, crmAiSubscription] = await Promise.all([
    Subscription.findOne({
      where: {
        user_id: userId,
        status: { [Op.in]: ["active", "pending"] },
      },
      order: [["created_at", "DESC"]],
    }).catch(() => null),
    CrmAiSubscription.findOne({
      where: { user_id: userId, status: "active" },
      order: [["created_at", "DESC"]],
    }).catch(() => null),
  ]);

  if (isActiveWithDate(crmAiSubscription)) {
    return {
      planKey: "crmAiSubscription",
      source: "crm_ai_subscription",
      limit: DEFAULT_AI_LIMITS.crmAiSubscription,
      subscription,
      crmAiSubscription,
    };
  }

  const planKey = subscription?.plan_type || "trial";
  return {
    planKey,
    source: "main_subscription",
    limit: DEFAULT_AI_LIMITS[planKey] ?? DEFAULT_AI_LIMITS.trial,
    subscription,
    crmAiSubscription,
  };
}

export async function getAiUsageStatus(userId, date = new Date()) {
  const plan = await resolveAiPlan(userId);
  const since = startOfMonth(date);
  const used = await AiUsageLog.count({
    where: {
      organizationId: userId,
      success: true,
      createdAt: { [Op.gte]: since },
    },
  }).catch(() => 0);

  const costRows = await AiUsageLog.findAll({
    where: {
      organizationId: userId,
      createdAt: { [Op.gte]: since },
    },
    attributes: ["estimatedCost"],
  }).catch(() => []);
  const estimatedCost = costRows.reduce((sum, row) => sum + Number(row.estimatedCost || 0), 0);

  return {
    allowed: plan.limit <= 0 ? false : used < plan.limit,
    planKey: plan.planKey,
    source: plan.source,
    used,
    limit: plan.limit,
    remaining: Math.max(0, plan.limit - used),
    estimatedCost,
    estimatedCostBrl: Number((estimatedCost * USD_TO_BRL).toFixed(2)),
    periodStart: since,
  };
}

export async function assertAiUsageAllowed(userId) {
  const status = await getAiUsageStatus(userId);
  if (!status.allowed) {
    const error = new Error("Limite mensal de IA atingido para este pet shop.");
    error.code = "ai_monthly_limit_reached";
    error.usage = status;
    throw error;
  }
  return status;
}

export function estimateAiUsageCost({ source, promptText, completionText }) {
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(completionText);
  const totalTokens = promptTokens + completionTokens;
  const price = PRICE_PER_MILLION_USD[source] || PRICE_PER_MILLION_USD.keywords;
  const estimatedCost =
    (promptTokens / 1_000_000) * Number(price.input || 0) +
    (completionTokens / 1_000_000) * Number(price.output || 0);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCost: Number(estimatedCost.toFixed(6)),
  };
}

export async function logAiUsage({
  organizationId,
  conversationId = null,
  userId = null,
  model = "",
  source = "keywords",
  promptText = "",
  completionText = "",
  success = true,
  errorMessage = null,
}) {
  const usage = estimateAiUsageCost({ source, promptText, completionText });
  return AiUsageLog.create({
    organizationId,
    conversationId,
    userId,
    model: model || source,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    estimatedCost: usage.estimatedCost,
    success,
    errorMessage,
  });
}
