#!/usr/bin/env node
/**
 * READ-ONLY. Simula o cálculo do endpoint debt-summary já com os
 * Fix 5 (filtro de vencimento) e Fix 7 (dedup) aplicados, para uma
 * cliente específica. Útil pra confirmar impacto antes de deploy.
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
if (!nameArg) { console.error("uso: node ... \"<nome>\""); process.exit(1); }

const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
console.log(`\nHoje (America/Sao_Paulo): ${todayStr}\n`);

const extractDateOnly = (v) => {
  if (!v) return "";
  const r = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(r)) return r.slice(0,10);
  const p = new Date(r);
  return Number.isNaN(p.getTime()) ? "" : p.toISOString().slice(0,10);
};

const customers = await Custumers.findAll({ where: { name: { [Op.iLike]: `%${nameArg}%` } }, attributes: ["id","name","usersId"] });
for (const customer of customers) {
  console.log(`\n=== ${customer.name} (${customer.id}) tenant ${customer.usersId} ===`);

  const finances = await Finance.findAll({
    where: { usersId: customer.usersId, type: "entrada", status: { [Op.in]: ["pendente","atrasado"] } },
    attributes: ["id","reference","description","status","amount","grossAmount","dueDate","date"],
  });

  // Map ref→customer
  const parsePid = (r) => { const [p,id]=String(r||"").split(":"); return p==="appointment_payment"&&id?id:null; };
  const parseAid = (r) => { const [p,id]=String(r||"").split(":"); return (p==="appointment_balance"||p==="appointment_free")&&id?id:null; };
  const pIds = [...new Set(finances.map(f=>parsePid(f.reference)).filter(Boolean))];
  const pays = pIds.length ? await AppointmentPayment.findAll({ where: { id:{[Op.in]:pIds}}, attributes:["id","appointmentId","status","paidAt"] }) : [];
  const payById = new Map(pays.map(p=>[String(p.id),p]));
  const allAids = [...new Set([...finances.map(f=>parseAid(f.reference)).filter(Boolean), ...pays.map(p=>String(p.appointmentId))])];
  const appts = allAids.length ? await Appointment.findAll({ where:{ id:{[Op.in]:allAids}}, attributes:["id","customerId","status"] }) : [];
  const apptById = new Map(appts.map(a=>[String(a.id),a]));
  const sales = await Sales.findAll({ where:{ usersId: customer.usersId, custumerId: customer.id }, attributes:["id"] });
  const saleIds = new Set(sales.map(s=>String(s.id)));

  const seenKeys = new Set();
  let total = 0;
  let kept = 0;
  let skipFuture = 0;
  let skipDup = 0;
  let skipPaid = 0;
  let skipOtherCust = 0;

  for (const f of finances) {
    let custId = null;
    const pid = parsePid(f.reference);
    if (pid) {
      const p = payById.get(String(pid));
      if (p) {
        if (String(p.status||"").toLowerCase()==="pago" || p.paidAt) { skipPaid++; continue; }
        const a = apptById.get(String(p.appointmentId));
        if (a) custId = String(a.customerId);
      }
    }
    if (!custId) {
      const aid = parseAid(f.reference);
      if (aid) { const a = apptById.get(String(aid)); if (a) custId = String(a.customerId); }
    }
    if (!custId && saleIds.has(String(f.reference))) custId = String(customer.id);
    if (custId !== String(customer.id)) { skipOtherCust++; continue; }

    const dd = extractDateOnly(f.dueDate);
    if (dd && dd > todayStr) { skipFuture++; continue; }

    const key = `${String(f.reference||"").toLowerCase()}|${dd}|${Number(f.grossAmount||f.amount||0).toFixed(2)}`;
    if (seenKeys.has(key)) { skipDup++; continue; }
    seenKeys.add(key);

    total += Number(f.grossAmount||f.amount||0);
    kept++;
  }

  console.log(`  Mantém:        ${kept} linhas   R$ ${total.toFixed(2)}`);
  console.log(`  Skip futuro:   ${skipFuture}`);
  console.log(`  Skip duplicata:${skipDup}`);
  console.log(`  Skip parc.paga:${skipPaid}`);
}
await sequelize.close();
