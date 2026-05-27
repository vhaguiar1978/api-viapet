#!/usr/bin/env node
/**
 * READ-ONLY. Conta Finance pendente/atrasado com reference
 * "appointment_payment:<id>" cuja AppointmentPayment correspondente
 * já está paga (status="pago" OU paidAt definido).
 *
 * Esses são FANTASMAS COMPROVADOS: a parcela já foi paga, o Finance
 * ficou pendente por bug de sync. Distinguir de fiado.
 */
import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Finance from "../models/Finance.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import { setupAssociations } from "../models/associations.js";

dotenv.config();
setupAssociations();

const parsePaymentIdFromRef = (ref) => {
  const [p, id] = String(ref || "").trim().split(":");
  return p === "appointment_payment" && id ? id : null;
};

const finances = await Finance.findAll({
  where: {
    type: "entrada",
    status: { [Op.in]: ["pendente", "atrasado"] },
    reference: { [Op.like]: "appointment_payment:%" },
  },
  attributes: ["id", "reference", "status", "amount", "grossAmount", "usersId"],
});
console.log(`\nFinance "appointment_payment:*" pendente/atrasado: ${finances.length}`);

const paymentIds = [...new Set(finances.map((f) => parsePaymentIdFromRef(f.reference)).filter(Boolean))];
const payments = paymentIds.length
  ? await AppointmentPayment.findAll({
      where: { id: { [Op.in]: paymentIds } },
      attributes: ["id", "status", "paidAt", "appointmentId"],
    })
  : [];
const byId = new Map(payments.map((p) => [String(p.id), p]));
console.log(`AppointmentPayment encontrados: ${payments.length}`);

let fantasma = 0;
let fantasmaSum = 0;
let fiado = 0;
let fiadoSum = 0;
let semPayment = 0;
let semPaymentSum = 0;

for (const f of finances) {
  const pid = parsePaymentIdFromRef(f.reference);
  const p = pid ? byId.get(String(pid)) : null;
  const valor = Number(f.grossAmount || f.amount || 0);
  if (!p) {
    semPayment += 1;
    semPaymentSum += valor;
    continue;
  }
  const status = String(p.status || "").toLowerCase();
  if (status === "pago" || p.paidAt) {
    fantasma += 1;
    fantasmaSum += valor;
  } else {
    fiado += 1;
    fiadoSum += valor;
  }
}

console.log("\nClassificação:");
console.log(`  FANTASMA (parcela já paga, Finance ficou pendente)  ${String(fantasma).padStart(4)}  R$ ${fantasmaSum.toFixed(2)}  ← Fix 4 refinado vai esconder`);
console.log(`  FIADO   (parcela pendente, cliente deve mesmo)      ${String(fiado).padStart(4)}  R$ ${fiadoSum.toFixed(2)}  ← Fix 4 refinado mantém`);
console.log(`  SEM PAYMENT (órfão)                                 ${String(semPayment).padStart(4)}  R$ ${semPaymentSum.toFixed(2)}  ← Fix 4 refinado mantém`);

await sequelize.close();
