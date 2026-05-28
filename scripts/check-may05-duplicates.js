#!/usr/bin/env node
// READ-ONLY. Investiga as 4 linhas de 05/05 da Juliana: mesmas linhas
// apontam pro mesmo appointmentId?
import dotenv from "dotenv";
import sequelize from "../database/config.js";
import Finance from "../models/Finance.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Appointment from "../models/Appointment.js";
import { setupAssociations } from "../models/associations.js";

dotenv.config();
setupAssociations();

const finIds = [2534, 2538, 2541, 2543];
const finances = await Finance.findAll({ where: { id: finIds }, raw: true });

for (const f of finances) {
  const [prefix, paymentId] = String(f.reference || "").split(":");
  const payment = paymentId ? await AppointmentPayment.findByPk(paymentId, { raw: true }) : null;
  const appointment = payment ? await Appointment.findByPk(payment.appointmentId, { attributes: ["id","date","status","petId"], raw: true }) : null;
  console.log(`Finance ${f.id}`);
  console.log(`  reference     : ${f.reference}`);
  console.log(`  grossAmount   : ${f.grossAmount}`);
  console.log(`  dueDate       : ${f.dueDate}`);
  console.log(`  createdAt     : ${f.createdAt}`);
  console.log(`  Payment.id    : ${payment?.id}`);
  console.log(`  Payment.appt  : ${payment?.appointmentId}`);
  console.log(`  Payment.status: ${payment?.status}`);
  console.log(`  Payment.gross : ${payment?.grossAmount}`);
  console.log(`  Appt.date     : ${appointment?.date}  petId=${appointment?.petId}  status=${appointment?.status}`);
  console.log("");
}
await sequelize.close();
