import express from "express";
import authenticate from "../middlewares/auth.js";
import PaymentMethodFee, {
  DEFAULT_PAYMENT_METHODS,
  normalizePaymentMethodKey,
  computeBreakdown,
} from "../models/PaymentMethodFee.js";
import { logActivity } from "../service/activityLogger.js";
import { invalidateMethodFeeCache } from "../service/appointmentFinance.js";

const router = express.Router();

const VALID_METHOD_KEYS = new Set(DEFAULT_PAYMENT_METHODS.map((m) => m.method));

async function ensureDefaultsForUser(usersId) {
  const existing = await PaymentMethodFee.findAll({ where: { usersId } });
  if (existing.length > 0) return existing;

  const created = await PaymentMethodFee.bulkCreate(
    DEFAULT_PAYMENT_METHODS.map((d) => ({ ...d, usersId })),
    { returning: true },
  );
  return created;
}

router.get("/payment-method-fees", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const list = await ensureDefaultsForUser(usersId);
    const sorted = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    res.json({ message: "Taxas listadas", data: sorted });
  } catch (error) {
    console.error("Erro ao listar taxas:", error);
    res.status(500).json({ message: "Erro ao listar taxas", error: error.message });
  }
});

router.put("/payment-method-fees/:method", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const method = String(req.params.method || "").trim().toLowerCase();
    if (!VALID_METHOD_KEYS.has(method)) {
      return res.status(400).json({ message: `Método '${method}' inválido` });
    }

    const { label, feePercent, feeFixed, active } = req.body || {};
    const update = {};
    if (label !== undefined) update.label = String(label).slice(0, 80);
    if (feePercent !== undefined) update.feePercent = Math.max(0, Number(feePercent) || 0);
    if (feeFixed !== undefined) update.feeFixed = Math.max(0, Number(feeFixed) || 0);
    if (active !== undefined) update.active = Boolean(active);

    await ensureDefaultsForUser(usersId);
    const [row] = await PaymentMethodFee.findOrCreate({
      where: { usersId, method },
      defaults: {
        usersId,
        method,
        label: update.label || DEFAULT_PAYMENT_METHODS.find((d) => d.method === method)?.label || method,
        feePercent: update.feePercent ?? 0,
        feeFixed: update.feeFixed ?? 0,
        active: update.active ?? true,
        sortOrder: DEFAULT_PAYMENT_METHODS.find((d) => d.method === method)?.sortOrder ?? 99,
      },
    });

    await row.update(update);
    invalidateMethodFeeCache(usersId);

    logActivity({
      req,
      modulo: "financeiro",
      acao: "payment_fee_updated",
      descricao: `Taxa atualizada (${method}): ${row.feePercent}% + R$ ${row.feeFixed}`,
      entidadeTipo: "payment_method_fee",
      entidadeId: row.id,
      metadata: { method, ...update },
    });

    res.json({ message: "Taxa atualizada", data: row });
  } catch (error) {
    console.error("Erro ao atualizar taxa:", error);
    res.status(500).json({ message: "Erro ao atualizar taxa", error: error.message });
  }
});

router.post("/payment-method-fees/reset", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    await PaymentMethodFee.destroy({ where: { usersId } });
    invalidateMethodFeeCache(usersId);
    const created = await ensureDefaultsForUser(usersId);
    res.json({ message: "Taxas restauradas para o padrão", data: created });
  } catch (error) {
    console.error("Erro ao restaurar taxas:", error);
    res.status(500).json({ message: "Erro ao restaurar taxas", error: error.message });
  }
});

router.post("/payment-method-fees/calculate", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const { method, grossAmount, hasInstallments } = req.body || {};
    if (grossAmount == null) {
      return res.status(400).json({ message: "grossAmount obrigatório" });
    }

    const key = normalizePaymentMethodKey(method, { hasInstallments });
    await ensureDefaultsForUser(usersId);
    const fee = await PaymentMethodFee.findOne({ where: { usersId, method: key } });
    const breakdown = computeBreakdown(grossAmount, fee?.feePercent, fee?.feeFixed);

    res.json({
      message: "Cálculo realizado",
      data: {
        methodKey: key,
        methodLabel: fee?.label || key,
        feePercent: Number(fee?.feePercent || 0),
        feeFixed: Number(fee?.feeFixed || 0),
        ...breakdown,
      },
    });
  } catch (error) {
    console.error("Erro ao calcular taxa:", error);
    res.status(500).json({ message: "Erro ao calcular taxa", error: error.message });
  }
});

export default router;
