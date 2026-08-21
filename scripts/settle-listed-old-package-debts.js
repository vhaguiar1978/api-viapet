#!/usr/bin/env node
/**
 * Baixa controlada de pendencias antigas de pacotinhos para uma lista revisada.
 *
 * Por padrao roda em dry-run. Use --apply para gravar.
 * Regra: quita apenas entradas de agenda vencidas antes do mes atual. Pendencias
 * do mes atual e futuras ficam abertas para evitar baixa indevida.
 */
import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Appointment from "../models/Appointment.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Custumers from "../models/Custumers.js";
import Finance from "../models/Finance.js";
import Pets from "../models/Pets.js";
import { setupAssociations } from "../models/associations.js";
import { syncAppointmentFinance } from "../service/appointmentFinance.js";

dotenv.config();
setupAssociations();

const APPLY = process.argv.includes("--apply");
const PAYMENT_METHOD = "Baixa administrativa";
const NOTE = "Baixa administrativa de pendencia antiga de pacotinho revisada em 2026-07-04";

const TARGETS = [
  { pet: "Lucky", customer: "Thamirys" },
  { pet: "Cacau", customer: "Fabiana" },
  { pet: "", customer: "Mariangela" },
  { pet: "Perola", customer: "" },
  { pet: "Bolt", customer: "" },
  { pet: "Mel", customer: "Arina" },
  { pet: "Belinha", customer: "Rubens" },
  { pet: "Mel", customer: "Danilo" },
  { pet: "Meg", customer: "Sheila" },
  { pet: "Max", customer: "" },
  { pet: "Woody", customer: "Ice" },
  { pet: "Channel", customer: "" },
  { pet: "Sofi", customer: "Daniel" },
  { pet: "", customer: "Rafaela" },
  { pet: "Big", customer: "Marta" },
  { pet: "Lorena", customer: "Simone" },
  { pet: "Hercules", customer: "Ricardo" },
  { pet: "Brad", customer: "William" },
  { pet: "Mel", customer: "Juliana" },
  { pet: "Lua", customer: "Juliana" },
  { pet: "Amora", customer: "Patricia" },
  { pet: "Billy", customer: "Marilu" },
  { pet: "Pit", customer: "Gislene" },
];

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function dateOnly(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function startOfCurrentMonthSaoPaulo() {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  return `${today.slice(0, 7)}-01`;
}

function parseAppointmentPaymentId(reference) {
  const [prefix, id] = String(reference || "").trim().split(":");
  return prefix === "appointment_payment" && id ? id : null;
}

function parseAppointmentId(reference) {
  const [prefix, id] = String(reference || "").trim().split(":");
  return (prefix === "appointment_balance" || prefix === "appointment_free") && id
    ? id
    : null;
}

function targetMatches({ target, pet, customer }) {
  const petName = normalizeText(pet?.name);
  const customerName = normalizeText(customer?.name);
  const wantsPet = normalizeText(target.pet);
  const wantsCustomer = normalizeText(target.customer);

  if (wantsPet && !petName.includes(wantsPet)) return false;
  if (wantsCustomer && !customerName.includes(wantsCustomer)) return false;
  if (!wantsPet && !wantsCustomer) return false;

  return true;
}

async function findTargetMatches() {
  const [customers, pets] = await Promise.all([
    Custumers.findAll({ attributes: ["id", "name", "usersId"] }),
    Pets.findAll({ attributes: ["id", "name", "custumerId", "usersId"] }),
  ]);
  const customerById = new Map(customers.map((customer) => [String(customer.id), customer]));
  const matches = [];
  const seen = new Set();

  for (const target of TARGETS) {
    for (const pet of pets) {
      const customer = customerById.get(String(pet.custumerId));
      if (!customer || !targetMatches({ target, pet, customer })) continue;
      const key = `${customer.usersId}|${customer.id}|${pet.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ target, customer, pet });
    }

    if (!target.pet && target.customer) {
      for (const customer of customers) {
        if (!normalizeText(customer.name).includes(normalizeText(target.customer))) continue;
        const key = `${customer.usersId}|${customer.id}|sem-pet`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ target, customer, pet: null });
      }
    }
  }

  return matches;
}

async function getOldOpenAgendaFinances({ customer, pet, monthStart }) {
  const appointmentWhere = {
    usersId: customer.usersId,
    customerId: customer.id,
  };
  if (pet?.id) appointmentWhere.petId = pet.id;

  const appointments = await Appointment.findAll({
    where: appointmentWhere,
    attributes: ["id", "date", "status", "customerId", "petId"],
  });
  const appointmentIds = appointments.map((appointment) => String(appointment.id));
  if (!appointmentIds.length) return [];

  const payments = await AppointmentPayment.findAll({
    where: {
      usersId: customer.usersId,
      appointmentId: { [Op.in]: appointmentIds },
    },
    attributes: ["id", "appointmentId", "status", "paidAt", "financeId"],
  });

  const references = [
    ...payments.map((payment) => `appointment_payment:${payment.id}`),
    ...appointmentIds.map((id) => `appointment_balance:${id}`),
    ...appointmentIds.map((id) => `appointment_free:${id}`),
  ];

  const finances = await Finance.findAll({
    where: {
      usersId: customer.usersId,
      type: "entrada",
      status: { [Op.in]: ["pendente", "atrasado"] },
      reference: { [Op.in]: references },
    },
    order: [["dueDate", "ASC"], ["id", "ASC"]],
  });

  const paymentById = new Map(payments.map((payment) => [String(payment.id), payment]));
  const appointmentById = new Map(appointments.map((appointment) => [String(appointment.id), appointment]));
  const seenKeys = new Set();
  const eligible = [];

  for (const finance of finances) {
    const paymentId = parseAppointmentPaymentId(finance.reference);
    const payment = paymentId ? paymentById.get(String(paymentId)) : null;
    if (payment && (String(payment.status || "").toLowerCase() === "pago" || payment.paidAt)) {
      continue;
    }

    const appointmentId = payment?.appointmentId || parseAppointmentId(finance.reference);
    const appointment = appointmentById.get(String(appointmentId));
    const dueDate = dateOnly(finance.dueDate || appointment?.date || finance.date);
    if (!dueDate || dueDate >= monthStart) continue;

    const key = [
      String(finance.reference || "").trim().toLowerCase(),
      dueDate,
      Number(finance.grossAmount || finance.amount || 0).toFixed(2),
    ].join("|");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    eligible.push({ finance, appointment, payment, dueDate });
  }

  return eligible;
}

async function settleFinance({ finance, appointment, payment, dueDate }, transaction) {
  const amount = Number(finance.grossAmount || finance.amount || 0) || 0;
  const paidAt = new Date(`${dueDate}T12:00:00`);
  const reference = String(finance.reference || "").trim();
  const [prefix] = reference.split(":");
  let paymentRow = payment;

  await finance.update(
    {
      status: "pago",
      paymentMethod: PAYMENT_METHOD,
      date: paidAt,
      notes: finance.notes ? `${finance.notes} | ${NOTE}` : NOTE,
    },
    { transaction },
  );

  if (appointment && (prefix === "appointment_balance" || prefix === "appointment_free")) {
    paymentRow = await AppointmentPayment.create(
      {
        appointmentId: appointment.id,
        usersId: finance.usersId,
        dueDate,
        paymentMethod: PAYMENT_METHOD,
        details: NOTE,
        amount,
        grossAmount: amount,
        feePercentage: Number(finance.feePercentage || 0) || 0,
        feeAmount: Number(finance.feeAmount || 0) || 0,
        netAmount: Number(finance.netAmount || finance.grossAmount || finance.amount || 0) || amount,
        status: "pago",
        paidAt,
        financeId: finance.id,
        createdBy: finance.createdBy,
      },
      { transaction },
    );
  }

  if (paymentRow) {
    await paymentRow.update(
      {
        status: "pago",
        paidAt,
        paymentMethod: PAYMENT_METHOD,
      },
      { transaction },
    );
  }

  return appointment?.id || paymentRow?.appointmentId || null;
}

const monthStart = startOfCurrentMonthSaoPaulo();
const matches = await findTargetMatches();
const totals = { matches: matches.length, finances: 0, amount: 0 };
const appointmentIdsToSync = new Set();
const processedFinanceIds = new Set();

console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"} | baixa anterior a ${monthStart}`);

for (const match of matches) {
  const items = await getOldOpenAgendaFinances({
    customer: match.customer,
    pet: match.pet,
    monthStart,
  }).then((rows) =>
    rows.filter((row) => {
      const financeId = String(row?.finance?.id || "");
      if (!financeId || processedFinanceIds.has(financeId)) return false;
      return true;
    }),
  );
  const amount = items.reduce((sum, item) => sum + Number(item.finance.grossAmount || item.finance.amount || 0), 0);
  if (!items.length) continue;

  totals.finances += items.length;
  totals.amount += amount;
  for (const item of items) {
    processedFinanceIds.add(String(item.finance.id));
  }
  console.log(
    `\n${match.pet?.name || "-"} / ${match.customer.name} | tenant ${match.customer.usersId}`,
  );
  for (const item of items) {
    console.log(
      `  finance=${item.finance.id} due=${item.dueDate} valor=R$ ${Number(item.finance.grossAmount || item.finance.amount || 0).toFixed(2)} ref=${item.finance.reference}`,
    );
  }

  if (APPLY) {
    const transaction = await sequelize.transaction();
    try {
      for (const item of items) {
        const appointmentId = await settleFinance(item, transaction);
        if (appointmentId) appointmentIdsToSync.add(String(appointmentId));
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

if (APPLY) {
  for (const appointmentId of appointmentIdsToSync) {
    await syncAppointmentFinance(appointmentId);
  }
}

console.log(
  `\nResumo: ${totals.finances} pendencia(s), R$ ${totals.amount.toFixed(2)} ${APPLY ? "baixadas" : "em dry-run"}.`,
);

await sequelize.close();
