#!/usr/bin/env node
// READ-ONLY. Conta appointments que têm múltiplas linhas
// appointment_balance pendentes. Cada appointment deveria ter apenas 1
// balance — múltiplos é bug de sync.
import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Finance from "../models/Finance.js";
import { setupAssociations } from "../models/associations.js";

dotenv.config();
setupAssociations();

const finances = await Finance.findAll({
  where: {
    type: "entrada",
    status: { [Op.in]: ["pendente", "atrasado"] },
    reference: { [Op.like]: "appointment_balance:%" },
  },
  attributes: ["id", "reference", "usersId", "grossAmount", "amount", "dueDate", "createdAt"],
  order: [["createdAt", "ASC"]],
});

console.log(`\nTotal appointment_balance pendente/atrasado em produção: ${finances.length}\n`);

const byApptId = new Map();
for (const f of finances) {
  const [, apptId] = String(f.reference).split(":");
  if (!apptId) continue;
  if (!byApptId.has(apptId)) byApptId.set(apptId, []);
  byApptId.get(apptId).push(f);
}

let multiCount = 0;
let multiSum = 0;
let multiSumExcess = 0; // somatório dos balances "a mais" (todos exceto 1 por appointment)
const examples = [];

for (const [apptId, lines] of byApptId.entries()) {
  if (lines.length > 1) {
    multiCount++;
    const totalLines = lines.reduce((s, l) => s + Number(l.grossAmount || l.amount || 0), 0);
    const maxLine = Math.max(...lines.map(l => Number(l.grossAmount || l.amount || 0)));
    multiSum += totalLines;
    multiSumExcess += totalLines - maxLine; // se mantivesse só o de maior valor
    if (examples.length < 5) {
      examples.push({ apptId, lines, totalLines, tenant: lines[0].usersId });
    }
  }
}

console.log(`Appointments com 1 balance: ${[...byApptId.values()].filter(l => l.length === 1).length}`);
console.log(`Appointments com >1 balance: ${multiCount}`);
console.log(`Soma total nesses ${multiCount} apontados: R$ ${multiSum.toFixed(2)}`);
console.log(`Excesso (se mantivesse apenas o maior por appointment): R$ ${multiSumExcess.toFixed(2)}\n`);

console.log("Exemplos:");
for (const ex of examples) {
  console.log(`  Appointment ${ex.apptId.slice(0,8)} (tenant ${ex.tenant.slice(0,8)})`);
  for (const l of ex.lines) {
    console.log(`    Fin ${l.id} | R$ ${Number(l.grossAmount||l.amount||0).toFixed(2).padStart(8)} | dueDate ${String(l.dueDate||"").slice(0,10)} | criado ${new Date(l.createdAt).toISOString().slice(0,16)}`);
  }
  console.log("");
}

await sequelize.close();
