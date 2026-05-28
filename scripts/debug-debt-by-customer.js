#!/usr/bin/env node
/**
 * READ-ONLY. Mostra TODAS as linhas Finance pendente/atrasado de um
 * cliente específico, com detalhes do appointment/sale ligado, para
 * entender por que o total dele está sendo somado X.
 *
 * USO:
 *   node scripts/debug-debt-by-customer.js "Juliana Cristina"
 *   node scripts/debug-debt-by-customer.js "Vilma"
 */
import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Finance from "../models/Finance.js";
import Custumers from "../models/Custumers.js";
import Appointment from "../models/Appointment.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Sales from "../models/Sales.js";
import { setupAssociations } from "../models/associations.js";

dotenv.config();
setupAssociations();

const nameArg = process.argv[2];
if (!nameArg) {
  console.error("uso: node scripts/debug-debt-by-customer.js \"<nome>\"");
  process.exit(1);
}

const customers = await Custumers.findAll({
  where: { name: { [Op.iLike]: `%${nameArg}%` } },
  attributes: ["id", "name", "usersId"],
});
console.log(`\nClientes que casam "${nameArg}": ${customers.length}`);
for (const c of customers) console.log(`  ${c.id}  ${c.name}  (tenant ${c.usersId})`);

if (!customers.length) { await sequelize.close(); process.exit(0); }

for (const customer of customers) {
const usersId = customer.usersId;
console.log(`\n→ Analisando cliente ${customer.name} (${customer.id}) tenant ${usersId}\n`);

const parseApptPaymentId = (ref) => {
  const [p, id] = String(ref || "").split(":");
  return p === "appointment_payment" && id ? id : null;
};
const parseApptId = (ref) => {
  const [p, id] = String(ref || "").split(":");
  return (p === "appointment_balance" || p === "appointment_free") && id ? id : null;
};

// 1) Todos os Finance pendente/atrasado do tenant
const finances = await Finance.findAll({
  where: {
    usersId,
    type: "entrada",
    status: { [Op.in]: ["pendente", "atrasado"] },
  },
  attributes: ["id", "reference", "description", "category", "status", "amount", "grossAmount", "dueDate", "date", "createdAt"],
});

// 2) Resolver cliente de cada Finance
const apptPaymentIds = [...new Set(finances.map((f) => parseApptPaymentId(f.reference)).filter(Boolean))];
const apptIdsFromRef = [...new Set(finances.map((f) => parseApptId(f.reference)).filter(Boolean))];
const payments = apptPaymentIds.length
  ? await AppointmentPayment.findAll({ where: { id: { [Op.in]: apptPaymentIds } }, attributes: ["id", "appointmentId", "status", "paidAt", "grossAmount"] })
  : [];
const paymentById = new Map(payments.map((p) => [String(p.id), p]));
const allApptIds = [...new Set([...apptIdsFromRef, ...payments.map((p) => String(p.appointmentId)).filter(Boolean)])];
const appts = allApptIds.length
  ? await Appointment.findAll({ where: { id: { [Op.in]: allApptIds } }, attributes: ["id", "status", "date", "customerId"] })
  : [];
const apptById = new Map(appts.map((a) => [String(a.id), a]));

const sales = await Sales.findAll({ where: { usersId, custumerId: customer.id }, attributes: ["id"] });
const saleIds = new Set(sales.map((s) => String(s.id)));

let total = 0;
const rows = [];
for (const f of finances) {
  let custId = null;
  let kind = "?";
  let apptStatus = null;
  let pStatus = null;
  let pPaidAt = null;
  const pid = parseApptPaymentId(f.reference);
  if (pid) {
    kind = "appt_payment";
    const p = paymentById.get(String(pid));
    if (p) {
      pStatus = p.status;
      pPaidAt = p.paidAt;
      const appt = apptById.get(String(p.appointmentId));
      if (appt) { custId = String(appt.customerId); apptStatus = appt.status; }
    }
  }
  if (!custId) {
    const aid = parseApptId(f.reference);
    if (aid) {
      kind = String(f.reference).split(":")[0];
      const appt = apptById.get(String(aid));
      if (appt) { custId = String(appt.customerId); apptStatus = appt.status; }
    }
  }
  if (!custId && saleIds.has(String(f.reference))) {
    kind = "sale";
    custId = String(customer.id);
  }
  if (custId !== String(customer.id)) continue;
  const valor = Number(f.grossAmount || f.amount || 0);
  total += valor;
  rows.push({ id: f.id, kind, ref: f.reference, valor, dueDate: f.dueDate, status: f.status, apptStatus, pStatus, pPaidAt, desc: f.description });
}

console.log(`Total ${rows.length} linhas pendente/atrasado somando R$ ${total.toFixed(2)}\n`);
console.log("FinId  | Tipo            | Status  | Dia        | Appt Status | Parcela Status | Valor    | Descrição / Ref");
console.log("-------|-----------------|---------|------------|-------------|----------------|----------|---------------------");
for (const r of rows.sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)))) {
  console.log(
    `${String(r.id).padEnd(7)}| ${String(r.kind).padEnd(16)}| ${String(r.status).padEnd(8)}| ${String(r.dueDate||"").slice(0,10).padEnd(11)}| ${String(r.apptStatus||"-").padEnd(12)}| ${String(r.pStatus||"-").padEnd(15)}| R$ ${String(r.valor.toFixed(2)).padStart(7)}| ${String(r.desc||r.ref).slice(0,40)}`
  );
}
} // end for customers

await sequelize.close();
