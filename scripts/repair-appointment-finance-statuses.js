#!/usr/bin/env node

import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Appointment from "../models/Appointment.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Finance from "../models/Finance.js";
import { setupAssociations } from "../models/associations.js";
import { syncAppointmentFinance } from "../service/appointmentFinance.js";

dotenv.config();
setupAssociations();

function parseAppointmentIdFromReference(reference) {
  const normalizedReference = String(reference || "").trim();
  const [prefix, appointmentId] = normalizedReference.split(":");
  if ((prefix === "appointment_balance" || prefix === "appointment_free") && appointmentId) {
    return appointmentId;
  }
  return null;
}

function parseAppointmentPaymentIdFromReference(reference) {
  const normalizedReference = String(reference || "").trim();
  const [prefix, paymentId] = normalizedReference.split(":");
  if (prefix === "appointment_payment" && paymentId) {
    return paymentId;
  }
  return null;
}

function getReferenceKind(reference) {
  const normalizedReference = String(reference || "").trim().toLowerCase();
  if (normalizedReference.startsWith("appointment_payment:")) return "payment";
  if (normalizedReference.startsWith("appointment_balance:")) return "balance";
  if (normalizedReference.startsWith("appointment_free:")) return "free";
  if (normalizedReference === "appointment") return "legacy";
  return "other";
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "paid" || normalized === "confirmado") return "pago";
  if (normalized === "cancelled") return "cancelado";
  return normalized || "pendente";
}

function toDateOnlyValue(value, fallback = new Date()) {
  const source = value || fallback;
  if (typeof source === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return source;
  }
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(fallback).toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

async function findAppointmentForFinance(finance) {
  const usersId = finance.usersId;
  const paymentReferenceId = parseAppointmentPaymentIdFromReference(finance.reference);
  if (paymentReferenceId) {
    const payment = await AppointmentPayment.findOne({
      where: {
        [Op.or]: [{ id: paymentReferenceId }, { financeId: finance.id }],
        usersId,
      },
    });
    if (payment) {
      return {
        appointmentId: payment.appointmentId,
        payment,
      };
    }
  }

  const appointmentId = parseAppointmentIdFromReference(finance.reference);
  if (appointmentId) {
    const appointment = await Appointment.findOne({
      where: {
        id: appointmentId,
        usersId,
      },
      attributes: ["id"],
    });
    if (appointment) {
      return {
        appointmentId: appointment.id,
        payment: null,
      };
    }
  }

  if (String(finance.reference || "").trim() === "appointment") {
    const appointment = await Appointment.findOne({
      where: {
        financeId: finance.id,
        usersId,
      },
      attributes: ["id"],
    });
    if (appointment) {
      return {
        appointmentId: appointment.id,
        payment: null,
      };
    }
  }

  return {
    appointmentId: null,
    payment: null,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const targetUsersIdArg = process.argv.find((arg) => arg.startsWith("--usersId="));
  const targetUsersId = targetUsersIdArg ? targetUsersIdArg.split("=").slice(1).join("=").trim() : "";

  const where = {
    type: "entrada",
    reference: {
      [Op.or]: [
        { [Op.like]: "appointment_payment:%" },
        { [Op.like]: "appointment_balance:%" },
        { [Op.like]: "appointment_free:%" },
        "appointment",
      ],
    },
    status: {
      [Op.in]: ["pendente", "atrasado", "pago"],
    },
  };

  if (targetUsersId) {
    where.usersId = targetUsersId;
  }

  await sequelize.authenticate();

  const finances = await Finance.findAll({
    where,
    order: [["updatedAt", "DESC"]],
  });

  const appointmentIdsToSync = new Set();
  const report = {
    scanned: finances.length,
    matchedAppointments: 0,
    paymentRowsMarkedPaid: 0,
    balanceRowsConverted: 0,
    financeRowsNeedingResync: 0,
    appointmentsSynced: 0,
    skipped: 0,
  };

  for (const finance of finances) {
    const referenceKind = getReferenceKind(finance.reference);
    const financeStatus = normalizeStatus(finance.status);
    const { appointmentId, payment } = await findAppointmentForFinance(finance);

    if (!appointmentId) {
      report.skipped += 1;
      continue;
    }

    report.matchedAppointments += 1;
    let shouldSync = false;

    if (referenceKind === "payment") {
      if (!payment) {
        shouldSync = true;
      } else {
        const paymentStatus = normalizeStatus(payment.status);
        if (financeStatus === "pago" && paymentStatus !== "pago") {
          if (apply) {
            await payment.update({
              status: "pago",
              paymentMethod: finance.paymentMethod || payment.paymentMethod,
              paidAt: payment.paidAt || finance.date || finance.updatedAt || new Date(),
            });
          }
          report.paymentRowsMarkedPaid += 1;
          shouldSync = true;
        } else if (financeStatus !== "pago" && paymentStatus === "pago") {
          report.financeRowsNeedingResync += 1;
          shouldSync = true;
        }
      }
    }

    if ((referenceKind === "balance" || referenceKind === "legacy") && financeStatus === "pago") {
      if (apply) {
        await AppointmentPayment.create({
          appointmentId,
          usersId: finance.usersId,
          dueDate: toDateOnlyValue(finance.dueDate || finance.date),
          paymentMethod: finance.paymentMethod || "Pendente",
          details: finance.notes || "Baixa reparada pelo script de sincronização",
          amount: Number(finance.grossAmount || finance.amount || 0) || 0,
          grossAmount: Number(finance.grossAmount || finance.amount || 0) || 0,
          feePercentage: Number(finance.feePercentage || 0) || 0,
          feeAmount: Number(finance.feeAmount || 0) || 0,
          netAmount: Number(finance.netAmount || finance.grossAmount || finance.amount || 0) || 0,
          status: "pago",
          paidAt: finance.date || finance.updatedAt || new Date(),
          financeId: finance.id,
          createdBy: finance.createdBy,
        });
      }
      report.balanceRowsConverted += 1;
      shouldSync = true;
    }

    if (shouldSync) {
      appointmentIdsToSync.add(String(appointmentId));
    }
  }

  if (apply) {
    for (const appointmentId of appointmentIdsToSync) {
      await syncAppointmentFinance(appointmentId);
      report.appointmentsSynced += 1;
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    targetUsersId: targetUsersId || null,
    ...report,
  }, null, 2));

  await sequelize.close();
}

main().catch(async (error) => {
  console.error("[repair-appointment-finance-statuses]", error);
  try {
    await sequelize.close();
  } catch {
    // noop
  }
  process.exit(1);
});
