#!/usr/bin/env node
// READ-ONLY. Simula chamada do GET /customers/:id/pending-finances
// localmente, sem subir o servidor, pra validar a resposta antes do deploy.
import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Finance from "../models/Finance.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Appointment from "../models/Appointment.js";
import Sales from "../models/Sales.js";
import Custumers from "../models/Custumers.js";
import { setupAssociations } from "../models/associations.js";

dotenv.config();
setupAssociations();

const TENANT = "bfdd29c4-d790-43c6-bc2b-5b685b4c319a";
const customer = await Custumers.findOne({
  where: { name: { [Op.iLike]: "%antonio martins%" }, usersId: TENANT },
  attributes: ["id"],
});

// Copia do handler do GET /customers/:id/pending-finances
const usersId = TENANT;
const customerId = String(customer.id);
const finances = await Finance.findAll({
  where: { usersId, type:"entrada", status:{[Op.in]:["pendente","atrasado"]} },
  attributes: ["id","reference","description","category","status","amount","grossAmount","dueDate","date"],
  order: [["dueDate","ASC"],["id","ASC"]],
});

const parsePid = (ref) => { const [p,id] = String(ref||"").split(":"); return p==="appointment_payment"&&id?id:null; };
const parseAid = (ref) => { const [p,id] = String(ref||"").split(":"); return (p==="appointment_balance"||p==="appointment_free")&&id?id:null; };

const paymentIds = [...new Set(finances.map(f=>parsePid(f.reference)).filter(Boolean))];
const payments = paymentIds.length ? await AppointmentPayment.findAll({where:{id:{[Op.in]:paymentIds}},attributes:["id","appointmentId","status","paidAt"]}):[];
const paymentById = new Map(payments.map(p=>[String(p.id),p]));

const apptIds = [...new Set([...finances.map(f=>parseAid(f.reference)).filter(Boolean), ...payments.map(p=>String(p.appointmentId))])];
const appts = apptIds.length ? await Appointment.findAll({where:{usersId,id:{[Op.in]:apptIds}},attributes:["id","customerId","date","status"]}):[];
const apptById = new Map(appts.map(a=>[String(a.id),a]));

const sales = await Sales.findAll({where:{usersId,custumerId:customerId},attributes:["id"]});
const saleIds = new Set(sales.map(s=>String(s.id)));

const todayStr = new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());
const extractDateOnly = (v) => { if(!v)return ""; const r=String(v); if(/^\d{4}-\d{2}-\d{2}/.test(r))return r.slice(0,10); const p=new Date(r); return Number.isNaN(p.getTime())?"":p.toISOString().slice(0,10); };

const items = [];
for (const f of finances) {
  let resolvedCustomerId = null, kind = "outro", appointmentId = null, appointmentDate = null, paymentRowId = null;
  const pid = parsePid(f.reference);
  if (pid) {
    const p = paymentById.get(String(pid));
    if (p) {
      if (String(p.status||"").toLowerCase()==="pago" || p.paidAt) continue;
      kind = "appointment_payment"; paymentRowId = String(p.id); appointmentId = String(p.appointmentId);
      const a = apptById.get(appointmentId);
      if (a) { resolvedCustomerId = String(a.customerId); appointmentDate = a.date; }
    }
  }
  if (!resolvedCustomerId) {
    const aid = parseAid(f.reference);
    if (aid) { appointmentId = aid; const a = apptById.get(aid); if (a) { kind = String(f.reference).split(":")[0]; resolvedCustomerId = String(a.customerId); appointmentDate = a.date; } }
  }
  if (!resolvedCustomerId && saleIds.has(String(f.reference))) { kind = "sale"; resolvedCustomerId = customerId; }
  if (resolvedCustomerId !== customerId) continue;
  const dueDateStr = extractDateOnly(f.dueDate);
  if (dueDateStr && dueDateStr > todayStr) continue;
  items.push({ financeId: f.id, kind, description: f.description, status: f.status, amount: Number(f.amount||0), grossAmount: Number(f.grossAmount||f.amount||0), dueDate: dueDateStr||extractDateOnly(f.date), appointmentId, appointmentDate, appointmentPaymentId: paymentRowId, saleId: kind==="sale"?String(f.reference):null });
}

const total = items.reduce((s,i)=>s+i.grossAmount,0);
console.log(`\n=== Pendências de antonio (${customerId}) ===`);
console.log(`Total: ${items.length} linhas / R$ ${total.toFixed(2)}\n`);
console.log("FinId | Tipo                | Data       | Valor    | Descrição");
console.log("------|---------------------|------------|----------|----------");
for (const it of items) {
  console.log(`${String(it.financeId).padEnd(6)}| ${it.kind.padEnd(20)}| ${String(it.dueDate).padEnd(11)}| R$ ${it.grossAmount.toFixed(2).padStart(7)}| ${String(it.description).slice(0,40)}`);
}
await sequelize.close();
