import Users from "../models/Users.js";
import Subscription from "../models/Subscription.js";
import ClientAccessControl from "../models/ClientAccessControl.js";
import { getOrCreateBillingSettings } from "./billingAccess.js";
import { normalizePublicPlans } from "./publicPlans.js";

const LEGACY_PLAN_IDS = new Set(["monthly", "promotional", "trial"]);

const FEATURE_EXPANSIONS = {
  agenda: ["agenda"],
  cadastros: ["cadastros", "clientes", "pets", "configuracoes"],
  pacotinhos: ["pacotes"],
  financeiro: ["financeiro", "venda"],
  relatorios: ["financeiro"],
  crm: ["crm", "mensagens", "viacentral"],
  whatsapp: ["whatsapp"],
  ia: ["crm-ai"],
  multiusuario: ["configuracoes"],
  exames: ["exames"],
  fila: ["fila"],
  internacao: ["internacao"],
};

function normalizePlanId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["essential", "professional", "premium"].includes(normalized)) {
    return normalized;
  }
  return "";
}

export function getSubscriptionPlanId(subscription) {
  const notes = String(subscription?.notes || "");
  const notesMatch = notes.match(/plano\s+escolhido\s*:\s*(essential|professional|premium)/i);
  if (notesMatch?.[1]) return normalizePlanId(notesMatch[1]);

  const directPlan = normalizePlanId(subscription?.plan_type);
  if (directPlan) return directPlan;

  // O plano antigo era completo. Mantemos essas contas como Premium para
  // evitar retirar recursos de clientes que já os utilizavam.
  if (LEGACY_PLAN_IDS.has(String(subscription?.plan_type || "").toLowerCase())) {
    return "premium";
  }

  return "essential";
}

function expandPlanFeatures(plan) {
  const features = new Set(["configuracoes"]);
  for (const item of plan?.features || []) {
    if (!item?.included || item?.status === "soon") continue;
    for (const feature of FEATURE_EXPANSIONS[item.key] || []) {
      features.add(feature);
    }
  }
  return [...features];
}

function readManualAccess(accessControl, planFeatures) {
  if (!accessControl) return planFeatures;
  const now = new Date();
  const startsAt = accessControl.access_starts_at
    ? new Date(accessControl.access_starts_at)
    : null;
  const endsAt = accessControl.access_ends_at
    ? new Date(accessControl.access_ends_at)
    : null;

  if (accessControl.status === "blocked") {
    return { blocked: true, reason: "Acesso bloqueado pelo administrador.", features: [] };
  }
  if (startsAt && startsAt > now) {
    return { blocked: true, reason: "O período de acesso ainda não começou.", features: [] };
  }
  if (!accessControl.unlimited_access && endsAt && endsAt < now) {
    return { blocked: true, reason: "O período de acesso configurado terminou.", features: [] };
  }

  const configured = Array.isArray(accessControl.features)
    ? accessControl.features.map(String)
    : [];
  const features = configured.length
    ? planFeatures.filter((feature) => configured.includes(feature))
    : planFeatures;
  return { blocked: false, reason: "", features };
}

export async function resolvePlanAccess(userOrId) {
  const user =
    typeof userOrId === "object" && userOrId
      ? userOrId
      : await Users.findByPk(userOrId, {
          attributes: ["id", "role", "establishment"],
        });

  if (!user) {
    return {
      planId: "essential",
      planName: "ViaPet Essencial",
      features: [],
      blocked: true,
      reason: "Usuário não encontrado.",
    };
  }

  if (user.role === "admin") {
    return {
      planId: "admin",
      planName: "Administrador",
      features: ["*"],
      blocked: false,
      reason: "",
    };
  }

  const ownerId =
    user.role === "funcionario" && user.establishment
      ? user.establishment
      : user.id;
  const [subscription, settings, accessControl] = await Promise.all([
    Subscription.findOne({
      where: { user_id: ownerId },
      order: [["created_at", "DESC"]],
    }),
    getOrCreateBillingSettings(),
    ClientAccessControl.findOne({ where: { user_id: ownerId } }),
  ]);
  const plans = normalizePublicPlans(settings?.publicPlans);
  const planId = getSubscriptionPlanId(subscription);
  const plan = plans.find((item) => item.id === planId) || plans[0];
  const planFeatures = expandPlanFeatures(plan);
  const manualAccess = readManualAccess(accessControl, planFeatures);

  return {
    planId: plan?.id || planId,
    planName: plan?.name || "Plano ViaPet",
    features: manualAccess.features,
    planFeatures,
    blocked: manualAccess.blocked,
    reason: manualAccess.reason,
  };
}

export function hasPlanFeature(planAccess, feature) {
  return (
    !planAccess?.blocked &&
    (planAccess?.features?.includes("*") || planAccess?.features?.includes(feature))
  );
}
