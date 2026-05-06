import express from "express";
import auth from "../middlewares/auth.js";
import Appointment from "../models/Appointment.js";
import AppointmentItem from "../models/AppointmentItem.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import Finance from "../models/Finance.js";
import Products from "../models/Products.js";
import Services from "../models/Services.js";
import {
  calculateMachineFeeBreakdown,
  getAppointmentComandaDetails,
  logAppointmentEvent,
  syncAppointmentFinance,
} from "../service/appointmentFinance.js";

const router = express.Router();

const toNumber = (value) => Number.parseFloat(value || 0) || 0;

const getAppointmentOr404 = async (appointmentId, usersId) => {
  return Appointment.findOne({
    where: {
      id: appointmentId,
      usersId,
    },
  });
};

router.get("/appointments/:id/details", auth, async (req, res) => {
  try {
    const details = await getAppointmentComandaDetails(
      req.params.id,
      req.user.establishment,
    );

    if (!details) {
      return res.status(404).json({
        message: "Agendamento não encontrado",
      });
    }

    return res.json({
      message: "Detalhes do agendamento encontrados com sucesso",
      data: details,
    });
  } catch (error) {
    console.error("Erro ao buscar detalhes da comanda do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao buscar detalhes da comanda do agendamento",
      error: error.message,
    });
  }
});

router.get("/appointments/:id/items", auth, async (req, res) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user.establishment);
    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    const items = await AppointmentItem.findAll({
      where: { appointmentId: appointment.id },
      order: [["createdAt", "ASC"]],
    });

    return res.json({
      message: "Itens encontrados com sucesso",
      data: items,
    });
  } catch (error) {
    console.error("Erro ao buscar itens do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao buscar itens do agendamento",
      error: error.message,
    });
  }
});

router.post("/appointments/:id/items", auth, async (req, res) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user.establishment);
    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    const {
      type,
      serviceId,
      productId,
      description,
      quantity = 1,
      unitPrice,
      discount = 0,
      observation,
    } = req.body;

    if (!["service", "product", "manual"].includes(type)) {
      return res.status(400).json({ message: "Tipo de item inválido" });
    }

    let finalDescription = description;
    const hasExplicitUnitPrice =
      unitPrice !== undefined && unitPrice !== null && String(unitPrice).trim() !== "";
    let finalUnitPrice = toNumber(unitPrice);
    let resolvedServiceId = serviceId;
    let resolvedProductId = productId;

    if (type === "service") {
      if (!resolvedServiceId && appointment.serviceId) {
        resolvedServiceId = appointment.serviceId;
      }
      if (!resolvedServiceId) {
        return res.status(400).json({ message: "serviceId é obrigatório" });
      }

      const service = await Services.findOne({
        where: {
          id: resolvedServiceId,
          establishment: req.user.establishment,
        },
      });

      if (!service) {
        return res.status(404).json({ message: "Serviço não encontrado" });
      }

      finalDescription = finalDescription || service.name;
      finalUnitPrice = hasExplicitUnitPrice ? finalUnitPrice : toNumber(service.price);
    }

    if (type === "product") {
      if (!resolvedProductId) {
        return res.status(400).json({ message: "productId é obrigatório" });
      }

      const product = await Products.findOne({
        where: {
          id: resolvedProductId,
          usersId: req.user.establishment,
        },
      });

      if (!product) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }

      finalDescription = finalDescription || product.name;
      finalUnitPrice = hasExplicitUnitPrice ? finalUnitPrice : toNumber(product.price);
    }

    if (type === "manual" && (!finalDescription || !hasExplicitUnitPrice)) {
      return res.status(400).json({
        message: "Itens manuais exigem descrição e valor unitário",
      });
    }

    const qty = Number(quantity);
    const itemDiscount = toNumber(discount);
    const total = Math.max(finalUnitPrice * qty - itemDiscount, 0);

    const item = await AppointmentItem.create({
      appointmentId: appointment.id,
      usersId: req.user.establishment,
      type,
      serviceId: resolvedServiceId || null,
      productId: resolvedProductId || null,
      description: finalDescription,
      quantity: qty,
      unitPrice: finalUnitPrice,
      discount: itemDiscount,
      total,
      observation: observation || null,
      createdBy: req.user.id,
    });

    const summary = await syncAppointmentFinance(appointment.id);
    await logAppointmentEvent({
      appointmentId: appointment.id,
      usersId: req.user.establishment,
      createdBy: req.user.id,
      status: appointment.status,
      eventType: "item_added",
      notes: `Item adicionado à comanda: ${finalDescription}`,
    });

    return res.status(201).json({
      message: "Item adicionado com sucesso",
      data: {
        item,
        summary,
      },
    });
  } catch (error) {
    console.error("Erro ao adicionar item do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao adicionar item do agendamento",
      error: error.message,
    });
  }
});

router.put("/appointments/:id/items/:itemId", auth, async (req, res) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user.establishment);
    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    const item = await AppointmentItem.findOne({
      where: {
        id: req.params.itemId,
        appointmentId: appointment.id,
        usersId: req.user.establishment,
      },
    });

    if (!item) {
      return res.status(404).json({ message: "Item não encontrado" });
    }

    const quantity = Number(req.body.quantity ?? item.quantity);
    const unitPrice = toNumber(req.body.unitPrice ?? item.unitPrice);
    const discount = toNumber(req.body.discount ?? item.discount);

    await item.update({
      description: req.body.description ?? item.description,
      observation: req.body.observation ?? item.observation,
      quantity,
      unitPrice,
      discount,
      total: Math.max(unitPrice * quantity - discount, 0),
    });

    const summary = await syncAppointmentFinance(appointment.id);
    await logAppointmentEvent({
      appointmentId: appointment.id,
      usersId: req.user.establishment,
      createdBy: req.user.id,
      status: appointment.status,
      eventType: "item_updated",
      notes: `Item atualizado na comanda: ${item.description}`,
    });

    return res.json({
      message: "Item atualizado com sucesso",
      data: {
        item,
        summary,
      },
    });
  } catch (error) {
    console.error("Erro ao atualizar item do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao atualizar item do agendamento",
      error: error.message,
    });
  }
});

router.delete("/appointments/:id/items/:itemId", auth, async (req, res) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user.establishment);
    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    const item = await AppointmentItem.findOne({
      where: {
        id: req.params.itemId,
        appointmentId: appointment.id,
        usersId: req.user.establishment,
      },
    });

    if (!item) {
      return res.status(404).json({ message: "Item não encontrado" });
    }

    const removedDescription = item.description;
    await item.destroy();

    const summary = await syncAppointmentFinance(appointment.id);
    await logAppointmentEvent({
      appointmentId: appointment.id,
      usersId: req.user.establishment,
      createdBy: req.user.id,
      status: appointment.status,
      eventType: "item_removed",
      notes: `Item removido da comanda: ${removedDescription}`,
    });

    return res.json({
      message: "Item removido com sucesso",
      data: { summary },
    });
  } catch (error) {
    console.error("Erro ao remover item do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao remover item do agendamento",
      error: error.message,
    });
  }
});

router.get("/appointments/:id/payments", auth, async (req, res) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user.establishment);
    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    const payments = await AppointmentPayment.findAll({
      where: { appointmentId: appointment.id },
      order: [["dueDate", "ASC"], ["createdAt", "ASC"]],
    });

    return res.json({
      message: "Pagamentos encontrados com sucesso",
      data: payments,
    });
  } catch (error) {
    console.error("Erro ao buscar pagamentos do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao buscar pagamentos do agendamento",
      error: error.message,
    });
  }
});

router.post("/appointments/:id/payments", auth, async (req, res) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user.establishment);
    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    const {
      dueDate,
      paymentMethod,
      details,
      amount,
      feePercentage = 0,
      status = "pendente",
      paidAt,
    } = req.body;

    if (!dueDate || !paymentMethod || amount == null || amount === "") {
      return res.status(400).json({
        message: "dueDate, paymentMethod e amount são obrigatórios",
      });
    }

    if (!["pendente", "pago", "cancelado"].includes(status)) {
      return res.status(400).json({ message: "Status de pagamento inválido" });
    }

    const normalizedAmount = toNumber(amount);

    if (normalizedAmount <= 0) {
      const summary = await syncAppointmentFinance(appointment.id);
      return res.status(200).json({
        message: "Pagamento sem valor ignorado com sucesso",
        data: {
          payment: null,
          skipped: true,
          summary,
        },
      });
    }

    const breakdown = calculateMachineFeeBreakdown(normalizedAmount, feePercentage);

    const payment = await AppointmentPayment.create({
      appointmentId: appointment.id,
      usersId: req.user.establishment,
      dueDate,
      paymentMethod,
      details: details || null,
      amount: breakdown.grossAmount,
      grossAmount: breakdown.grossAmount,
      feePercentage: breakdown.feePercentage,
      feeAmount: breakdown.feeAmount,
      netAmount: breakdown.netAmount,
      status,
      paidAt: status === "pago" ? paidAt || new Date() : null,
      createdBy: req.user.id,
    });

    const summary = await syncAppointmentFinance(appointment.id);
    await logAppointmentEvent({
      appointmentId: appointment.id,
      usersId: req.user.establishment,
      createdBy: req.user.id,
      status: appointment.status,
      eventType: "payment_added",
      notes: `Pagamento lançado: ${paymentMethod} - bruto R$ ${breakdown.grossAmount.toFixed(2)} / líquido R$ ${breakdown.netAmount.toFixed(2)}`,
    });

    return res.status(201).json({
      message: "Pagamento adicionado com sucesso",
      data: {
        payment,
        summary,
      },
    });
  } catch (error) {
    console.error("Erro ao adicionar pagamento do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao adicionar pagamento do agendamento",
      error: error.message,
    });
  }
});

router.put("/appointments/:id/payments/:paymentId", auth, async (req, res) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user.establishment);
    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    const payment = await AppointmentPayment.findOne({
      where: {
        id: req.params.paymentId,
        appointmentId: appointment.id,
        usersId: req.user.establishment,
      },
    });

    if (!payment) {
      return res.status(404).json({ message: "Pagamento não encontrado" });
    }

    const status = req.body.status ?? payment.status;
    if (!["pendente", "pago", "cancelado"].includes(status)) {
      return res.status(400).json({ message: "Status de pagamento inválido" });
    }

    const grossAmount = toNumber(
      req.body.grossAmount ?? req.body.amount ?? payment.grossAmount ?? payment.amount,
    );
    const feePercentage = toNumber(
      req.body.feePercentage ?? payment.feePercentage,
    );
    const breakdown = calculateMachineFeeBreakdown(grossAmount, feePercentage);

    await payment.update({
      dueDate: req.body.dueDate ?? payment.dueDate,
      paymentMethod: req.body.paymentMethod ?? payment.paymentMethod,
      details: req.body.details ?? payment.details,
      amount: breakdown.grossAmount,
      grossAmount: breakdown.grossAmount,
      feePercentage: breakdown.feePercentage,
      feeAmount: breakdown.feeAmount,
      netAmount: breakdown.netAmount,
      status,
      paidAt:
        status === "pago"
          ? req.body.paidAt || payment.paidAt || new Date()
          : null,
    });

    const summary = await syncAppointmentFinance(appointment.id);
    await logAppointmentEvent({
      appointmentId: appointment.id,
      usersId: req.user.establishment,
      createdBy: req.user.id,
      status: appointment.status,
      eventType: "payment_updated",
      notes: `Pagamento atualizado: ${payment.paymentMethod} - ${status} - bruto R$ ${breakdown.grossAmount.toFixed(2)} / líquido R$ ${breakdown.netAmount.toFixed(2)}`,
    });

    return res.json({
      message: "Pagamento atualizado com sucesso",
      data: {
        payment,
        summary,
      },
    });
  } catch (error) {
    console.error("Erro ao atualizar pagamento do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao atualizar pagamento do agendamento",
      error: error.message,
    });
  }
});

router.delete("/appointments/:id/payments/:paymentId", auth, async (req, res) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user.establishment);
    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    const payment = await AppointmentPayment.findOne({
      where: {
        id: req.params.paymentId,
        appointmentId: appointment.id,
        usersId: req.user.establishment,
      },
    });

    if (!payment) {
      return res.status(404).json({ message: "Pagamento não encontrado" });
    }

    if (payment.financeId) {
      const linkedFinance = await Finance.findByPk(payment.financeId);
      if (linkedFinance) {
        await linkedFinance.destroy();
      }
    }

    const paymentLabel = `${payment.paymentMethod} - R$ ${toNumber(payment.amount).toFixed(2)}`;
    await payment.destroy();

    const summary = await syncAppointmentFinance(appointment.id);
    await logAppointmentEvent({
      appointmentId: appointment.id,
      usersId: req.user.establishment,
      createdBy: req.user.id,
      status: appointment.status,
      eventType: "payment_removed",
      notes: `Pagamento removido: ${paymentLabel}`,
    });

    return res.json({
      message: "Pagamento removido com sucesso",
      data: { summary },
    });
  } catch (error) {
    console.error("Erro ao remover pagamento do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao remover pagamento do agendamento",
      error: error.message,
    });
  }
});

router.post("/appointments/repair-payment-statuses", auth, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const deliveredStatuses = ["entregue", "concluido", "atendido", "pronto"];

    const candidatePayments = await AppointmentPayment.findAll({
      where: {
        usersId,
        status: "pendente",
      },
    });

    const appointmentIdsToCheck = [
      ...new Set(
        candidatePayments
          .map((payment) => String(payment.appointmentId || ""))
          .filter(Boolean),
      ),
    ];

    const appointmentsById = appointmentIdsToCheck.length
      ? new Map(
          (
            await Appointment.findAll({
              where: { id: appointmentIdsToCheck, usersId },
            })
          ).map((appointment) => [String(appointment.id), appointment]),
        )
      : new Map();

    const affectedAppointmentIds = new Set();
    let repairedCount = 0;

    for (const payment of candidatePayments) {
      const method = String(payment.paymentMethod || "").trim();
      const amount = Number(payment.grossAmount || payment.amount || 0) || 0;
      if (!method || amount <= 0) continue;

      const appointment = appointmentsById.get(String(payment.appointmentId));
      const appointmentStatus = String(appointment?.status || "").trim().toLowerCase();
      if (!deliveredStatuses.includes(appointmentStatus)) continue;

      await payment.update({
        status: "pago",
        paidAt: payment.paidAt || payment.updatedAt || payment.createdAt || new Date(),
      });
      repairedCount += 1;
      affectedAppointmentIds.add(String(payment.appointmentId));
    }

    for (const appointmentId of affectedAppointmentIds) {
      try {
        await syncAppointmentFinance(appointmentId);
      } catch (syncError) {
        console.error("Erro ao ressincronizar agendamento:", appointmentId, syncError);
      }
    }

    return res.json({
      message: "Reparo de pagamentos concluído com sucesso",
      data: {
        repairedCount,
        affectedAppointments: affectedAppointmentIds.size,
      },
    });
  } catch (error) {
    console.error("Erro ao reparar status de pagamentos:", error);
    return res.status(500).json({
      message: "Erro ao reparar status de pagamentos",
      error: error.message,
    });
  }
});

router.get("/appointments/:id/history", auth, async (req, res) => {
  try {
    const details = await getAppointmentComandaDetails(
      req.params.id,
      req.user.establishment,
    );

    if (!details) {
      return res.status(404).json({
        message: "Agendamento não encontrado",
      });
    }

    return res.json({
      message: "Histórico encontrado com sucesso",
      data: details.history,
    });
  } catch (error) {
    console.error("Erro ao buscar histórico do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao buscar histórico do agendamento",
      error: error.message,
    });
  }
});

export default router;
