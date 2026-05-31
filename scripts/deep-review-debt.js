#!/usr/bin/env node
/**
 * READ-ONLY. Revisão profunda do cálculo de devedores no tenant
 * Pet Shop Dog House (mesma do print do usuário).
 *
 * Investiga:
 * 1. Quantos appointments têm BOTH appointment_payment E appointment_balance
 *    pendentes — sinal forte de dupla contagem.
 * 2. Distribuição de valores por tipo de reference.
 * 3. Top 10 devedores com breakdown.
 */
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

const TENANT = "bfdd29c4-d790-43c6-bc2b-5b685b4c319a"; // Pet Shop Dog House (Juliana está aqui)

const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
console.log(`\n=== Deep review tenant ${TENANT} | hoje ${todayStr} ===\n`);

const extractDateOnly = (v) => {
  if (!v) return "";
  const r = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(r)) return r.slice(0,10);
  const p = new Date(r);
  return Number.isNaN(p.getTime()) ? "" : p.toISOString().slice(0,10);
};
const parsePid = (r) => { const [p,id]=String(r||"").split(":"); return p==="appointment_payment"&&id?id:null; };
const parseAid = (r) => { const [p,id]=String(r||"").split(":"); return (p==="appointment_balance"||p==="appointment_free")&&id?id:null; };
const refKind = (r) => {
  const s = String(r||"").toLowerCase();
  if (s === "appointment") return "appointment(legacy)";
  if (s.startsWith("appointment_payment:")) return "appointment_payment";
  if (s.startsWith("appointment_balance:")) return "appointment_balance";
  if (s.startsWith("appointment_free:")) return "appointment_free";
  return "outro";
};

// Pega TODOS Finance pendente/atrasado do tenant
const finances = await Finance.findAll({
  where: { usersId: TENANT, type:"entrada", status:{[Op.in]:["pendente","atrasado"]} },
  attributes: ["id","reference","description","status","amount","grossAmount","dueDate"],
});
console.log(`Total Finance pendente/atrasado: ${finances.length}`);

// Filtro 1: passar pelo Fix 5 (só dueDate <= hoje)
const validFinances = finances.filter((f) => {
  const dd = extractDateOnly(f.dueDate);
  if (!dd) return true;
  return dd <= todayStr;
});
console.log(`Após Fix 5 (dueDate <= hoje): ${validFinances.length}`);

// Resolver appointment de cada Finance
const pids = [...new Set(validFinances.map(f=>parsePid(f.reference)).filter(Boolean))];
const pays = pids.length ? await AppointmentPayment.findAll({where:{id:{[Op.in]:pids}},attributes:["id","appointmentId","status","paidAt"]}) : [];
const payById = new Map(pays.map(p=>[String(p.id),p]));
const aids = [...new Set([...validFinances.map(f=>parseAid(f.reference)).filter(Boolean), ...pays.map(p=>String(p.appointmentId))])];
const appts = aids.length ? await Appointment.findAll({where:{id:{[Op.in]:aids}},attributes:["id","customerId","date","status"]}) : [];
const apptById = new Map(appts.map(a=>[String(a.id),a]));

const customers = await Custumers.findAll({where:{usersId:TENANT},attributes:["id","name"]});
const custById = new Map(customers.map(c=>[String(c.id), c.name]));

// Para cada finance, encontrar appointmentId e customerId
const enriched = [];
for (const f of validFinances) {
  let apptId = null;
  let custId = null;
  const pid = parsePid(f.reference);
  if (pid) {
    const p = payById.get(String(pid));
    if (p) {
      // Aplica anti-fantasma: se parcela já está paga, ignora.
      if (String(p.status||"").toLowerCase()==="pago" || p.paidAt) continue;
      apptId = String(p.appointmentId);
    }
  }
  if (!apptId) {
    const aid = parseAid(f.reference);
    if (aid) apptId = aid;
  }
  if (apptId) {
    const a = apptById.get(apptId);
    if (a) custId = String(a.customerId);
  }
  enriched.push({ ...f.dataValues, apptId, custId, kind: refKind(f.reference), valor: Number(f.grossAmount || f.amount || 0) });
}

console.log(`Após anti-fantasma: ${enriched.length}\n`);

// PADRÃO 1: appointment_payment + appointment_balance no MESMO appointment?
const byAppt = new Map();
for (const e of enriched) {
  if (!e.apptId) continue;
  if (!byAppt.has(e.apptId)) byAppt.set(e.apptId, { types: new Set(), lines: 0, sum: 0, custId: e.custId });
  const v = byAppt.get(e.apptId);
  v.types.add(e.kind);
  v.lines += 1;
  v.sum += e.valor;
}
let apptsComMultiTipo = 0;
let apptsComMultiTipoSum = 0;
const multiTipoExamples = [];
for (const [apptId, v] of byAppt.entries()) {
  if (v.types.size > 1) {
    apptsComMultiTipo += 1;
    apptsComMultiTipoSum += v.sum;
    if (multiTipoExamples.length < 5) multiTipoExamples.push({ apptId, types: [...v.types], lines: v.lines, sum: v.sum, custId: v.custId });
  }
}
console.log(`Appointments com MAIS DE UM tipo de Finance pendente: ${apptsComMultiTipo}`);
console.log(`Soma total nesses appointments (potencial dupla contagem): R$ ${apptsComMultiTipoSum.toFixed(2)}\n`);
console.log("Exemplos:");
for (const ex of multiTipoExamples) {
  console.log(`  appt ${ex.apptId.slice(0,8)} | ${ex.lines} linhas | tipos=[${ex.types.join(",")}] | R$ ${ex.sum.toFixed(2)} | cliente ${custById.get(ex.custId)||ex.custId}`);
}

// PADRÃO 2: distribuição por tipo
console.log("\nDistribuição por tipo:");
const byKind = new Map();
for (const e of enriched) {
  const k = e.kind;
  if (!byKind.has(k)) byKind.set(k, { lines: 0, sum: 0 });
  const v = byKind.get(k);
  v.lines += 1;
  v.sum += e.valor;
}
for (const [k, v] of byKind.entries()) {
  console.log(`  ${k.padEnd(22)} ${String(v.lines).padStart(4)} linhas   R$ ${v.sum.toFixed(2).padStart(10)}`);
}

// PADRÃO 3: top devedores
const byCust = new Map();
for (const e of enriched) {
  if (!e.custId) continue;
  if (!byCust.has(e.custId)) byCust.set(e.custId, { lines: 0, sum: 0 });
  const v = byCust.get(e.custId);
  v.lines += 1;
  v.sum += e.valor;
}
const ranked = [...byCust.entries()].sort((a,b)=>b[1].sum-a[1].sum).slice(0,10);
console.log("\nTop 10 devedores (já com Fix 5 + anti-fantasma):");
for (const [cid, v] of ranked) {
  console.log(`  ${(custById.get(cid)||cid).padEnd(40)} ${String(v.lines).padStart(3)} linhas   R$ ${v.sum.toFixed(2).padStart(10)}`);
}
const totalGeral = enriched.reduce((s,e)=>s+e.valor,0);
console.log(`\nTOTAL geral devedores: ${byCust.size} pessoas / R$ ${totalGeral.toFixed(2)}`);

await sequelize.close();
