import express from "express";
import authenticate from "../middlewares/auth.js";
import { Op } from "sequelize";
import PersonalFinance from "../models/personal_finances.js";

const router = express.Router();

function buildNormalizedDateString(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1900 || y > 3000) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeFinanceDateInput(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return buildNormalizedDateString(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return buildNormalizedDateString(isoMatch[1], isoMatch[2], isoMatch[3]);

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) return buildNormalizedDateString(brMatch[3], brMatch[2], brMatch[1]);

  const plainMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (plainMatch) return buildNormalizedDateString(plainMatch[1], plainMatch[2], plainMatch[3]);

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return buildNormalizedDateString(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
  }
  return null;
}

function parseDateParam(value, endOfDay = false) {
  if (!value) return null;
  const normalized = normalizeFinanceDateInput(value);
  if (!normalized) return null;
  return endOfDay
    ? new Date(`${normalized}T23:59:59.999Z`)
    : new Date(`${normalized}T00:00:00.000Z`);
}

function normalizePersonalFinanceStatusInput(value, fallback = "pendente") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "p" || normalized === "pago") return "pago";
  if (normalized === "n" || normalized === "nao" || normalized === "não" || normalized === "nao pago" || normalized === "não pago" || normalized === "pendente") {
    return "pendente";
  }
  if (normalized === "atrasado") return "atrasado";
  if (normalized === "cancelado") return "cancelado";
  return fallback;
}

// Criar nova entrada/saída financeira pessoal
router.post("/personal-finance", authenticate, async (req, res) => {
  try {
    const {
      type,
      description,
      amount,
      date,
      dueDate,
      category,
      subCategory,
      expenseType,
      frequency,
      paymentMethod,
      reference,
      notes,
      attachments,
      status,
    } = req.body;

    const normalizedDate = normalizeFinanceDateInput(date);
    if (!normalizedDate) {
      return res.status(400).json({
        message: "Data invalida para o registro financeiro pessoal",
      });
    }

    const normalizedDueDate = dueDate ? normalizeFinanceDateInput(dueDate) : null;
    if (dueDate && !normalizedDueDate) {
      return res.status(400).json({
        message: "Data de vencimento invalida para o registro financeiro pessoal",
      });
    }

    const finance = await PersonalFinance.create({
      type,
      description,
      amount,
      date: normalizedDate,
      dueDate: normalizedDueDate,
      category,
      subCategory,
      expenseType,
      frequency,
      paymentMethod,
      reference,
      notes,
      attachments,
      status: normalizePersonalFinanceStatusInput(status, "pendente"),
      user: req.user.id,
    });

    res.status(201).json({
      message: "Registro financeiro pessoal criado com sucesso",
      data: finance,
    });
  } catch (error) {
    console.error("Erro ao criar registro financeiro pessoal:", error);
    res.status(500).json({
      message: "Erro ao criar registro financeiro pessoal",
      error: error.message,
    });
  }
});

// Listar registros financeiros pessoais com filtros
router.get("/personal-finance", authenticate, async (req, res) => {
  try {
    const { type, startDate, endDate, category, status, expenseType } =
      req.query;

    const where = {
      user: req.user.id,
    };

    if (type) where.type = type;
    if (category) where.category = category;
    if (status) where.status = normalizePersonalFinanceStatusInput(status, "pendente");
    if (expenseType) where.expenseType = expenseType;
    if (startDate || endDate) {
      const parsedStartDate = parseDateParam(startDate, false);
      const parsedEndDate = parseDateParam(endDate, true);
      if (startDate && !parsedStartDate) {
        return res.status(400).json({ message: "Data inicial invalida" });
      }
      if (endDate && !parsedEndDate) {
        return res.status(400).json({ message: "Data final invalida" });
      }
      where.date = {};
      if (parsedStartDate) where.date[Op.gte] = parsedStartDate;
      if (parsedEndDate) where.date[Op.lte] = parsedEndDate;
    }

    const finances = await PersonalFinance.findAll({
      where,
      order: [["date", "DESC"]],
    });

    res.json({
      message: "Registros financeiros pessoais encontrados com sucesso",
      data: finances,
    });
  } catch (error) {
    console.error("Erro ao buscar registros financeiros pessoais:", error);
    res.status(500).json({
      message: "Erro ao buscar registros financeiros pessoais",
      error: error.message,
    });
  }
});

// Atualizar registro financeiro pessoal
router.put("/personal-finance/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const finance = await PersonalFinance.findOne({
      where: {
        id,
        user: req.user.id,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro pessoal não encontrado",
      });
    }

    const updatePayload = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(updatePayload, "date")) {
      const normalizedDate = normalizeFinanceDateInput(updatePayload.date);
      if (!normalizedDate) {
        return res.status(400).json({ message: "Data invalida para atualizacao" });
      }
      updatePayload.date = normalizedDate;
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, "dueDate")) {
      if (!updatePayload.dueDate) {
        updatePayload.dueDate = null;
      } else {
        const normalizedDueDate = normalizeFinanceDateInput(updatePayload.dueDate);
        if (!normalizedDueDate) {
          return res.status(400).json({ message: "Data de vencimento invalida para atualizacao" });
        }
        updatePayload.dueDate = normalizedDueDate;
      }
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, "status")) {
      updatePayload.status = normalizePersonalFinanceStatusInput(updatePayload.status, finance.status || "pendente");
    }

    const updatedFinance = await finance.update(updatePayload);

    res.json({
      message: "Registro financeiro pessoal atualizado com sucesso",
      data: updatedFinance,
    });
  } catch (error) {
    console.error("Erro ao atualizar registro financeiro pessoal:", error);
    res.status(500).json({
      message: "Erro ao atualizar registro financeiro pessoal",
      error: error.message,
    });
  }
});

// Excluir registro financeiro pessoal
router.delete("/personal-finance/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const finance = await PersonalFinance.findOne({
      where: {
        id,
        user: req.user.id,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro pessoal não encontrado",
      });
    }

    await finance.destroy();

    res.json({
      message: "Registro financeiro pessoal excluído com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir registro financeiro pessoal:", error);
    res.status(500).json({
      message: "Erro ao excluir registro financeiro pessoal",
      error: error.message,
    });
  }
});

// Buscar contas pessoais a pagar/receber
router.get("/personal-finance/pending", authenticate, async (req, res) => {
  try {
    const { type, dueStartDate, dueEndDate } = req.query;

    const where = {
      user: req.user.id,
      status: "pendente",
    };

    if (type) where.type = type;
    if (dueStartDate || dueEndDate) {
      const parsedStartDate = parseDateParam(dueStartDate, false);
      const parsedEndDate = parseDateParam(dueEndDate, true);
      if (dueStartDate && !parsedStartDate) {
        return res.status(400).json({ message: "Data inicial de vencimento invalida" });
      }
      if (dueEndDate && !parsedEndDate) {
        return res.status(400).json({ message: "Data final de vencimento invalida" });
      }
      where.dueDate = {};
      if (parsedStartDate) where.dueDate[Op.gte] = parsedStartDate;
      if (parsedEndDate) where.dueDate[Op.lte] = parsedEndDate;
    }

    const pendingFinances = await PersonalFinance.findAll({
      where,
      order: [["dueDate", "ASC"]],
    });

    res.json({
      message: "Contas pessoais pendentes encontradas com sucesso",
      data: pendingFinances,
    });
  } catch (error) {
    console.error("Erro ao buscar contas pessoais pendentes:", error);
    res.status(500).json({
      message: "Erro ao buscar contas pessoais pendentes",
      error: error.message,
    });
  }
});

// Atualizar status do registro financeiro pessoal
router.patch("/personal-finance/:id/status", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const normalizedStatus = normalizePersonalFinanceStatusInput(req.body?.status, null);
    if (!normalizedStatus) {
      return res.status(400).json({
        message: "Status invalido",
      });
    }

    const finance = await PersonalFinance.findOne({
      where: {
        id,
        user: req.user.id,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro pessoal não encontrado",
      });
    }

    const updatedFinance = await finance.update({ status: normalizedStatus });

    res.json({
      message: "Status atualizado com sucesso",
      data: updatedFinance,
    });
  } catch (error) {
    console.error("Erro ao atualizar status:", error);
    res.status(500).json({
      message: "Erro ao atualizar status",
      error: error.message,
    });
  }
});

// Buscar resumo financeiro pessoal por período
router.get("/personal-finance/summary", authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {
      user: req.user.id,
      status: "pago",
    };

    if (startDate || endDate) {
      const parsedStartDate = parseDateParam(startDate, false);
      const parsedEndDate = parseDateParam(endDate, true);
      if (startDate && !parsedStartDate) {
        return res.status(400).json({ message: "Data inicial invalida" });
      }
      if (endDate && !parsedEndDate) {
        return res.status(400).json({ message: "Data final invalida" });
      }
      where.date = {};
      if (parsedStartDate) where.date[Op.gte] = parsedStartDate;
      if (parsedEndDate) where.date[Op.lte] = parsedEndDate;
    }

    const finances = await PersonalFinance.findAll({ where });

    const summary = {
      entradas: {
        total: 0,
        count: 0,
      },
      saidas: {
        total: 0,
        count: 0,
        fixas: 0,
        variaveis: 0,
      },
      saldo: 0,
    };

    finances.forEach((finance) => {
      if (finance.type === "entrada") {
        summary.entradas.total += parseFloat(finance.amount);
        summary.entradas.count++;
      } else {
        summary.saidas.total += parseFloat(finance.amount);
        summary.saidas.count++;
        if (finance.expenseType === "fixo") {
          summary.saidas.fixas += parseFloat(finance.amount);
        } else {
          summary.saidas.variaveis += parseFloat(finance.amount);
        }
      }
    });

    summary.saldo = summary.entradas.total - summary.saidas.total;

    res.json({
      message: "Resumo financeiro pessoal calculado com sucesso",
      data: summary,
    });
  } catch (error) {
    console.error("Erro ao calcular resumo financeiro pessoal:", error);
    res.status(500).json({
      message: "Erro ao calcular resumo financeiro pessoal",
      error: error.message,
    });
  }
});

export default router;
