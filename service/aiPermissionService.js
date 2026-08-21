import AiPermission from "../models/AiPermission.js";
import AiSettings from "../models/AiSettings.js";

export const AI_PERMISSION_MODES = Object.freeze([
  "automatic",
  "customer_confirmation",
  "human_approval",
  "denied",
]);

export const AI_CALENDAR_PERMISSION_DEFAULTS = Object.freeze({
  consult_calendar: "automatic",
  consult_available_slots: "automatic",
  consult_customer_appointments: "automatic",
  consult_pet_history: "automatic",
  consult_professional: "automatic",
  consult_service: "automatic",
  consult_price: "automatic",
  consult_duration: "automatic",
  consult_transport: "automatic",
  appointment_create: "customer_confirmation",
  appointment_reschedule: "customer_confirmation",
  appointment_cancel: "customer_confirmation",
  appointment_change_service: "customer_confirmation",
  appointment_change_professional: "customer_confirmation",
  appointment_add_service: "customer_confirmation",
  appointment_remove_service: "customer_confirmation",
  calendar_create_overbooking: "human_approval",
  calendar_block_slot: "denied",
  calendar_unblock_slot: "denied",
  calendar_outside_business_hours: "denied",
  calendar_exceed_capacity: "denied",
  calendar_ignore_interval: "denied",
});

export const OPERATIONAL_PERMISSION_ACTIONS = Object.freeze({
  buscar_cliente_por_telefone: "consult_customer_appointments",
  listar_servicos_disponiveis: "consult_service",
  consultar_horarios_disponiveis: "consult_available_slots",
  criar_agendamento: "appointment_create",
  remarcar_agendamento: "appointment_reschedule",
  cancelar_agendamento: "appointment_cancel",
  adicionar_servico_ao_agendamento: "appointment_add_service",
});

function isExplicitConfirmation(payload = {}) {
  if (payload.confirmed === true || payload.tutorConfirmed === true) return true;
  const text = String(payload.confirmationText || payload.lastCustomerMessage || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!text || /\b(nao|talvez|acho que|depois|vou ver|nao sei)\b/.test(text)) return false;
  return /^(sim|confirmo|confirmado|ok|okay|fechado|combinado)(\b|[,.!])/i.test(text) ||
    /\b(pode confirmar|pode agendar|pode remarcar|pode cancelar)\b/.test(text);
}

export function evaluatePermissionMode({ mode, payload = {}, humanApproved = false, writesPaused = false }) {
  if (writesPaused) return { allowed: false, executable: false, mode, reason: "ai_writes_paused" };
  if (mode === "denied") return { allowed: false, executable: false, mode, reason: "permission_denied" };
  if (mode === "customer_confirmation" && !isExplicitConfirmation(payload)) {
    return { allowed: true, executable: false, mode, reason: "customer_confirmation_required" };
  }
  if (mode === "human_approval" && humanApproved !== true && payload.humanApproved !== true) {
    return { allowed: true, executable: false, mode, reason: "human_approval_required" };
  }
  return { allowed: true, executable: true, mode, reason: "" };
}

export async function listAiPermissions(usersId) {
  const rows = await AiPermission.findAll({ where: { usersId }, order: [["action", "ASC"]] });
  const saved = new Map(rows.map((row) => [row.action, row]));
  return Object.entries(AI_CALENDAR_PERMISSION_DEFAULTS).map(([action, defaultMode]) => {
    const row = saved.get(action);
    return {
      action,
      permissionMode: row?.active === false ? "denied" : row?.permissionMode || defaultMode,
      active: row?.active !== false,
      settings: row?.settings || {},
      inherited: !row,
    };
  });
}

export async function saveAiPermissions(usersId, permissions = []) {
  const allowedActions = new Set(Object.keys(AI_CALENDAR_PERMISSION_DEFAULTS));
  const saved = [];
  for (const item of permissions) {
    const action = String(item?.action || "").trim();
    const permissionMode = String(item?.permissionMode || "").trim();
    if (!allowedActions.has(action)) throw new Error(`Permissao de IA desconhecida: ${action}`);
    if (!AI_PERMISSION_MODES.includes(permissionMode)) throw new Error(`Modo de permissao invalido: ${permissionMode}`);
    const [row] = await AiPermission.upsert({
      usersId,
      action,
      permissionMode,
      active: item.active !== false,
      settings: item.settings && typeof item.settings === "object" ? item.settings : {},
    }, { returning: true });
    saved.push(row);
  }
  return saved;
}

export async function checkAiPermission(usersId, action, context = {}) {
  if (!usersId) throw new Error("tenant ausente ao verificar permissao da IA");
  const [permission, aiSettings] = await Promise.all([
    AiPermission.findOne({ where: { usersId, action } }),
    AiSettings.findOne({ where: { usersId } }),
  ]);
  const defaultMode = AI_CALENDAR_PERMISSION_DEFAULTS[action] || "denied";
  const mode = permission?.active === false ? "denied" : permission?.permissionMode || defaultMode;
  const writesPaused = Boolean(aiSettings?.settings?.calendarWritesPaused);
  return {
    action,
    inherited: !permission,
    settings: permission?.settings || {},
    ...evaluatePermissionMode({ mode, payload: context.payload, humanApproved: context.humanApproved, writesPaused }),
  };
}
