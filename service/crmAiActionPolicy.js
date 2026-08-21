const ACTION_CAPABILITIES = {
  reply_message: "replyToMessages",
  create_customer: "createCustomer",
  create_pet: "createPet",
  schedule_appointment: "createAppointment",
  create_appointment: "createAppointment",
  update_appointment: "updateAppointment",
  reschedule_appointment: "updateAppointment",
  cancel_appointment: "cancelAppointment",
  view_financial: "viewFinancial",
};

const TUTOR_CONFIRMATION_ACTIONS = new Set([
  "schedule_appointment",
  "create_appointment",
  "update_appointment",
  "reschedule_appointment",
  "cancel_appointment",
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function hasExplicitTutorConfirmation(message, actionType = "") {
  const text = normalizeText(message);
  if (!text) return false;

  if (
    [
      /\bnao\b/,
      /\bdeixa pra la\b/,
      /\bdesisto\b/,
    ].some((pattern) => pattern.test(text))
  ) {
    return false;
  }

  if (
    [
      /^(sim|pode|confirmo|confirma|ok|okay|fechado|combinado|esta certo|ta certo|tudo certo)\b/,
      /\b(pode confirmar|pode fazer|pode seguir|esta confirmado|ta confirmado)\b/,
    ].some((pattern) => pattern.test(text))
  ) {
    return true;
  }

  if (["schedule_appointment", "create_appointment"].includes(actionType)) {
    return /\b(pode agendar|pode marcar|agenda|agende|marca|marque)\b/.test(text);
  }
  if (["update_appointment", "reschedule_appointment"].includes(actionType)) {
    return /\b(pode remarcar|remarca|remarque|pode mudar|pode trocar)\b/.test(text);
  }
  if (actionType === "cancel_appointment") {
    return /\b(pode cancelar|cancela|cancele|confirmo o cancelamento)\b/.test(text);
  }

  return false;
}

export function evaluateCrmAiActionPolicy({
  control = {},
  actionType,
  tutorMessage = "",
  tutorConfirmed: tutorConfirmedOverride,
  humanApproved = false,
  payload = {},
} = {}) {
  const normalizedAction = String(actionType || "").trim();
  const capability = ACTION_CAPABILITIES[normalizedAction] || "";
  const scheduling = control?.scheduling || {};
  const reasons = [];
  const warnings = [];

  if (!control?.enabled) reasons.push("A IA esta desativada.");
  if (!capability || !control?.capabilities?.[capability]) {
    reasons.push("Essa acao nao esta liberada nas permissoes da IA.");
  }

  if (
    normalizedAction === "create_customer" &&
    payload?.isNewCustomer &&
    !scheduling.allowNewCustomer
  ) {
    reasons.push("A IA nao pode cadastrar tutor novo automaticamente.");
  }

  if (
    ["create_pet", "create_appointment", "schedule_appointment"].includes(normalizedAction) &&
    payload?.isNewPet &&
    !scheduling.allowNewPet
  ) {
    reasons.push("A IA nao pode cadastrar pet novo automaticamente.");
  }

  const tutorConfirmationRequired =
    scheduling.requireTutorConfirmation !== false &&
    TUTOR_CONFIRMATION_ACTIONS.has(normalizedAction);
  const tutorConfirmed =
    !tutorConfirmationRequired ||
    tutorConfirmedOverride === true ||
    hasExplicitTutorConfirmation(tutorMessage, normalizedAction);

  if (!tutorConfirmed) {
    warnings.push("O tutor ainda nao confirmou esta acao de forma explicita.");
  }

  const blocked = reasons.length > 0;
  const requiresApproval =
    !blocked &&
    !humanApproved &&
    (Boolean(scheduling.requireHumanApproval) ||
      control?.autoExecuteEnabled !== true ||
      !tutorConfirmed);

  return {
    allowed: !blocked,
    capability,
    tutorConfirmationRequired,
    tutorConfirmed,
    requiresApproval,
    executionMode: blocked
      ? "blocked"
      : requiresApproval
        ? "approval"
        : "automatic",
    reasons,
    warnings,
  };
}

export const CRM_AI_ACTION_CAPABILITIES = ACTION_CAPABILITIES;
