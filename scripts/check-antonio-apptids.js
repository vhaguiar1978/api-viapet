#!/usr/bin/env node
// READ-ONLY. Para o antonio: agrupa as 32 linhas por appointmentId
// REAL (resolvido via Payment.appointmentId para appt_payment, ou via
// reference para balance). Se múltiplos finances pendentes apontam pro
// MESMO appointment, é dupla contagem.
import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Finance from "../models/Finance.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Appointment from "../models/Appointment.js";
import Custumers from "../models/Custumers.js";
import { setupAssociations } from "../models/associations.js";

dotenv.config();
setupAssociations();

const TENANT = "bfdd29c4-d790-43c6-bc2b-5b685b4c319a";
const customer = await Custumers.findOne({
  where: { name: { [Op.iLike]: "%antonio martins%" }, usersId: TENANT },
  attributes: ["id", "usersId"],
});
if (!customer) { console.error("antonio não encontrado no tenant"); process.exit(1); }
console.log(`Antonio id ${customer.id} no tenant ${customer.usersId}\n`);

const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
const extractDateOnly = (v) => {
  if (!v) return "";
  const r = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(r)) return r.slice(0,10);
  const p = new Date(r);
  return Number.isNaN(p.getTime()) ? "" : p.toISOString().slice(0,10);
};

const finances = await Finance.findAll({
  where: { usersId: customer.usersId, type:"entrada", status:{[Op.in]:["pendente","atrasado"]} },
  attributes: ["id","reference","grossAmount","amount","dueDate"],
});

const enriched = [];
const pids = [];
const aidsFromRef = [];
for (const f of finances) {
  const [p, id] = String(f.reference || "").split(":");
  if (p === "appointment_payment" && id) pids.push(id);
  if ((p === "appointment_balance" || p === "appointment_free") && id) aidsFromRef.push(id);
}
const payments = pids.length ? await AppointmentPayment.findAll({ where:{id:{[Op.in]:pids}}, attributes:["id","appointmentId","status","paidAt"]}) : [];
const paymentById = new Map(payments.map(p=>[String(p.id), p]));

const allAids = [...new Set([...aidsFromRef, ...payments.map(p=>String(p.appointmentId))])];
const appts = allAids.length ? await Appointment.findAll({ where:{ id:{[Op.in]:allAids}}, attributes:["id","customerId","date","petId","status","financeId"]}) : [];
const apptById = new Map(appts.map(a=>[String(a.id), a]));

for (const f of finances) {
  const [pref, id] = String(f.reference || "").split(":");
  let apptId = null;
  let kind = pref;
  if (pref === "appointment_payment" && id) {
    const p = paymentById.get(String(id));
    if (p) {
      if (String(p.status||"").toLowerCase()==="pago" || p.paidAt) continue;
      apptId = String(p.appointmentId);
    }
  } else if ((pref === "appointment_balance" || pref === "appointment_free") && id) {
    apptId = id;
  }
  const appt = apptId ? apptById.get(apptId) : null;
  if (!appt || String(appt.customerId) !== String(customer.id)) continue;
  const dd = extractDateOnly(f.dueDate);
  if (dd && dd > todayStr) continue;
  enriched.push({ finId: f.id, kind, apptId, apptDate: appt.date, apptStatus: appt.status, petId: appt.petId, valor: Number(f.grossAmount || f.amount || 0) });
}

// Agrupar por apptId
const byAppt = new Map();
for (const e of enriched) {
  if (!byAppt.has(e.apptId)) byAppt.set(e.apptId, []);
  byAppt.get(e.apptId).push(e);
}

console.log(`\n${enriched.length} finances pendentes do antonio (após Fix 5 e anti-fantasma)`);
console.log(`Agrupados em ${byAppt.size} appointments distintos\n`);

let multiCount = 0;
let multiSum = 0;
for (const [aid, lines] of byAppt.entries()) {
  if (lines.length > 1) {
    multiCount++;
    const lineSum = lines.reduce((s,l)=>s+l.valor,0);
    multiSum += lineSum;
    const types = [...new Set(lines.map(l=>l.kind))];
    const appt = apptById.get(aid);
    console.log(`Appointment ${aid.slice(0,8)} | data ${appt?.date} | pet ${String(appt?.petId).slice(0,6)} | status ${appt?.status}`);
    console.log(`  ${lines.length} finances pendentes (tipos: ${types.join(", ")}) somando R$ ${lineSum.toFixed(2)}`);
    for (const l of lines) {
      console.log(`    Fin ${l.finId} | ${l.kind.padEnd(20)} | R$ ${l.valor.toFixed(2).padStart(7)}`);
    }
    console.log("");
  }
}
console.log(`\n>>> ${multiCount} appointments com MAIS DE 1 finance pendente = R$ ${multiSum.toFixed(2)} (potencial dupla contagem)`);

await sequelize.close();
