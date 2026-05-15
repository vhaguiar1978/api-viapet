// Algoritmo de conciliação: dado um BankStatementEntry, encontra o melhor candidato
// entre Finance (pendentes) e AppointmentPayment (pendentes) com score de confiança.
// Faixas de confiança:
//   >= 0.85 → match automático
//   0.55–0.85 → sugestão (precisa confirmação)
//   < 0.55  → pendente manual

import { Op } from "sequelize";
import Finance from "../models/Finance.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Custumers from "../models/Custumers.js";
import { helpers } from "./bankStatementParser.js";

const { STRIP_DIACRITICS } = helpers;

const AUTO_THRESHOLD = 0.85;
const SUGGEST_THRESHOLD = 0.55;
const AMOUNT_TOLERANCE = 0.01; // 1 centavo
const DATE_WINDOW_DAYS = 5;

function dateDiffDays(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs((da.getTime() - db.getTime()) / 86400000);
}

function tokenize(s) {
  return STRIP_DIACRITICS(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  return intersect / Math.max(ta.size, tb.size);
}

// Calcula o score de match entre uma entry e um candidato
// Pesos: amount=0.45, date=0.20, name=0.20, document=0.10, method=0.05
function scoreMatch(entry, candidate) {
  let score = 0;
  const breakdown = {};

  // Valor
  const amountDiff = Math.abs(Number(entry.amount) - Number(candidate.amount || candidate.grossAmount || 0));
  if (amountDiff <= AMOUNT_TOLERANCE) {
    score += 0.45;
    breakdown.amount = "exato";
  } else if (amountDiff <= 0.5) {
    score += 0.30;
    breakdown.amount = "proximo";
  }

  // Data
  const days = dateDiffDays(entry.entryDate, candidate.dueDate || candidate.date);
  if (days <= 1) {
    score += 0.20;
    breakdown.date = `+${days.toFixed(0)}d`;
  } else if (days <= DATE_WINDOW_DAYS) {
    score += 0.10;
    breakdown.date = `+${days.toFixed(0)}d`;
  }

  // Nome (entry.payerName vs customer name)
  const customerName = candidate.customerName || candidate.vendor || "";
  if (customerName && entry.payerName) {
    const sim = nameSimilarity(entry.payerName, customerName);
    if (sim >= 0.7) {
      score += 0.20;
      breakdown.name = "exato";
    } else if (sim >= 0.4) {
      score += 0.12;
      breakdown.name = "parcial";
    } else if (sim > 0) {
      score += 0.05;
      breakdown.name = "fraco";
    }
  }

  // Documento (CPF/CNPJ)
  if (entry.payerDocument && candidate.customerDocument) {
    const a = String(entry.payerDocument).replace(/\D/g, "");
    const b = String(candidate.customerDocument).replace(/\D/g, "");
    if (a && b && a === b) {
      score += 0.10;
      breakdown.document = "exato";
    }
  }

  // Forma de pagamento
  if (entry.paymentMethodHint && candidate.paymentMethod) {
    const a = STRIP_DIACRITICS(entry.paymentMethodHint);
    const b = STRIP_DIACRITICS(candidate.paymentMethod);
    if (a && b && (a.includes(b) || b.includes(a))) {
      score += 0.05;
      breakdown.method = "ok";
    }
  }

  return { score: Math.min(1, Number(score.toFixed(3))), breakdown };
}

// Carrega candidatos elegíveis (pendentes, com data próxima)
async function loadCandidates({ usersId, entry }) {
  const baseDate = new Date(entry.entryDate);
  const minDate = new Date(baseDate);
  minDate.setDate(minDate.getDate() - DATE_WINDOW_DAYS);
  const maxDate = new Date(baseDate);
  maxDate.setDate(maxDate.getDate() + DATE_WINDOW_DAYS);

  // Finance pendentes (tanto entrada quanto saída — entry direction filtra)
  const expectedFinanceType = entry.direction === "credit" ? "entrada" : "saida";
  const financeRows = await Finance.findAll({
    where: {
      usersId,
      type: expectedFinanceType,
      status: { [Op.in]: ["pendente", "atrasado"] },
      [Op.or]: [
        { dueDate: { [Op.between]: [minDate, maxDate] } },
        { date: { [Op.between]: [minDate, maxDate] } },
      ],
    },
    limit: 100,
  });

  // AppointmentPayment pendentes (sempre credit)
  let paymentRows = [];
  if (entry.direction === "credit") {
    paymentRows = await AppointmentPayment.findAll({
      where: {
        usersId,
        status: "pendente",
        dueDate: { [Op.between]: [minDate, maxDate] },
      },
      limit: 100,
    });

    // Enriquece com nome do cliente via Appointment → Custumers (best effort)
    if (paymentRows.length > 0) {
      try {
        const ids = paymentRows.map((p) => p.appointmentId).filter(Boolean);
        if (ids.length > 0) {
          const { default: Appointment } = await import("../models/Appointment.js");
          const apps = await Appointment.findAll({ where: { id: { [Op.in]: ids } } });
          const customerIds = apps.map((a) => a.customerId).filter(Boolean);
          const customers = customerIds.length
            ? await Custumers.findAll({ where: { id: { [Op.in]: customerIds } } })
            : [];
          const customerById = new Map(customers.map((c) => [String(c.id), c]));
          const appById = new Map(apps.map((a) => [String(a.id), a]));
          paymentRows = paymentRows.map((p) => {
            const ap = appById.get(String(p.appointmentId));
            const cust = ap ? customerById.get(String(ap.customerId)) : null;
            p.dataValues.customerName = cust?.name || null;
            p.dataValues.customerDocument = cust?.cpf || cust?.document || null;
            return p;
          });
        }
      } catch (err) {
        console.warn("Falha ao enriquecer payments com customer:", err?.message);
      }
    }
  }

  return [
    ...financeRows.map((r) => ({
      kind: "finance",
      id: r.id,
      amount: r.amount,
      grossAmount: r.grossAmount,
      dueDate: r.dueDate,
      date: r.date,
      customerName: r.vendor || null,
      customerDocument: null,
      paymentMethod: r.paymentMethod,
      bankAccountId: r.bankAccountId,
    })),
    ...paymentRows.map((r) => ({
      kind: "payment",
      id: r.id,
      amount: r.amount,
      grossAmount: r.grossAmount,
      dueDate: r.dueDate,
      date: r.dueDate,
      customerName: r.dataValues.customerName || null,
      customerDocument: r.dataValues.customerDocument || null,
      paymentMethod: r.paymentMethod,
      bankAccountId: r.bankAccountId,
    })),
  ];
}

// Decide status final: matched (auto), suggested ou pending
function classifyConfidence(score) {
  if (score >= AUTO_THRESHOLD) return "matched";
  if (score >= SUGGEST_THRESHOLD) return "suggested";
  return "pending";
}

export async function findBestMatch({ usersId, entry }) {
  const candidates = await loadCandidates({ usersId, entry });
  if (candidates.length === 0) return null;

  let best = null;
  for (const c of candidates) {
    const { score, breakdown } = scoreMatch(entry, c);
    if (!best || score > best.score) {
      best = { candidate: c, score, breakdown };
    }
  }

  if (!best || best.score < SUGGEST_THRESHOLD) return null;
  return best;
}

// Executa o match para todas as entries de um statement
// Para cada entry pending, procura o melhor candidato e atualiza matchStatus
export async function reconcileStatement({ usersId, statementId, entries, autoBaixa = true }) {
  const results = { auto: 0, suggested: 0, pending: 0, errors: 0 };

  for (const entry of entries) {
    if (entry.matchStatus && entry.matchStatus !== "pending") continue;

    try {
      const best = await findBestMatch({ usersId, entry });
      if (!best) {
        results.pending++;
        continue;
      }

      const status = classifyConfidence(best.score);
      const updates = {
        matchConfidence: best.score,
      };

      if (status === "matched" && autoBaixa) {
        updates.matchStatus = "matched";
        updates.matchSource = "auto";
        updates.matchedAt = new Date();
        if (best.candidate.kind === "finance") {
          updates.matchedFinanceId = best.candidate.id;
        } else {
          updates.matchedPaymentId = best.candidate.id;
        }
        // Marca o finance/payment como pago
        await applyBaixa({
          usersId,
          candidate: best.candidate,
          entry,
          confidence: best.score,
          source: "auto",
          createdBy: null,
        });
        results.auto++;
      } else if (status === "matched" || status === "suggested") {
        updates.matchStatus = "suggested";
        if (best.candidate.kind === "finance") {
          updates.matchedFinanceId = best.candidate.id;
        } else {
          updates.matchedPaymentId = best.candidate.id;
        }
        results.suggested++;
      } else {
        results.pending++;
      }

      await entry.update(updates);
    } catch (err) {
      console.error("Erro ao conciliar entry:", err?.message);
      results.errors++;
    }
  }

  return results;
}

// Aplica baixa em Finance ou AppointmentPayment
export async function applyBaixa({ usersId, candidate, entry, confidence, source, createdBy }) {
  const { default: ReconciliationMatch } = await import("../models/ReconciliationMatch.js");

  if (candidate.kind === "finance") {
    const row = await Finance.findOne({ where: { id: candidate.id, usersId } });
    if (!row) throw new Error("Finance não encontrado");
    await row.update({
      status: "pago",
      // Garante valores liquidos coerentes
      grossAmount: row.grossAmount || row.amount,
      netAmount: row.netAmount || row.amount,
    });
    await ReconciliationMatch.create({
      usersId,
      entryId: entry.id,
      bankAccountId: entry.bankAccountId,
      financeId: row.id,
      paymentId: null,
      confidence,
      source,
      grossAmount: row.grossAmount,
      feeAmount: row.feeAmount,
      netAmount: row.netAmount,
      notes: `Baixa via conciliação (${source})`,
      createdBy,
    });
    return { kind: "finance", id: row.id };
  }

  if (candidate.kind === "payment") {
    const row = await AppointmentPayment.findOne({ where: { id: candidate.id, usersId } });
    if (!row) throw new Error("AppointmentPayment não encontrado");
    await row.update({
      status: "pago",
      paidAt: new Date(),
    });
    await ReconciliationMatch.create({
      usersId,
      entryId: entry.id,
      bankAccountId: entry.bankAccountId,
      financeId: null,
      paymentId: row.id,
      confidence,
      source,
      grossAmount: row.grossAmount,
      feeAmount: row.feeAmount,
      netAmount: row.netAmount,
      notes: `Baixa via conciliação (${source})`,
      createdBy,
    });
    return { kind: "payment", id: row.id };
  }

  throw new Error(`kind desconhecido: ${candidate.kind}`);
}

export const RECONCILIATION_CONSTANTS = {
  AUTO_THRESHOLD,
  SUGGEST_THRESHOLD,
  AMOUNT_TOLERANCE,
  DATE_WINDOW_DAYS,
};
