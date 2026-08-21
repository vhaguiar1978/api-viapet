import { Op } from "sequelize";
import AiCalendarRule from "../models/AiCalendarRule.js";
import AiEntityRule from "../models/AiEntityRule.js";
import Appointment from "../models/Appointment.js";

export const DEFAULT_AI_CALENDAR_RULES = { minimumNoticeMinutes: 120, maximumAdvanceDays: 90, minimumCancellationMinutes: 120, minimumRescheduleMinutes: 120, dailyLimitPerCustomer: 3, dailyLimitPerPet: 1, intervalMinutes: 0, maximumOverbookingsPerDay: 0, maxAutomaticTransactionValue: null, schedule: {}, settings: {} };
export async function getAiCalendarRules(usersId) { return (await AiCalendarRule.findOne({ where: { usersId } })) || { usersId, ...DEFAULT_AI_CALENDAR_RULES }; }
export async function saveAiCalendarRules(usersId, payload = {}) { const clean = {}; for (const key of Object.keys(DEFAULT_AI_CALENDAR_RULES)) if (payload[key] !== undefined) clean[key] = payload[key]; const [row] = await AiCalendarRule.upsert({ usersId, ...clean }, { returning: true }); return row; }
export async function listAiEntityRules(usersId, entityType) { return AiEntityRule.findAll({ where: { usersId, ...(entityType ? { entityType } : {}) }, order: [["entityType", "ASC"], ["createdAt", "DESC"]] }); }
export async function saveAiEntityRule(usersId, payload) { if (!["service", "professional", "customer", "pet"].includes(payload.entityType) || !payload.entityId) throw new Error("Entidade da regra invalida."); const [row] = await AiEntityRule.upsert({ usersId, entityType: payload.entityType, entityId: payload.entityId, permissionMode: payload.permissionMode || "customer_confirmation", active: payload.active !== false, minimumNoticeMinutes: payload.minimumNoticeMinutes ?? null, requiresProfessional: payload.requiresProfessional === true, requiresHumanValidation: payload.requiresHumanValidation === true, settings: payload.settings || {} }, { returning: true }); return row; }
export async function deleteAiEntityRule(usersId, ruleId) { const deleted = await AiEntityRule.destroy({ where: { usersId, id: ruleId } }); if (!deleted) throw new Error("Regra especifica nao encontrada."); return true; }

function appointmentDateTime(date, time) { return new Date(`${String(date).slice(0, 10)}T${String(time || "00:00").slice(0, 5)}:00`); }
function requireHumanApproval(message) { const error = new Error(message); error.code = "human_approval_required"; throw error; }
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function validateAutonomyWindow(rules, target, payload) { const schedule = rules?.schedule || {}; if (!Object.keys(schedule).length || payload.humanApproved) return; const day = schedule[DAY_KEYS[target.getDay()]]; const time = `${String(target.getHours()).padStart(2, "0")}:${String(target.getMinutes()).padStart(2, "0")}`; if (!day?.enabled || time < String(day.start || "00:00") || time > String(day.end || "23:59")) requireHumanApproval("A autonomia da IA nao esta liberada neste dia ou horario."); }

export async function validateAiCalendarMutation({ usersId, action, payload, appointment = null, service = null }) {
  const rules = await getAiCalendarRules(usersId);
  const target = appointmentDateTime(payload.date || appointment?.date, payload.time || appointment?.time);
  if (Number.isNaN(target.getTime())) throw new Error("Data ou horario invalido.");
  validateAutonomyWindow(rules, target, payload);
  const minutes = (target - Date.now()) / 60000;
  const minimum = action === "appointment_cancel" ? Number(rules.minimumCancellationMinutes) : action === "appointment_reschedule" ? Number(rules.minimumRescheduleMinutes) : Number(rules.minimumNoticeMinutes);
  if (minutes < minimum) throw new Error(`Esta acao exige antecedencia minima de ${minimum} minutos.`);
  if (minutes > Number(rules.maximumAdvanceDays) * 1440) throw new Error(`A agenda da IA aceita no maximo ${rules.maximumAdvanceDays} dias de antecedencia.`);
  const targetDate = String(payload.date || appointment?.date).slice(0, 10);
  const exclude = appointment?.id ? { id: { [Op.ne]: appointment.id } } : {};
  const activeStatus = { [Op.notIn]: ["Cancelado", "cancelado", "Finalizado", "finalizado"] };
  if (payload.customerId && await Appointment.count({ where: { usersId, customerId: payload.customerId, date: targetDate, ...exclude, status: activeStatus } }) >= Number(rules.dailyLimitPerCustomer)) throw new Error("Limite diario de agendamentos deste tutor atingido.");
  if (payload.petId && await Appointment.count({ where: { usersId, petId: payload.petId, date: targetDate, ...exclude, status: activeStatus } }) >= Number(rules.dailyLimitPerPet)) throw new Error("Limite diario de agendamentos deste pet atingido.");
  if (["appointment_create", "appointment_reschedule"].includes(action)) {
    const sameSlotCount = await Appointment.count({ where: { usersId, date: targetDate, time: String(payload.time || appointment?.time).slice(0, 5), ...exclude, status: activeStatus } });
    const capacity = Math.max(1, Number(service?.maxParallelQuantity || 1));
    if (sameSlotCount >= capacity) {
      const excess = sameSlotCount - capacity + 1;
      const dailyOverbookings = await Appointment.count({ where: { usersId, date: targetDate, aiOverbooking: true, ...exclude, status: activeStatus } });
      if (!payload.overbooking || excess < 1 || dailyOverbookings >= Number(rules.maximumOverbookingsPerDay || 0)) throw new Error("A capacidade maxima deste horario ou o limite diario de encaixes foi atingido.");
      if (!payload.humanApproved) requireHumanApproval("Este encaixe exige aprovacao humana.");
    }
    const professionalId = payload.professionalId || appointment?.responsibleId;
    if (professionalId && await Appointment.count({ where: { usersId, responsibleId: professionalId, date: targetDate, time: String(payload.time || appointment?.time).slice(0, 5), ...exclude, status: activeStatus } })) throw new Error("Este profissional ja possui atendimento no horario escolhido.");
  }
  const ids = [["service", payload.serviceId || service?.id], ["professional", payload.professionalId], ["customer", payload.customerId], ["pet", payload.petId]].filter(([, id]) => id);
  const entityRules = await Promise.all(ids.map(([entityType, entityId]) => AiEntityRule.findOne({ where: { usersId, entityType, entityId, active: true } })));
  for (const rule of entityRules.filter(Boolean)) { if (rule.permissionMode === "denied") throw new Error("Esta configuracao especifica nao permite alteracoes pela IA."); if ((rule.permissionMode === "human_approval" || rule.requiresHumanValidation) && !payload.humanApproved) requireHumanApproval("Este atendimento exige validacao humana."); }
  if (rules.maxAutomaticTransactionValue != null && service && Number(service.price) > Number(rules.maxAutomaticTransactionValue) && !payload.humanApproved) requireHumanApproval("O valor deste servico exige aprovacao humana.");
  return { valid: true, rules, entityRules };
}
