import { Op } from "sequelize";
import Settings from "../models/Settings.js";
import Appointment from "../models/Appointment.js";
import Custumers from "../models/Custumers.js";
import Pet from "../models/Pets.js";
import BaileysService from "./baileys.js";
import { checkLimit } from "./planLimits.js";

// Catalogo central das automacoes suportadas (mesmas chaves usadas no frontend)
export const AUTOMATION_TYPES = [
  "confirmation",
  "reminder",
  "ready",
  "return",
  "overduePayment",
];

export function buildDefaultAutomations() {
  return {
    enabled: false,
    confirmation: {
      enabled: false,
      templateBody:
        "Ola {customer}! Confirmando o agendamento do {pet} para {date} as {time}. Qualquer coisa, e so chamar por aqui.",
    },
    reminder: {
      enabled: false,
      hoursBeforeAppointment: 2,
      templateBody:
        "Oi {customer}, lembrete: o {pet} tem horario hoje as {time}. Te esperamos!",
    },
    ready: {
      enabled: false,
      templateBody:
        "Oi {customer}, o {pet} esta pronto! Pode vir buscar quando puder.",
    },
    return: {
      enabled: false,
      daysAfterService: 30,
      templateBody:
        "Oi {customer}! Faz um tempinho que o {pet} nao passa por aqui. Que tal agendar um banhozinho?",
    },
    overduePayment: {
      enabled: false,
      daysAfterDue: 3,
      templateBody:
        "Oi {customer}, identificamos um pagamento em aberto referente ao {pet}. Quando puder, da uma olhadinha pra gente?",
    },
  };
}

export function mergeAutomationsConfig(stored = {}) {
  const defaults = buildDefaultAutomations();
  const merged = { ...defaults, ...(stored || {}) };
  for (const type of AUTOMATION_TYPES) {
    merged[type] = { ...defaults[type], ...(stored?.[type] || {}) };
  }
  merged.enabled = Boolean(merged.enabled);
  return merged;
}

function fillTemplate(template, vars = {}) {
  let body = String(template || "");
  for (const [key, value] of Object.entries(vars)) {
    body = body.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return body;
}

function formatDateBR(date) {
  if (!date) return "";
  try {
    const d = new Date(date);
    return d.toLocaleDateString("pt-BR");
  } catch (_) {
    return String(date);
  }
}

function formatTimeBR(time) {
  if (!time) return "";
  return String(time).slice(0, 5);
}

async function loadAppointmentContext(appointment, usersId) {
  const [customer, pet] = await Promise.all([
    appointment.customerId
      ? Custumers.findOne({ where: { id: appointment.customerId, usersId } })
      : null,
    appointment.petId
      ? Pet.findOne({ where: { id: appointment.petId, usersId } })
      : null,
  ]);
  return { customer, pet };
}

function alreadySent(appointment, type) {
  const sent = Array.isArray(appointment?.automationsSent)
    ? appointment.automationsSent
    : [];
  return sent.some((entry) => entry?.type === type);
}

async function markSent(appointment, type) {
  const sent = Array.isArray(appointment?.automationsSent)
    ? [...appointment.automationsSent]
    : [];
  sent.push({ type, sentAt: new Date().toISOString() });
  await appointment.update({ automationsSent: sent });
}

async function sendForAppointment({ usersId, appointment, type, templateBody }) {
  const { customer, pet } = await loadAppointmentContext(appointment, usersId);
  if (!customer?.phone) {
    return { skipped: "no_phone" };
  }

  const message = fillTemplate(templateBody, {
    customer: customer.name || "",
    pet: pet?.name || "",
    date: formatDateBR(appointment.date),
    time: formatTimeBR(appointment.time),
  });

  const baileys = BaileysService.getInstance(usersId, "default");
  const isConnected = await baileys.isConnected();
  if (!isConnected) {
    return { skipped: "not_connected" };
  }

  try {
    await baileys.sendMessage(customer.phone, message);
    await markSent(appointment, type);
    return { sent: true, phone: customer.phone };
  } catch (error) {
    return { skipped: "send_error", error: error.message };
  }
}

// Cada runner abaixo busca os candidatos do tipo e dispara o envio.
// Todos checam alreadySent antes para nao duplicar.

async function runConfirmation({ usersId, config }) {
  if (!config?.enabled) return { type: "confirmation", processed: 0 };
  // Confirma agendamentos criados nas ultimas 2 horas (status Agendado)
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const candidates = await Appointment.findAll({
    where: {
      usersId,
      status: "Agendado",
      createdAt: { [Op.gte]: since },
    },
    limit: 50,
  });

  let sent = 0;
  for (const appt of candidates) {
    if (alreadySent(appt, "confirmation")) continue;
    const result = await sendForAppointment({
      usersId,
      appointment: appt,
      type: "confirmation",
      templateBody: config.templateBody,
    });
    if (result.sent) sent += 1;
  }
  return { type: "confirmation", processed: candidates.length, sent };
}

async function runReminder({ usersId, config }) {
  if (!config?.enabled) return { type: "reminder", processed: 0 };
  const hoursBefore = Math.max(Number(config.hoursBeforeAppointment || 2), 1);
  const now = new Date();
  const targetMinutes = hoursBefore * 60;
  // Janela: appointments cuja data+time esteja entre (target - 5min) e (target + 5min) a partir de agora
  const lowerBound = new Date(now.getTime() + (targetMinutes - 5) * 60 * 1000);
  const upperBound = new Date(now.getTime() + (targetMinutes + 5) * 60 * 1000);
  const dayOfTarget = lowerBound.toISOString().slice(0, 10);

  const candidates = await Appointment.findAll({
    where: {
      usersId,
      status: "Agendado",
      date: dayOfTarget,
    },
    limit: 100,
  });

  let sent = 0;
  for (const appt of candidates) {
    if (alreadySent(appt, "reminder")) continue;
    const apptDateTime = new Date(`${appt.date}T${appt.time}`);
    if (apptDateTime < lowerBound || apptDateTime > upperBound) continue;
    const result = await sendForAppointment({
      usersId,
      appointment: appt,
      type: "reminder",
      templateBody: config.templateBody,
    });
    if (result.sent) sent += 1;
  }
  return { type: "reminder", processed: candidates.length, sent };
}

async function runReady({ usersId, config }) {
  if (!config?.enabled) return { type: "ready", processed: 0 };
  // Pet pronto: status mudou pra "Concluido" ou "Pronto" nas ultimas 2h
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const candidates = await Appointment.findAll({
    where: {
      usersId,
      status: { [Op.in]: ["Concluido", "Pronto", "Finalizado"] },
      updatedAt: { [Op.gte]: since },
    },
    limit: 50,
  });

  let sent = 0;
  for (const appt of candidates) {
    if (alreadySent(appt, "ready")) continue;
    const result = await sendForAppointment({
      usersId,
      appointment: appt,
      type: "ready",
      templateBody: config.templateBody,
    });
    if (result.sent) sent += 1;
  }
  return { type: "ready", processed: candidates.length, sent };
}

async function runReturn({ usersId, config }) {
  if (!config?.enabled) return { type: "return", processed: 0 };
  const days = Math.max(Number(config.daysAfterService || 30), 1);
  const target = new Date();
  target.setDate(target.getDate() - days);
  const targetDay = target.toISOString().slice(0, 10);

  const candidates = await Appointment.findAll({
    where: {
      usersId,
      status: { [Op.in]: ["Concluido", "Pronto", "Finalizado"] },
      date: targetDay,
    },
    limit: 50,
  });

  let sent = 0;
  for (const appt of candidates) {
    if (alreadySent(appt, "return")) continue;
    const result = await sendForAppointment({
      usersId,
      appointment: appt,
      type: "return",
      templateBody: config.templateBody,
    });
    if (result.sent) sent += 1;
  }
  return { type: "return", processed: candidates.length, sent };
}

async function runOverduePayment({ usersId, config }) {
  if (!config?.enabled) return { type: "overduePayment", processed: 0 };
  // Cobranca: appointments com paymentMethod vazio/pendente apos N dias do servico
  const days = Math.max(Number(config.daysAfterDue || 3), 1);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffDay = cutoff.toISOString().slice(0, 10);

  const candidates = await Appointment.findAll({
    where: {
      usersId,
      status: { [Op.in]: ["Concluido", "Pronto", "Finalizado"] },
      date: { [Op.lte]: cutoffDay },
      paymentMethod: { [Op.or]: [null, ""] },
    },
    limit: 50,
  });

  let sent = 0;
  for (const appt of candidates) {
    if (alreadySent(appt, "overduePayment")) continue;
    const result = await sendForAppointment({
      usersId,
      appointment: appt,
      type: "overduePayment",
      templateBody: config.templateBody,
    });
    if (result.sent) sent += 1;
  }
  return { type: "overduePayment", processed: candidates.length, sent };
}

const RUNNERS = {
  confirmation: runConfirmation,
  reminder: runReminder,
  ready: runReady,
  return: runReturn,
  overduePayment: runOverduePayment,
};

export async function runAutomationsForUser(usersId) {
  const settings = await Settings.findOne({ where: { usersId } });
  if (!settings) return { skipped: "no_settings" };

  const config = mergeAutomationsConfig(settings.crmAutomations);
  if (!config.enabled) return { skipped: "automations_disabled" };

  // Checa se o plano do usuario permite automacoes
  const automationCheck = await checkLimit(usersId, "automationsEnabled");
  if (!automationCheck.allowed) {
    return { skipped: "plan_no_automations", planKey: automationCheck.planKey };
  }

  // Checa limite mensal de mensagens — se ja excedido, nem roda
  const msgCheck = await checkLimit(usersId, "messagesPerMonth");
  if (!msgCheck.allowed) {
    return { skipped: "plan_message_limit", ...msgCheck };
  }

  const results = [];
  for (const type of AUTOMATION_TYPES) {
    try {
      const result = await RUNNERS[type]({ usersId, config: config[type] });
      results.push(result);
    } catch (error) {
      console.error(`[CrmAutomations] Erro em ${type} para user ${usersId}:`, error.message);
      results.push({ type, error: error.message });
    }
  }
  return { results };
}

export async function runAutomationsForAllUsers() {
  // Busca usuarios com crmAutomations.enabled = true
  const settingsList = await Settings.findAll({ limit: 500 });
  const enabled = settingsList.filter((s) => s?.crmAutomations?.enabled === true);
  for (const s of enabled) {
    try {
      await runAutomationsForUser(s.usersId);
    } catch (error) {
      console.error(`[CrmAutomations] Falha global user ${s.usersId}:`, error.message);
    }
  }
  return { totalUsers: enabled.length };
}
