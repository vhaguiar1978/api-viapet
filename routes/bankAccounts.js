import express from "express";
import authenticate from "../middlewares/auth.js";
import BankAccount, { ACCOUNT_TYPES } from "../models/BankAccount.js";
import { logActivity } from "../service/activityLogger.js";

const router = express.Router();

function pickFields(body) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).slice(0, 120);
  if (body.bank !== undefined) out.bank = body.bank ? String(body.bank).slice(0, 120) : null;
  if (body.agency !== undefined) out.agency = body.agency ? String(body.agency).slice(0, 20) : null;
  if (body.accountNumber !== undefined) out.accountNumber = body.accountNumber ? String(body.accountNumber).slice(0, 40) : null;
  if (body.accountType !== undefined) {
    const t = String(body.accountType || "").trim().toLowerCase();
    out.accountType = ACCOUNT_TYPES.includes(t) ? t : "outros";
  }
  if (body.pixKey !== undefined) out.pixKey = body.pixKey ? String(body.pixKey).slice(0, 180) : null;
  if (body.initialBalance !== undefined) out.initialBalance = Number(body.initialBalance) || 0;
  if (body.active !== undefined) out.active = Boolean(body.active);
  if (body.notes !== undefined) out.notes = body.notes ? String(body.notes).slice(0, 2000) : null;
  return out;
}

router.get("/bank-accounts", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
    const where = { usersId };
    if (!includeInactive) where.active = true;
    const list = await BankAccount.findAll({
      where,
      order: [["active", "DESC"], ["name", "ASC"]],
    });
    res.json({ message: "Contas listadas", data: list });
  } catch (error) {
    console.error("Erro ao listar contas:", error);
    res.status(500).json({ message: "Erro ao listar contas", error: error.message });
  }
});

router.get("/bank-accounts/:id", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const row = await BankAccount.findOne({ where: { id: req.params.id, usersId } });
    if (!row) return res.status(404).json({ message: "Conta não encontrada" });
    res.json({ message: "Conta encontrada", data: row });
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar conta", error: error.message });
  }
});

router.post("/bank-accounts", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const fields = pickFields(req.body || {});
    if (!fields.name) {
      return res.status(400).json({ message: "Nome da conta é obrigatório" });
    }
    const row = await BankAccount.create({ ...fields, usersId });

    logActivity({
      req,
      modulo: "financeiro",
      acao: "bank_account_created",
      descricao: `Conta bancária criada: ${row.name}`,
      entidadeTipo: "bank_account",
      entidadeId: row.id,
      metadata: { bank: row.bank, type: row.accountType },
    });

    res.status(201).json({ message: "Conta criada", data: row });
  } catch (error) {
    console.error("Erro ao criar conta:", error);
    res.status(500).json({ message: "Erro ao criar conta", error: error.message });
  }
});

router.put("/bank-accounts/:id", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const row = await BankAccount.findOne({ where: { id: req.params.id, usersId } });
    if (!row) return res.status(404).json({ message: "Conta não encontrada" });

    const fields = pickFields(req.body || {});
    await row.update(fields);

    logActivity({
      req,
      modulo: "financeiro",
      acao: "bank_account_updated",
      descricao: `Conta bancária atualizada: ${row.name}`,
      entidadeTipo: "bank_account",
      entidadeId: row.id,
      metadata: fields,
    });

    res.json({ message: "Conta atualizada", data: row });
  } catch (error) {
    console.error("Erro ao atualizar conta:", error);
    res.status(500).json({ message: "Erro ao atualizar conta", error: error.message });
  }
});

router.patch("/bank-accounts/:id/status", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const row = await BankAccount.findOne({ where: { id: req.params.id, usersId } });
    if (!row) return res.status(404).json({ message: "Conta não encontrada" });
    await row.update({ active: !row.active });
    res.json({ message: "Status alterado", data: row });
  } catch (error) {
    res.status(500).json({ message: "Erro ao alterar status", error: error.message });
  }
});

router.delete("/bank-accounts/:id", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const row = await BankAccount.findOne({ where: { id: req.params.id, usersId } });
    if (!row) return res.status(404).json({ message: "Conta não encontrada" });

    // Soft-delete: marca como inativa em vez de remover (preserva FK em lançamentos antigos)
    await row.update({ active: false });

    logActivity({
      req,
      modulo: "financeiro",
      acao: "bank_account_deactivated",
      descricao: `Conta bancária desativada: ${row.name}`,
      entidadeTipo: "bank_account",
      entidadeId: row.id,
    });

    res.json({ message: "Conta desativada", data: row });
  } catch (error) {
    res.status(500).json({ message: "Erro ao desativar conta", error: error.message });
  }
});

export default router;
