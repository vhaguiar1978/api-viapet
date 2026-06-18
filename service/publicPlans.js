export const FISCAL_COMING_SOON_MESSAGE =
  "Em breve: emissão integrada de NFS-e, NFC-e e NF-e.";

const sharedFeatures = [
  { key: "agenda", label: "Agenda completa", included: true, status: "available" },
  { key: "cadastros", label: "Tutores, pets e serviços", included: true, status: "available" },
  { key: "pacotinhos", label: "Pacotinhos e recorrências", included: true, status: "available" },
  { key: "financeiro", label: "Financeiro e fluxo de caixa", included: true, status: "available" },
  { key: "relatorios", label: "Relatórios gerenciais", included: true, status: "available" },
  { key: "crm", label: "CRM e atendimento", included: true, status: "available" },
  { key: "whatsapp", label: "WhatsApp integrado", included: true, status: "beta" },
  { key: "ia", label: "IA para atendimento e automações", included: true, status: "beta" },
  { key: "multiusuario", label: "Equipe e permissões", included: true, status: "available" },
  { key: "fiscal", label: "NFS-e, NFC-e e NF-e integradas", included: false, status: "soon" },
];

export const DEFAULT_PUBLIC_PLANS = [
  {
    id: "essential",
    name: "ViaPet Essencial",
    monthlyPrice: 69.9,
    annualPrice: null,
    description: "O essencial para organizar a rotina e atender melhor todos os dias.",
    recommended: false,
    active: true,
    order: 1,
    features: sharedFeatures.map((feature) => ({
      ...feature,
      included: ["agenda", "cadastros", "pacotinhos", "financeiro"].includes(feature.key),
    })),
  },
  {
    id: "professional",
    name: "ViaPet Profissional",
    monthlyPrice: 119.9,
    annualPrice: null,
    description: "Mais controle, relacionamento e produtividade para negócios em crescimento.",
    recommended: true,
    active: true,
    order: 2,
    features: sharedFeatures.map((feature) => ({
      ...feature,
      included: !["ia", "fiscal"].includes(feature.key),
    })),
  },
  {
    id: "premium",
    name: "ViaPet Premium",
    monthlyPrice: 179.9,
    annualPrice: null,
    description: "Gestão completa, inteligência e automações para operações que querem escalar.",
    recommended: false,
    active: true,
    order: 3,
    features: sharedFeatures.map((feature) => ({ ...feature })),
  },
];

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePublicPlans(value) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_PUBLIC_PLANS;

  return source
    .map((plan, index) => ({
      id: String(plan?.id || `plan-${index + 1}`),
      name: String(plan?.name || `Plano ${index + 1}`),
      monthlyPrice: safeNumber(plan?.monthlyPrice, 0),
      annualPrice: safeNumber(plan?.annualPrice, null),
      description: String(plan?.description || ""),
      recommended: plan?.recommended === true,
      active: plan?.active !== false,
      order: safeNumber(plan?.order, index + 1),
      features: (Array.isArray(plan?.features) ? plan.features : []).map((feature, featureIndex) => ({
        key: String(feature?.key || `feature-${featureIndex + 1}`),
        label: String(feature?.label || "Recurso"),
        included: feature?.included === true,
        status: ["available", "beta", "soon"].includes(feature?.status)
          ? feature.status
          : "available",
      })),
    }))
    .sort((a, b) => a.order - b.order);
}

export function buildPublicPlansPayload(settings) {
  const plans = normalizePublicPlans(settings?.publicPlans);
  const trialDays = Number(settings?.trialDays || 30) || 30;
  const fiscalModuleEnabled = settings?.fiscalModuleEnabled === true;

  return {
    plans,
    trialDays,
    fiscalModuleEnabled,
    fiscalMessage: fiscalModuleEnabled ? "" : FISCAL_COMING_SOON_MESSAGE,
    updatedAt: settings?.updatedAt || null,
  };
}
