export const RADAR_DEFAULTS = Object.freeze({
  mode: "observe",
  operationalDays: [1, 2, 3, 4, 5],
  holidays: [],
  inactivityThresholdDays: 3,
  contactStart: "09:00",
  contactEnd: "18:00",
  maxAttempts: 3,
  minHoursBetweenContacts: 72,
  instructions: "Ajude o cliente a usar o ViaPet antes de oferecer uma assinatura.",
});

function localDay(value) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function countOperationalDays(from, to = new Date(), settings = RADAR_DEFAULTS) {
  if (!from || Number.isNaN(new Date(from).getTime())) return 0;
  const begin = new Date(from); const end = new Date(to);
  if (begin >= end) return 0;
  const date = new Date(`${localDay(begin)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const final = new Date(`${localDay(end)}T12:00:00Z`);
  final.setUTCDate(final.getUTCDate() - 1);
  const days = new Set(settings.operationalDays || RADAR_DEFAULTS.operationalDays);
  const holidays = new Set(settings.holidays || []);
  let count = 0;
  while (date <= final) {
    const key = date.toISOString().slice(0, 10);
    if (days.has(date.getUTCDay()) && !holidays.has(key)) count += 1;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return count;
}

const isHuman = (conversation) => conversation?.attendanceMode === "human" || conversation?.aiPaused === true;
const isOptOut = (consent) => consent?.consentStatus === "opt_out" || Boolean(consent?.optOutAt);
const hasConfirmedPayment = (subscription, payment) => subscription?.plan_type !== "trial" && subscription?.status === "active" && (subscription?.payment_status === "approved" || payment?.status === "approved");

export function evaluateRelationship({ user, activities = [], subscription = null, payment = null, consent = null, conversation = null, sellerId = null, settings = RADAR_DEFAULTS, now = new Date() }) {
  const access = user.lastAccess || user.createdAt;
  const inactiveDays = countOperationalDays(access, now, settings);
  const recent = activities.filter((item) => new Date(item.created_at) >= new Date(now.getTime() - 7 * 86400000));
  const agendaViews = recent.filter((item) => item.modulo === "navegacao" && /agenda/i.test(String(item.metadata_json?.path || item.descricao || ""))).length;
  const completed = recent.filter((item) => item.modulo !== "auth" && item.modulo !== "navegacao" && /created|completed|confirmado|success/i.test(String(item.acao || ""))).length;
  const activityCount = recent.length;
  const earlyDifficulty = agendaViews >= 3 && completed === 0 && inactiveDays < Number(settings.inactivityThresholdDays || 3);
  const signals = { inactiveOperationalDays: inactiveDays, recentActivityCount: activityCount, agendaViews, completedActions: completed, confirmedPayment: hasConfirmedPayment(subscription, payment), humanActive: isHuman(conversation), optedOut: isOptOut(consent), sellerAssigned: Boolean(sellerId) };
  let score = Math.max(0, Math.min(100, 55 + Math.min(25, completed * 5) + Math.min(10, activityCount * 2) - Math.min(40, inactiveDays * 9) - (earlyDifficulty ? 20 : 0)));
  let state = "configurando"; let nextAction = "observe"; let reason = "Cliente em acompanhamento; ainda não há motivo para contato.";
  if (signals.optedOut) { state = "sem_contato"; nextAction = "none"; reason = "Cliente pediu para não receber contatos."; }
  else if (signals.humanActive) { state = "atendimento_humano"; nextAction = "none"; reason = "Atendimento humano está ativo; IA pausada."; }
  else if (signals.confirmedPayment) { state = "assinante_ativo"; nextAction = "observe"; reason = "Pagamento confirmado; não oferecer nova assinatura."; score = Math.max(score, 70); }
  else if (earlyDifficulty) { state = "possivel_dificuldade"; nextAction = "offer_help"; reason = "Agenda aberta repetidas vezes sem ação concluída; oferecer ajuda pode ser útil."; }
  else if (inactiveDays >= Number(settings.inactivityThresholdDays || 3)) { state = "inativo"; nextAction = "evaluate_reactivation"; reason = `${inactiveDays} dias operacionais sem acesso; avaliar histórico antes de abordar.`; }
  else if (completed > 0) { state = "engajado"; nextAction = "observe"; reason = "Cliente realizou ações no ViaPet recentemente."; }
  if (consent?.consentStatus !== "granted" && ["offer_help", "evaluate_reactivation"].includes(nextAction)) {
    reason += " Contato proativo bloqueado até haver consentimento registrado.";
  }
  return { state, healthScore: score, nextAction, reason, signals, executionMode: settings.mode || "observe", canSend: false };
}
