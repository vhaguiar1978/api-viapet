#!/usr/bin/env node

/**
 * diagnose-debt-agenda-fantasmas.js
 *
 * READ-ONLY. Diagnóstico para identificar Finance de agendamento que
 * estão pendente/atrasado mas cujo Appointment correspondente já não
 * deveria estar gerando dívida (Concluído com paymentMethod definido,
 * Cancelado, ou inexistente).
 *
 * USO:
 *   node scripts/diagnose-debt-agenda-fantasmas.js
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Finance from "../models/Finance.js";
import Appointment from "../models/Appointment.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import { setupAssociations } from "../models/associations.js";

dotenv.config();
setupAssociations();

function parseAppointmentIdFromRef(reference) {
  const raw = String(reference || "").trim();
  const [prefix, id] = raw.split(":");
  if ((prefix === "appointment_balance" || prefix === "appointment_free" || prefix === "appointment_payment") && id) {
    return { kind: prefix, id };
  }
  return null;
}

async function main() {
  console.log("\n=== diagnose-debt-agenda-fantasmas (READ-ONLY) ===\n");

  // 1) Todos os Finance de agendamento pendente/atrasado.
  const finances = await Finance.findAll({
    where: {
      type: "entrada",
      status: { [Op.in]: ["pendente", "atrasado"] },
      [Op.or]: [
        { reference: "appointment" },
        { reference: { [Op.like]: "appointment_payment:%" } },
        { reference: { [Op.like]: "appointment_balance:%" } },
        { reference: { [Op.like]: "appointment_free:%" } },
        { category: { [Op.iLike]: "%agendamento%" } },
      ],
    },
    attributes: ["id", "reference", "description", "category", "subCategory", "status", "amount", "grossAmount", "dueDate", "date", "usersId", "createdAt"],
  });
  console.log(`Finance de agendamento pendente/atrasado: ${finances.length}`);

  // 2) Map de Finance → AppointmentPayment (link forte via financeId).
  const financeIds = finances.map((f) => f.id);
  const payments = financeIds.length
    ? await AppointmentPayment.findAll({
        where: { financeId: { [Op.in]: financeIds } },
        attributes: ["id", "financeId", "appointmentId", "status", "dueDate", "grossAmount"],
      })
    : [];
  const paymentByFinanceId = new Map(payments.map((p) => [Number(p.financeId), p]));

  // 3) Para Finance sem AppointmentPayment, tenta extrair appointmentId da reference.
  const appointmentIdsFromRefs = new Set();
  for (const f of finances) {
    const parsed = parseAppointmentIdFromRef(f.reference);
    if (parsed?.id) appointmentIdsFromRefs.add(parsed.id);
  }
  for (const p of payments) if (p.appointmentId) appointmentIdsFromRefs.add(String(p.appointmentId));

  // 4) Busca os Appointments referenciados.
  const appointments = appointmentIdsFromRefs.size
    ? await Appointment.findAll({
        where: { id: { [Op.in]: [...appointmentIdsFromRefs] } },
        attributes: ["id", "status", "date", "customerId", "usersId"],
      })
    : [];
  const apptById = new Map(appointments.map((a) => [String(a.id), a]));

  // 5) Classifica cada Finance.
  const buckets = {
    healthy: [],        // appointment existe e status sugere dívida real
    apptCancelado: [],  // appointment status = "Cancelado"
    apptConcluido: [],  // appointment status indica concluído (Concluido/Pronto/Finalizado/Entregue/Pago)
    apptInexistente: [], // appointment referenciado não existe mais
    semAppointment: [],  // não conseguimos ligar a appointment nenhum
  };

  const CONCLUIDO_RE = /(conclu[ií]do|pronto|finalizado|entregue|pago)/i;
  const CANCELADO_RE = /cancelad/i;

  for (const f of finances) {
    const payment = paymentByFinanceId.get(Number(f.id));
    let appointmentId = payment?.appointmentId ? String(payment.appointmentId) : null;
    if (!appointmentId) {
      const parsed = parseAppointmentIdFromRef(f.reference);
      if (parsed?.id) appointmentId = parsed.id;
    }
    if (!appointmentId) {
      buckets.semAppointment.push(f);
      continue;
    }
    const appt = apptById.get(appointmentId);
    if (!appt) {
      buckets.apptInexistente.push({ finance: f, appointmentId });
      continue;
    }
    const status = String(appt.status || "");
    if (CANCELADO_RE.test(status)) {
      buckets.apptCancelado.push({ finance: f, appointment: appt });
    } else if (CONCLUIDO_RE.test(status)) {
      buckets.apptConcluido.push({ finance: f, appointment: appt });
    } else {
      buckets.healthy.push({ finance: f, appointment: appt });
    }
  }

  const summarize = (label, arr) => {
    const sum = arr.reduce((s, x) => {
      const fin = x.finance || x;
      return s + Number(fin.grossAmount || fin.amount || 0);
    }, 0);
    console.log(`  ${label.padEnd(22)} ${String(arr.length).padStart(5)} linhas   R$ ${sum.toFixed(2)}`);
  };

  console.log("\nClassificação:");
  summarize("healthy (deve real)", buckets.healthy);
  summarize("appt CANCELADO",       buckets.apptCancelado);
  summarize("appt CONCLUÍDO",       buckets.apptConcluido);
  summarize("appt INEXISTENTE",     buckets.apptInexistente);
  summarize("sem appointment link", buckets.semAppointment);

  // 6) Relatório detalhado.
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `debt-agenda-fantasmas-${stamp}.json`);

  const serialize = (arr) =>
    arr.slice(0, 200).map((x) => {
      const fin = x.finance || x;
      const appt = x.appointment || null;
      return {
        financeId: fin.id,
        reference: fin.reference,
        description: fin.description,
        category: fin.category,
        status: fin.status,
        amount: fin.amount,
        grossAmount: fin.grossAmount,
        dueDate: fin.dueDate,
        usersId: fin.usersId,
        appointmentId: x.appointmentId || appt?.id || null,
        appointmentStatus: appt?.status || null,
        appointmentDate: appt?.date || null,
        customerId: appt?.customerId || null,
      };
    });

  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totals: {
          finances: finances.length,
          healthy: buckets.healthy.length,
          apptCancelado: buckets.apptCancelado.length,
          apptConcluido: buckets.apptConcluido.length,
          apptInexistente: buckets.apptInexistente.length,
          semAppointment: buckets.semAppointment.length,
        },
        samples: {
          apptCancelado: serialize(buckets.apptCancelado),
          apptConcluido: serialize(buckets.apptConcluido),
          apptInexistente: serialize(buckets.apptInexistente),
          semAppointment: serialize(buckets.semAppointment),
        },
      },
      null,
      2,
    ),
  );
  console.log(`\nRelatório: ${reportPath}`);

  await sequelize.close();
  console.log("\n=== concluído ===\n");
}

main().catch(async (err) => {
  console.error("ERRO:", err);
  try { await sequelize.close(); } catch (_) {}
  process.exit(1);
});
