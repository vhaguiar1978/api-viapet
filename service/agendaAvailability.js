// Disponibilidade de horarios na agenda — usada pela IA do WhatsApp pra
// propor horarios REAIS livres ao cliente (em vez de inventar ou perguntar
// "qual horario voce prefere?"). Le openingTime/closingTime/break do Settings,
// respeita allowedDays/allowedTimeStart/End/slotMinutes/minimumLeadMinutes
// do aiControl.scheduling, e remove os slots ja ocupados em Appointment.

import { Op } from "sequelize";
import Appointment from "../models/Appointment.js";

const WEEK_DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = String(timeStr).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function toHHMM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Períodos do dia (ranges em minutos): manhã 5h–12h, tarde 12h–18h, noite 18h–23h.
const PERIOD_RANGES = {
  manha: [5 * 60, 12 * 60],
  tarde: [12 * 60, 18 * 60],
  noite: [18 * 60, 23 * 60],
};

/**
 * Retorna até `maxSlots` horários livres pra um dia/período, considerando:
 * - horário da loja (settings.openingTime/closingTime/break)
 * - regras da IA (aiControl.scheduling.allowedTimeStart/End/slotMinutes/minimumLeadMinutes/allowedDays/maxDailyAppointments)
 * - agendamentos já existentes (status != cancelado/concluído)
 *
 * @param {Object} opts
 * @param {string} opts.usersId
 * @param {string} opts.date     - YYYY-MM-DD
 * @param {"manha"|"tarde"|"noite"|null} [opts.period]
 * @param {string} [opts.type]   - "estetica" (default), "clinica", "internacao"
 * @param {Object} [opts.settings]
 * @param {Object} [opts.aiControl]
 * @param {number} [opts.maxSlots=6]
 * @returns {Promise<{slots: string[], reason?: string, dayLabel: string}>}
 */
export async function getAvailableSlots({
  usersId,
  date,
  period = null,
  type = "estetica",
  settings = {},
  aiControl = {},
  maxSlots = 6,
}) {
  if (!usersId || !date) {
    return { slots: [], reason: "missing_params", dayLabel: "" };
  }

  // 1) Dia da semana — checa allowedDays
  const dt = new Date(`${date}T12:00:00`); // meio-dia pra evitar boundary de timezone
  if (Number.isNaN(dt.getTime())) {
    return { slots: [], reason: "invalid_date", dayLabel: "" };
  }
  const dayKey = WEEK_DAY_KEYS[dt.getDay()];
  const allowedDays = Array.isArray(aiControl?.scheduling?.allowedDays)
    ? aiControl.scheduling.allowedDays
    : null;
  if (allowedDays && allowedDays.length > 0 && !allowedDays.includes(dayKey)) {
    return {
      slots: [],
      reason: "day_not_allowed",
      dayLabel: dt.toLocaleDateString("pt-BR", { weekday: "long" }),
    };
  }

  // 2) Range do dia (horário da loja, com override do aiControl)
  const aiStart = String(aiControl?.scheduling?.allowedTimeStart || "").trim();
  const aiEnd = String(aiControl?.scheduling?.allowedTimeEnd || "").trim();
  const startMin = toMinutes(aiStart || settings?.openingTime || "08:00") ?? 8 * 60;
  const endMin = toMinutes(aiEnd || settings?.closingTime || "18:00") ?? 18 * 60;

  // Break (almoço): se configurado, slots dentro desse range são pulados
  const breakStart = toMinutes(settings?.breakStartTime || "");
  const breakEnd = toMinutes(settings?.breakEndTime || "");
  const hasBreak = breakStart !== null && breakEnd !== null && breakEnd > breakStart;

  // 3) Tamanho do slot (default 60min — banho/tosa típico)
  let slotSize = Number(aiControl?.scheduling?.slotMinutes || 0);
  if (!slotSize || slotSize < 10) slotSize = 60;

  // 4) Lead time mínimo (não propor horários muito próximos do agora pra hoje)
  const minLead = Number(aiControl?.scheduling?.minimumLeadMinutes || 30);
  const nowSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const todayIsoSp = nowSp.toISOString().slice(0, 10);
  const isToday = date === todayIsoSp;
  const nowMin = isToday ? nowSp.getHours() * 60 + nowSp.getMinutes() + minLead : -1;

  // 5) Limite diário (maxDailyAppointments) — se atingiu, retorna vazio
  const maxDaily = Number(aiControl?.scheduling?.maxDailyAppointments || 0);

  // 6) Filtro de período
  const [periodStart, periodEnd] = PERIOD_RANGES[period] || [0, 24 * 60];

  // 7) Busca todos os agendamentos do dia/tipo (não cancelados/concluídos)
  const existing = await Appointment.findAll({
    where: {
      usersId,
      date,
      type,
      status: { [Op.notIn]: ["cancelado", "Cancelado", "concluido", "Concluido", "Finalizado", "finalizado"] },
    },
    attributes: ["time"],
  }).catch(() => []);

  if (maxDaily > 0 && existing.length >= maxDaily) {
    return {
      slots: [],
      reason: "daily_limit_reached",
      dayLabel: dt.toLocaleDateString("pt-BR", { weekday: "long" }),
    };
  }

  const occupied = new Set(
    existing
      .map((a) => toMinutes(String(a.time || "").slice(0, 5)))
      .filter((m) => m !== null),
  );

  // 8) Gera os slots candidatos e filtra
  const slots = [];
  for (let t = startMin; t + slotSize <= endMin; t += slotSize) {
    // Pula período fora do solicitado
    if (t < periodStart || t >= periodEnd) continue;
    // Pula horário de almoço (qualquer overlap com break)
    if (hasBreak && t < breakEnd && t + slotSize > breakStart) continue;
    // Pula horário no passado (apenas pra hoje)
    if (nowMin >= 0 && t < nowMin) continue;
    // Pula horário já ocupado
    if (occupied.has(t)) continue;

    slots.push(toHHMM(t));
    if (slots.length >= maxSlots) break;
  }

  return {
    slots,
    dayLabel: dt.toLocaleDateString("pt-BR", { weekday: "long" }),
  };
}

const PT_WEEK_DAYS = {
  domingo: 0, segunda: 1, "segunda-feira": 1, terca: 2, "terca-feira": 2,
  "terça": 2, "terça-feira": 2, quarta: 3, "quarta-feira": 3, quinta: 4,
  "quinta-feira": 4, sexta: 5, "sexta-feira": 5, sabado: 6, "sábado": 6,
};

/**
 * Detecta na mensagem do cliente se ele está pedindo horário/disponibilidade
 * e tenta resolver para qual dia (hoje, amanhã, sábado, dia 15…) e período
 * (manhã/tarde/noite). Retorna null se não detectar intenção de horário.
 *
 * Conservador: só dispara busca de slots quando há sinal claro. Pra mensagens
 * vagas a IA segue o fluxo normal de perguntar manhã/tarde.
 *
 * @param {string} message
 * @returns {{date: string, period: ("manha"|"tarde"|"noite"|null)} | null}
 */
export function detectScheduleQuery(message) {
  const raw = String(message || "").toLowerCase();
  if (!raw || raw.length < 2) return null;

  // Normaliza acentos e pontuação leve
  const m = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.,;]/g, " ")
    .replace(/\s+/g, " ");

  // Palavras-chave que indicam pedido de horário/disponibilidade.
  // Lista intencionalmente AMPLA pra disparar o fluxo de slots/período em
  // qualquer mensagem que sinalize intenção de agendar — assim a IA SEMPRE
  // pode oferecer manhã/tarde com horários reais em vez de texto genérico.
  const SCHEDULE_KEYWORDS = [
    "horario", "horarios", "vaga", "vagas", "agenda", "agendar", "agendamento",
    "disponivel", "disponivelidade", "disponibilidade", "disponiveis",
    "marcar", "marca", "marca pra", "marca pro", "encaixe", "encaixar", "encaixa",
    "tem hoje", "tem amanha", "tem como", "consegue", "tem lugar",
    "quero agendar", "quero marcar", "queria marcar", "queria agendar",
    "posso marcar", "posso agendar", "da pra marcar", "da pra agendar",
    "banho", "tosa", "hidratacao", "pacotinho",
  ];
  const PERIOD_KEYWORDS = ["manha", "tarde", "noite", "manhazinha", "tardinha"];
  const DAY_KEYWORDS = [
    "hoje", "amanha", "depois de amanha", "domingo", "segunda", "terca",
    "quarta", "quinta", "sexta", "sabado",
  ];

  const hasSchedule = SCHEDULE_KEYWORDS.some((k) => m.includes(k));
  const periodHit = PERIOD_KEYWORDS.find((k) => new RegExp(`\\b${k}\\b`).test(m));
  const dayHit = DAY_KEYWORDS.find((k) => new RegExp(`\\b${k}\\b`).test(m));

  // Se não menciona horário/agenda nem período nem dia, ignora
  if (!hasSchedule && !periodHit && !dayHit) return null;

  // Resolve data
  const nowSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  // Default: se cliente não disse dia, usa AMANHÃ (não hoje) — evita propor
  // horários quase passados e dá uma resposta útil pra IA processar/oferecer.
  let targetDate = new Date(nowSp.getTime() + 86400000);
  let dateExplicit = false;

  if (m.includes("depois de amanha")) {
    targetDate = new Date(nowSp.getTime() + 2 * 86400000);
    dateExplicit = true;
  } else if (m.includes("amanha")) {
    targetDate = new Date(nowSp.getTime() + 86400000);
    dateExplicit = true;
  } else if (m.includes("hoje")) {
    targetDate = nowSp;
    dateExplicit = true;
  } else {
    // Dia da semana ("sabado", "segunda"…) → próximo dia que cair nesse weekday
    for (const [word, dow] of Object.entries(PT_WEEK_DAYS)) {
      if (new RegExp(`\\b${word}\\b`).test(m)) {
        const todayDow = nowSp.getDay();
        let delta = dow - todayDow;
        if (delta <= 0) delta += 7; // sempre próximo, não passado
        targetDate = new Date(nowSp.getTime() + delta * 86400000);
        dateExplicit = true;
        break;
      }
    }
  }

  // Período
  let period = null;
  if (periodHit) {
    if (periodHit.startsWith("manha")) period = "manha";
    else if (periodHit.startsWith("tarde")) period = "tarde";
    else period = "noite";
  }

  return {
    date: targetDate.toISOString().slice(0, 10),
    period,
    dateExplicit,
    periodExplicit: Boolean(periodHit),
  };
}
