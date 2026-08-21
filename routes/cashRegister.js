import express from "express";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import authenticate from "../middlewares/auth.js";
import CashRegisterSession from "../models/CashRegisterSession.js";
import CashRegisterMovement from "../models/CashRegisterMovement.js";
import Finance from "../models/Finance.js";
import { normalizePaymentMethodKey } from "../models/PaymentMethodFee.js";

const router = express.Router();
const activeStatuses = ["ABERTO", "EM_CONFERENCIA", "FECHAMENTO_COM_PENDENCIA"];
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

async function captureCashReceipt(finance, options = {}) {
  if (finance.type !== "entrada" || finance.status !== "pago" || normalizePaymentMethodKey(finance.paymentMethod) !== "dinheiro") return;
  if (finance.category === "Caixa") return;
  const session = await CashRegisterSession.findOne({ where: { usersId: finance.usersId, status: "ABERTO" }, order: [["openedAt", "DESC"]], transaction: options.transaction });
  if (!session) return;
  await CashRegisterMovement.findOrCreate({
    where: { usersId: finance.usersId, idempotencyKey: `finance:${finance.id}:cash-receipt` },
    defaults: { sessionId: session.id, usersId: finance.usersId, type: "RECEBIMENTO", direction: "ENTRADA", amount: money(finance.grossAmount ?? finance.amount), description: finance.description || "Recebimento em dinheiro", sourceType: "finance", sourceId: String(finance.id), financeId: finance.id, createdBy: finance.createdBy, metadata: { reference: finance.reference, paymentMethod: finance.paymentMethod } },
    transaction: options.transaction,
  });
}

// O Financeiro continua sendo a origem dos recebimentos. O hook cria somente o
// reflexo físico em espécie e a chave finance:<id> impede lançamento duplicado.
Finance.addHook("afterCreate", "capturePhysicalCashReceipt", captureCashReceipt);
Finance.addHook("afterUpdate", "capturePhysicalCashReceipt", captureCashReceipt);

async function summary(session, transaction) {
  const movements = await CashRegisterMovement.findAll({ where: { sessionId: session.id, usersId: session.usersId }, order: [["createdAt", "DESC"]], transaction });
  const totals = movements.reduce((a, m) => { const v = money(m.amount); a[m.direction === "ENTRADA" ? "entries" : "exits"] += v; a.byType[m.type] = money((a.byType[m.type] || 0) + v); return a; }, { entries: 0, exits: 0, byType: {} });
  return { session, movements, totals, expectedAmount: money(session.openingAmount + totals.entries - totals.exits) };
}

router.get("/cash-register/current", authenticate, async (req, res) => {
  const session = await CashRegisterSession.findOne({ where: { usersId: req.user.establishment, status: { [Op.in]: activeStatuses } }, order: [["openedAt", "DESC"]] });
  res.json({ data: session ? await summary(session) : null });
});

router.post("/cash-register/open", authenticate, async (req, res) => {
  const amount = money(req.body.openingAmount);
  if (amount < 0) return res.status(400).json({ message: "O fundo de troco não pode ser negativo." });
  try {
    const session = await CashRegisterSession.create({ usersId: req.user.establishment, registerCode: req.body.registerCode || "principal", openingAmount: amount, openingNotes: req.body.notes || null, openedBy: req.user.id, deviceInfo: { ip: req.ip, userAgent: req.get("user-agent") } });
    res.status(201).json({ message: "Caixa aberto com segurança.", data: await summary(session) });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") return res.status(409).json({ message: "Este caixa já possui uma abertura ativa." });
    throw error;
  }
});

router.post("/cash-register/movements", authenticate, async (req, res) => {
  const allowed = { SUPRIMENTO: "ENTRADA", SAIDA: "SAIDA", SANGRIA: "SAIDA" };
  const direction = allowed[req.body.type]; const amount = money(req.body.amount);
  if (!direction || amount <= 0 || !String(req.body.description || "").trim()) return res.status(400).json({ message: "Informe tipo, valor e motivo válidos." });
  const session = await CashRegisterSession.findOne({ where: { id: req.body.sessionId, usersId: req.user.establishment, status: "ABERTO" } });
  if (!session) return res.status(409).json({ message: "Abra o caixa antes de movimentar dinheiro." });
  const key = req.get("Idempotency-Key") || `manual:${session.id}:${crypto.randomUUID()}`;
  const [movement] = await CashRegisterMovement.findOrCreate({ where: { usersId: req.user.establishment, idempotencyKey: key }, defaults: { sessionId: session.id, usersId: req.user.establishment, type: req.body.type, direction, amount, description: req.body.description.trim(), category: req.body.category || null, destination: req.body.destination || null, attachmentUrl: req.body.attachmentUrl || null, createdBy: req.user.id } });
  res.status(201).json({ message: "Movimentação registrada.", movement, data: await summary(session) });
});

router.post("/cash-register/close", authenticate, async (req, res) => {
  const result = await sequelize.transaction(async (transaction) => {
    const session = await CashRegisterSession.findOne({ where: { id: req.body.sessionId, usersId: req.user.establishment, status: { [Op.in]: activeStatuses } }, transaction, lock: transaction.LOCK.UPDATE });
    if (!session) return null;
    const current = await summary(session, transaction); const counted = money(req.body.countedAmount); const difference = money(counted - current.expectedAmount);
    if (difference !== 0 && !String(req.body.differenceReason || "").trim()) return { needsReason: true, expectedAmount: current.expectedAmount, difference };
    await session.update({ status: "FECHADO", countedAmount: counted, differenceAmount: difference, differenceReason: req.body.differenceReason || null, closedBy: req.user.id, closedAt: new Date() }, { transaction });
    return summary(session, transaction);
  });
  if (!result) return res.status(404).json({ message: "Caixa ativo não encontrado." });
  if (result.needsReason) return res.status(422).json({ message: "Justifique a falta ou sobra antes de fechar.", data: result });
  res.json({ message: "Caixa conferido e fechado.", data: result });
});

router.use((error, _req, res, _next) => { console.error("Erro no caixa físico:", error); res.status(500).json({ message: "Não foi possível concluir a operação do caixa." }); });
export default router;
