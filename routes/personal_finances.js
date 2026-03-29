import express from "express";
import authenticate from "../middlewares/auth.js";
import { Op } from "sequelize";
import PersonalFinance from "../models/personal_finances.js";

const router = express.Router();

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

    const finance = await PersonalFinance.create({
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
    if (status) where.status = status;
    if (expenseType) where.expenseType = expenseType;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date[Op.gte] = new Date(startDate);
      if (endDate) where.date[Op.lte] = new Date(endDate);
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

    const updatedFinance = await finance.update(req.body);

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
      where.dueDate = {};
      if (dueStartDate) where.dueDate[Op.gte] = new Date(dueStartDate);
      if (dueEndDate) where.dueDate[Op.lte] = new Date(dueEndDate);
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
    const { status } = req.body;

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

    const updatedFinance = await finance.update({ status });

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
      where.date = {};
      if (startDate) where.date[Op.gte] = new Date(startDate);
      if (endDate) where.date[Op.lte] = new Date(endDate);
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
