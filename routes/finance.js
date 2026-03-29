import express from "express";
import authenticate from "../middlewares/auth.js";
import Sales from "../models/Sales.js";
import Appointment from "../models/Appointment.js";
import Services from "../models/Services.js";
import Users from "../models/Users.js";
import { Op } from "sequelize";
import Finance from "../models/Finance.js";
import CashClosure from "../models/CashClosure.js";
import sequelize from "sequelize";
const router = express.Router();

function parseDateParam(value, endOfDay = false) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
}

// Função auxiliar para calcular datas
const getDateRanges = () => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(
    startOfDay.getFullYear(),
    startOfDay.getMonth(),
    1
  );

  return { startOfDay, endOfDay, startOfWeek, startOfMonth };
};

// Criar nova entrada/saída financeira
router.post("/finance", authenticate, async (req, res) => {
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
      grossAmount,
      feePercentage,
      feeAmount,
      netAmount,
    } = req.body;

    const finance = await Finance.create({
      type,
      description,
      amount,
      grossAmount,
      feePercentage,
      feeAmount,
      netAmount,
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
      createdBy: req.user.id,
      usersId: req.user.establishment,
    });

    res.status(201).json({
      message: "Registro financeiro criado com sucesso",
      data: finance,
    });
  } catch (error) {
    console.error("Erro ao criar registro financeiro:", error);
    res.status(500).json({
      message: "Erro ao criar registro financeiro",
      error: error.message,
    });
  }
});

router.post("/finance/close-cash", authenticate, async (req, res) => {
  try {
    const referenceDate = req.body.referenceDate || new Date().toISOString().slice(0, 10);
    const notes = req.body.notes || null;

    const startDateTime = new Date(referenceDate);
    startDateTime.setUTCHours(0, 0, 0, 0);

    const endDateTime = new Date(referenceDate);
    endDateTime.setUTCHours(23, 59, 59, 999);

    const finances = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        dueDate: {
          [Op.gte]: startDateTime,
          [Op.lte]: endDateTime,
        },
        status: {
          [Op.ne]: "cancelado",
        },
      },
    });

    const totals = finances.reduce(
      (acc, item) => {
        const amount = Number(item.netAmount ?? item.amount ?? 0);

        if (item.type === "entrada") {
          acc.totalEntries += amount;
        }

        if (item.type === "saida") {
          acc.totalExpenses += amount;
        }

        if (item.category === "Vendas" && item.type === "entrada") {
          acc.totalSales += amount;
        }

        return acc;
      },
      {
        totalEntries: 0,
        totalExpenses: 0,
        totalSales: 0,
      }
    );

    const balance = totals.totalEntries - totals.totalExpenses;

    const payload = {
      referenceDate,
      totalEntries: totals.totalEntries,
      totalExpenses: totals.totalExpenses,
      totalSales: totals.totalSales,
      balance,
      notes,
      closedAt: new Date(),
      closedBy: req.user.id,
      usersId: req.user.establishment,
    };

    const existingClosure = await CashClosure.findOne({
      where: {
        referenceDate,
        usersId: req.user.establishment,
      },
    });

    const closure = existingClosure
      ? await existingClosure.update(payload)
      : await CashClosure.create(payload);

    res.status(200).json({
      message: "Caixa fechado com sucesso",
      data: closure,
    });
  } catch (error) {
    console.error("Erro ao fechar caixa:", error);
    res.status(500).json({
      message: "Erro ao fechar caixa",
      error: error.message,
    });
  }
});

router.get("/finance/cash-status/:referenceDate", authenticate, async (req, res) => {
  try {
    const referenceDate = req.params.referenceDate;

    const openingEntry = await Finance.findOne({
      where: {
        usersId: req.user.establishment,
        category: "Caixa",
        subCategory: "Abertura",
        dueDate: {
          [Op.gte]: new Date(`${referenceDate}T00:00:00.000Z`),
          [Op.lte]: new Date(`${referenceDate}T23:59:59.999Z`),
        },
        status: {
          [Op.ne]: "cancelado",
        },
      },
      order: [["createdAt", "DESC"]],
    });

    const closure = await CashClosure.findOne({
      where: {
        referenceDate,
        usersId: req.user.establishment,
      },
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      data: {
        referenceDate,
        opened: Boolean(openingEntry),
        openingAmount: Number(
          openingEntry?.netAmount ?? openingEntry?.amount ?? 0,
        ),
        openingEntry,
        closed: Boolean(closure),
        closure,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar status do caixa:", error);
    return res.status(500).json({
      message: "Erro ao buscar status do caixa",
      error: error.message,
    });
  }
});

router.post("/finance/open-cash", authenticate, async (req, res) => {
  try {
    const referenceDate =
      req.body.referenceDate || new Date().toISOString().slice(0, 10);
    const amount = Number(req.body.amount || 0);

    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: "Informe um valor valido para abertura do caixa.",
      });
    }

    const startDateTime = new Date(referenceDate);
    startDateTime.setUTCHours(0, 0, 0, 0);

    const endDateTime = new Date(referenceDate);
    endDateTime.setUTCHours(23, 59, 59, 999);

    const existingOpening = await Finance.findOne({
      where: {
        usersId: req.user.establishment,
        category: "Caixa",
        subCategory: "Abertura",
        dueDate: {
          [Op.gte]: startDateTime,
          [Op.lte]: endDateTime,
        },
        status: {
          [Op.ne]: "cancelado",
        },
      },
      order: [["createdAt", "DESC"]],
    });

    let openingEntry;

    if (existingOpening) {
      openingEntry = await existingOpening.update({
        amount,
        grossAmount: amount,
        feePercentage: 0,
        feeAmount: 0,
        netAmount: amount,
        paymentMethod: "Dinheiro",
        status: "pago",
        notes: "Abertura de caixa registrada na dashboard",
      });
    } else {
      openingEntry = await Finance.create({
        type: "entrada",
        description: "Abertura de caixa",
        amount,
        grossAmount: amount,
        feePercentage: 0,
        feeAmount: 0,
        netAmount: amount,
        date: referenceDate,
        dueDate: referenceDate,
        category: "Caixa",
        subCategory: "Abertura",
        expenseType: "variavel",
        frequency: "unico",
        paymentMethod: "Dinheiro",
        status: "pago",
        notes: "Abertura de caixa registrada na dashboard",
        createdBy: req.user.id,
        usersId: req.user.establishment,
      });
    }

    return res.status(200).json({
      message: "Caixa aberto com sucesso",
      data: openingEntry,
    });
  } catch (error) {
    console.error("Erro ao abrir caixa:", error);
    return res.status(500).json({
      message: "Erro ao abrir caixa",
      error: error.message,
    });
  }
});
// Listar registros financeiros com filtros
router.get("/finance/day/:endDate", authenticate, async (req, res) => {
  try {
    const endDate = req.params.endDate;

    // Cria objetos Date para início e fim do dia
    const startDateTime = new Date(endDate);
    startDateTime.setUTCHours(0, 0, 0, 0);

    const endDateTime = new Date(endDate);
    endDateTime.setUTCHours(23, 59, 59, 999);
    const finances = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        dueDate: {
          [Op.gte]: startDateTime,
          [Op.lte]: endDateTime,
        },
      },
      order: [["dueDate", "DESC"]],
    });

    // Buscar todas as finanças fixas do mês
    const startOfMonth = new Date(endDate);
    startOfMonth.setDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const endOfMonth = new Date(endDate);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setUTCHours(23, 59, 59, 999);

    const fixedFinances = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        expenseType: "fixo",
        status: "pendente",
        type: "saida",
        dueDate: {
          [Op.gte]: startOfMonth,
          [Op.lte]: endOfMonth,
        },
      },
    });

    // Calcular o total das finanças fixas
    const totalFixo = fixedFinances.reduce((sum, finance) => {
      return sum + Number(finance.amount);
    }, 0);

    res.json({
      financesFixo: totalFixo,
      fixo: fixedFinances,
      message: "Registros financeiros encontrados com sucesso",
      data: finances,
    });
  } catch (error) {
    console.error("Erro ao buscar registros financeiros:", error);
    res.status(500).json({
      message: "Erro ao buscar registros financeiros",
      error: error.message,
    });
  }
});

// Atualizar registro financeiro
router.put("/finance/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const finance = await Finance.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro não encontrado",
      });
    }

    const updatedFinance = await finance.update(req.body);

    res.json({
      message: "Registro financeiro atualizado com sucesso",
      data: updatedFinance,
    });
  } catch (error) {
    console.error("Erro ao atualizar registro financeiro:", error);
    res.status(500).json({
      message: "Erro ao atualizar registro financeiro",
      error: error.message,
    });
  }
});

// Excluir registro financeiro
router.delete("/finance/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const finance = await Finance.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro não encontrado",
      });
    }

    await finance.destroy();

    res.json({
      message: "Registro financeiro excluído com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir registro financeiro:", error);
    res.status(500).json({
      message: "Erro ao excluir registro financeiro",
      error: error.message,
    });
  }
});

// Buscar contas a pagar/receber
router.get("/finance/pending", authenticate, async (req, res) => {
  try {
    const { type, dueStartDate, dueEndDate } = req.query;

    const where = {
      usersId: req.user.establishment,
      status: "pendente",
    };

    if (type) where.type = type;
    if (dueStartDate || dueEndDate) {
      where.dueDate = {};
      if (dueStartDate) where.dueDate[Op.gte] = new Date(dueStartDate);
      if (dueEndDate) where.dueDate[Op.lte] = new Date(dueEndDate);
    }

    const pendingFinances = await Finance.findAll({
      where,
      order: [["dueDate", "ASC"]],
    });

    res.json({
      message: "Contas pendentes encontradas com sucesso",
      data: pendingFinances,
    });
  } catch (error) {
    console.error("Erro ao buscar contas pendentes:", error);
    res.status(500).json({
      message: "Erro ao buscar contas pendentes",
      error: error.message,
    });
  }
});

// Atualizar status do registro financeiro
router.patch("/finance/:id/status", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentMethod } = req.body;

    const finance = await Finance.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!finance) {
      return res.status(404).json({
        message: "Registro financeiro não encontrado",
      });
    }
    const updatedFinance = await finance.update({
      status,
      paymentMethod: paymentMethod || "Pendente",
    });

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

// Buscar resumo financeiro por período
router.get("/finance/summary", authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {
      usersId: req.user.establishment,
      status: {
        [Op.ne]: "cancelado",
      },
    };

    if (startDate || endDate) {
      const parsedStartDate = parseDateParam(startDate, false);
      const parsedEndDate = parseDateParam(endDate, true);
      const dateRange = {};
      if (parsedStartDate) dateRange[Op.gte] = parsedStartDate;
      if (parsedEndDate) dateRange[Op.lte] = parsedEndDate;
      if (Object.keys(dateRange).length) {
        where[Op.or] = [
          { date: dateRange },
          { dueDate: dateRange },
        ];
      }
    }

    const finances = await Finance.findAll({ where });

    const summary = {
      entradas: {
        total: 0,
        count: 0,
      },
      taxas: {
        total: 0,
      },
      commissions: {
        total: 0,
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
      const amount = parseFloat(finance.amount) || 0;
      const feeAmount = parseFloat(finance.feeAmount) || 0;

      if (finance.type === "entrada") {
        summary.entradas.total += amount;
        summary.entradas.count++;
        summary.taxas.total += feeAmount;
      } else {
        summary.saidas.total += amount;
        summary.saidas.count++;
        if (finance.expenseType === "fixo") {
          summary.saidas.fixas += amount;
        } else {
          summary.saidas.variaveis += amount;
        }
      }

      if (String(finance.category || "").toLowerCase().includes("comiss")) {
        summary.commissions.total += amount;
      }
    });

    summary.saldo = summary.entradas.total - summary.saidas.total;
    summary.totalSales = summary.entradas.total;

    res.json({
      message: "Resumo financeiro calculado com sucesso",
      data: summary,
    });
  } catch (error) {
    console.error("Erro ao calcular resumo financeiro:", error);
    res.status(500).json({
      message: "Erro ao calcular resumo financeiro",
      error: error.message,
    });
  }
});

// Rota para obter estatísticas mensais
router.get("/monthly-stats/:year/:month", authenticate, async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // Validar parâmetros
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({
        message: "Ano ou mês inválido",
      });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const usersId = req.user.establishment;

    // Buscar agendamentos do mês
    const appointments = await Appointment.findAll({
      where: {
        usersId,
        date: {
          [Op.between]: [startDate, endDate],
        },
        status: "Finalizado",
      },
      include: [
        {
          model: Services,
          attributes: ["id", "price", "category"],
        },
      ],
    });

    // Buscar vendas do mês
    const sales = await Sales.findAll({
      where: {
        usersId,
        createdAt: {
          [Op.between]: [startDate, endDate],
        },
        status: "Pago",
      },
    });

    // Inicializar contadores
    const stats = {
      patients: {
        count: 0, // Total de atendimentos
        uniqueCount: new Set(), // Pacientes únicos
        value: 0,
      },
      clinicalAppointments: {
        count: 0,
        value: 0,
      },
      aestheticAppointments: {
        count: 0,
        value: 0,
      },
      products: {
        count: 0,
        value: 0,
      },
    };

    // Processar agendamentos
    appointments.forEach((appointment) => {
      // Adicionar paciente ao Set de únicos
      if (appointment.clientId) {
        stats.patients.uniqueCount.add(appointment.clientId);
      }

      const value = appointment.Service
        ? parseFloat(appointment.Service.price) || 0
        : 0;

      // Classificar por tipo de serviço
      if (appointment.Service && appointment.Service.category) {
        const category = appointment.Service.category.toLowerCase();
        if (category.includes("Clínica") || category.includes("clínica")) {
          stats.clinicalAppointments.count++;
          stats.clinicalAppointments.value += value;
        } else if (
          category.includes("Estética") ||
          category.includes("estética")
        ) {
          stats.aestheticAppointments.count++;
          stats.aestheticAppointments.value += value;
        }
      }
    });

    // Processar vendas de produtos
    sales.forEach((sale) => {
      const saleTotal = parseFloat(sale.total) || 0;
      const quantity = parseInt(sale.quantity) || 1; // Se não tiver quantidade, assume 1

      stats.products.value += saleTotal;
      stats.products.count += quantity;
    });

    // Calcular totais
    stats.patients.count =
      stats.clinicalAppointments.count + stats.aestheticAppointments.count; // Total de atendimentos
    const uniquePatients = stats.patients.uniqueCount.size; // Quantidade de pacientes únicos
    delete stats.patients.uniqueCount; // Remove o Set do resultado
    stats.patients.value =
      stats.clinicalAppointments.value + stats.aestheticAppointments.value;

    res.json({
      message: "Estatísticas mensais encontradas com sucesso",
      data: stats,
    });
  } catch (error) {
    console.error("Erro ao buscar estatísticas mensais:", error);
    res.status(500).json({
      message: "Erro ao buscar estatísticas mensais",
      error: error.message,
    });
  }
});

// Rota para obter dados financeiros
router.get("/financial-data/:date", authenticate, async (req, res) => {
  try {
    const [month, year] = req.params.date.split("-");
    if (!month || !year || month.length !== 2 || year.length !== 4) {
      return res.status(400).json({
        message: "Data inválida",
        error: "Formato esperado: MM-YYYY",
      });
    }

    // Configura todas as datas necessárias
    const today = new Date();
    const startOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      0,
      0,
      0
    );
    const endOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23,
      59,
      59
    );

    // Início e fim da semana
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    // Início e fim do mês
    const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);

    // Buscar vendas (hoje, semana, mês)
    const [salesToday, salesWeek, salesMonth] = await Promise.all([
      Sales.findAll({
        where: {
          usersId: req.user.establishment,
          createdAt: { [Op.between]: [startOfToday, endOfToday] },
        },
        attributes: [
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
          [sequelize.fn("SUM", sequelize.col("total")), "total"],
        ],
        raw: true,
      }),
      Sales.findAll({
        where: {
          usersId: req.user.establishment,
          createdAt: { [Op.between]: [startOfWeek, endOfWeek] },
        },
        attributes: [
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
          [sequelize.fn("SUM", sequelize.col("total")), "total"],
        ],
        raw: true,
      }),
      Sales.findAll({
        where: {
          usersId: req.user.establishment,
          createdAt: { [Op.between]: [startOfMonth, endOfMonth] },
        },
        attributes: [
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
          [sequelize.fn("SUM", sequelize.col("total")), "total"],
        ],
        raw: true,
      }),
    ]);

    // Buscar agendamentos (hoje, semana, mês)
    const [appointmentsToday, appointmentsWeek, appointmentsMonth] =
      await Promise.all([
        Appointment.findAll({
          where: {
            usersId: req.user.establishment,
            date: today.toISOString().split("T")[0],
          },
          attributes: ["id", "serviceId"],
          raw: true,
        }),
        Appointment.findAll({
          where: {
            usersId: req.user.establishment,
            date: {
              [Op.between]: [
                startOfWeek.toISOString().split("T")[0],
                endOfWeek.toISOString().split("T")[0],
              ],
            },
          },
          attributes: ["id", "serviceId"],
          raw: true,
        }),
        Appointment.findAll({
          where: {
            usersId: req.user.establishment,
            date: {
              [Op.between]: [
                startOfMonth.toISOString().split("T")[0],
                endOfMonth.toISOString().split("T")[0],
              ],
            },
          },
          attributes: ["id", "serviceId"],
          raw: true,
        }),
      ]);

    // Buscar todos os serviços necessários de uma vez
    const allServiceIds = [
      ...appointmentsToday,
      ...appointmentsWeek,
      ...appointmentsMonth,
    ]
      .map((app) => app.serviceId)
      .filter((id, index, self) => self.indexOf(id) === index); // Remove duplicados

    const services = await Services.findAll({
      where: {
        id: { [Op.in]: allServiceIds },
      },
      attributes: ["id", "price"],
      raw: true,
    });

    // Criar mapa de preços
    const servicePrices = services.reduce((acc, service) => {
      acc[service.id] = parseFloat(service.price) || 0;
      return acc;
    }, {});

    // Função para calcular total dos agendamentos
    const calculateAppointmentsTotal = (appointments) => {
      return appointments.reduce(
        (total, app) => total + (servicePrices[app.serviceId] || 0),
        0
      );
    };

    const formatData = (salesData, appointmentsCount, appointmentsTotal) => ({
      sales: {
        count: Number(salesData[0]?.count || 0),
        total: Number(salesData[0]?.total || 0),
      },
      appointments: {
        count: appointmentsCount,
        total: appointmentsTotal,
      },
    });

    res.json({
      message: "Dados financeiros encontrados com sucesso",
      data: {
        today: formatData(
          salesToday,
          appointmentsToday.length,
          calculateAppointmentsTotal(appointmentsToday)
        ),
        week: formatData(
          salesWeek,
          appointmentsWeek.length,
          calculateAppointmentsTotal(appointmentsWeek)
        ),
        month: formatData(
          salesMonth,
          appointmentsMonth.length,
          calculateAppointmentsTotal(appointmentsMonth)
        ),
      },
    });
  } catch (error) {
    console.error("Erro ao buscar dados financeiros:", error);
    res.status(500).json({
      message: "Erro ao buscar dados financeiros",
      error: error.message,
    });
  }
});

router.get("/monthly-stats-detailed/:year/:month", authenticate, async (req, res) => {
  try {
    const normalizeServiceCategoryLabel = (rawCategory = "", rawServiceName = "") => {
      const category = String(rawCategory || "").trim();
      const serviceName = String(rawServiceName || "").trim();
      const source = `${category} ${serviceName}`.toLowerCase();

      if (source.includes("cirurg")) return "Cirurgias";
      if (source.includes("consult") || source.includes("clinica") || source.includes("clínica")) return "Consultas";
      if (source.includes("estet") || source.includes("estét") || source.includes("banho") || source.includes("tosa")) return "Estética";
      if (category) return category;
      if (serviceName) return serviceName;
      return "Outros";
    };

    const year = parseInt(req.params.year, 10);
    const month = parseInt(req.params.month, 10);
    const seller = String(req.query.seller || "").trim();

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({
        message: "Ano ou mês inválido",
      });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const usersId = req.user.establishment;

    const allAppointments = await Appointment.findAll({
      where: {
        usersId,
        date: {
          [Op.between]: [startDate, endDate],
        },
        status: {
          [Op.notIn]: ["cancelado", "Cancelado"],
        },
      },
      include: [
        {
          model: Services,
          attributes: ["id", "name", "price", "category"],
        },
        {
          model: Users,
          as: "responsible",
          attributes: ["id", "name"],
          required: false,
        },
      ],
    });

    const allSales = await Sales.findAll({
      where: {
        usersId,
        createdAt: {
          [Op.between]: [startDate, endDate],
        },
        status: "pago",
      },
    });

    const sellerIds = Array.from(
      new Set(
        [
          ...allAppointments.map((appointment) => String(appointment.responsibleId || "").trim()),
          ...allSales.map((sale) => String(sale.responsible || "").trim()),
        ].filter(Boolean),
      ),
    );

    const sellerUsers = sellerIds.length
      ? await Users.findAll({
          where: {
            id: {
              [Op.in]: sellerIds,
            },
          },
          attributes: ["id", "name"],
        })
      : [];

    const sellerNameById = sellerUsers.reduce((acc, user) => {
      acc[String(user.id)] = user.name;
      return acc;
    }, {});

    const sellerStatsMap = {};

    const ensureSellerStats = (sellerId, fallbackName = "") => {
      const normalizedId = String(sellerId || "").trim();
      if (!normalizedId) return null;

      if (!sellerStatsMap[normalizedId]) {
        sellerStatsMap[normalizedId] = {
          id: normalizedId,
          name: sellerNameById[normalizedId] || fallbackName || "Sem nome",
          appointmentsCount: 0,
          salesCount: 0,
          aestheticValue: 0,
          clinicalValue: 0,
          salesValue: 0,
          totalValue: 0,
        };
      }

      return sellerStatsMap[normalizedId];
    };

    allAppointments.forEach((appointment) => {
      const sellerStats = ensureSellerStats(
        appointment.responsibleId,
        appointment.responsible?.name || "",
      );
      if (!sellerStats) return;

      const value = appointment.Service ? parseFloat(appointment.Service.price) || 0 : 0;
      sellerStats.appointmentsCount += 1;
      sellerStats.totalValue += value;

      if (appointment.Service && appointment.Service.category) {
        const category = String(appointment.Service.category || "").toLowerCase();
        if (category.includes("clínica") || category.includes("clinica")) {
          sellerStats.clinicalValue += value;
        } else if (category.includes("estética") || category.includes("estetica")) {
          sellerStats.aestheticValue += value;
        }
      }
    });

    allSales.forEach((sale) => {
      const sellerStats = ensureSellerStats(sale.responsible);
      if (!sellerStats) return;

      const saleTotal = parseFloat(sale.total) || 0;
      sellerStats.salesCount += 1;
      sellerStats.salesValue += saleTotal;
      sellerStats.totalValue += saleTotal;
    });

    const appointments =
      seller && seller !== "all"
        ? allAppointments.filter((appointment) => String(appointment.responsibleId || "") === seller)
        : allAppointments;
    const sales =
      seller && seller !== "all"
        ? allSales.filter((sale) => String(sale.responsible || "") === seller)
        : allSales;

    const stats = {
      patients: {
        count: 0,
        uniqueCount: new Set(),
        value: 0,
      },
      clinicalAppointments: {
        count: 0,
        value: 0,
      },
      aestheticAppointments: {
        count: 0,
        value: 0,
      },
      products: {
        count: 0,
        value: 0,
      },
      serviceCategories: {},
      sellers: Object.values(sellerStatsMap).sort((left, right) => left.name.localeCompare(right.name)),
    };

    appointments.forEach((appointment) => {
      if (appointment.clientId) {
        stats.patients.uniqueCount.add(appointment.clientId);
      }

      const value = appointment.Service ? parseFloat(appointment.Service.price) || 0 : 0;
      const normalizedCategory = normalizeServiceCategoryLabel(
        appointment.Service?.category,
        appointment.Service?.name,
      );

      if (!stats.serviceCategories[normalizedCategory]) {
        stats.serviceCategories[normalizedCategory] = {
          label: normalizedCategory,
          count: 0,
          value: 0,
        };
      }
      stats.serviceCategories[normalizedCategory].count += 1;
      stats.serviceCategories[normalizedCategory].value += value;

      if (appointment.Service && appointment.Service.category) {
        const category = String(appointment.Service.category || "").toLowerCase();
        if (category.includes("clínica") || category.includes("clinica")) {
          stats.clinicalAppointments.count++;
          stats.clinicalAppointments.value += value;
        } else if (category.includes("estética") || category.includes("estetica")) {
          stats.aestheticAppointments.count++;
          stats.aestheticAppointments.value += value;
        }
      }
    });

    sales.forEach((sale) => {
      const saleTotal = parseFloat(sale.total) || 0;
      const quantity = parseInt(sale.quantity) || 1;
      stats.products.value += saleTotal;
      stats.products.count += quantity;
    });

    stats.patients.count = stats.clinicalAppointments.count + stats.aestheticAppointments.count;
    delete stats.patients.uniqueCount;
    stats.patients.value = stats.clinicalAppointments.value + stats.aestheticAppointments.value;
    stats.serviceCategories = Object.values(stats.serviceCategories).sort((left, right) => right.value - left.value);

    res.json({
      message: "Estatísticas mensais detalhadas encontradas com sucesso",
      data: stats,
    });
  } catch (error) {
    console.error("Erro ao buscar estatísticas mensais detalhadas:", error);
    res.status(500).json({
      message: "Erro ao buscar estatísticas mensais detalhadas",
      error: error.message,
    });
  }
});

// Rota para obter resumo financeiro do dia
router.get("/summary/:date", authenticate, async (req, res) => {
  try {
    const { date } = req.params;

    const appointments = await Appointment.findAll({
      where: {
        usersId: req.user.establishment,
        date: date,
      },
    });
    const finances = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        type: "saida",
        status: "pendente",
        dueDate: {
          [Op.between]: [
            new Date(date + "T00:00:00.000Z"),
            new Date(date + "T23:59:59.999Z"),
          ],
        },
      },
    });

    const faturamentoHoje = await Finance.findAll({
      where: {
        usersId: req.user.establishment,
        type: "entrada",
        status: "Pago",
        dueDate: {
          [Op.between]: [
            new Date(date + "T00:00:00.000Z"),
            new Date(date + "T23:59:59.999Z"),
          ],
        },
      },
    });

    res.status(200).json({
      message: "Resumo financeiro encontrado com sucesso",
      data: {
        faturamentoHoje: faturamentoHoje
          .reduce((sum, finance) => sum + parseFloat(finance.amount), 0)
          .toFixed(2),
        agendamentoHoje: appointments.length,
        despesasHoje: finances
          .reduce((sum, finance) => sum + parseFloat(finance.amount), 0)
          .toFixed(2),
      },
    });
  } catch (error) {
    console.error("Erro ao buscar resumo financeiro:", error);
    return res.status(500).json({
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

// Endpoint para calcular valores financeiros de um agendamento/pacote
router.get(
  "/finance/calculate/:appointmentId",
  authenticate,
  async (req, res) => {
    try {
      const { appointmentId } = req.params;

      // Buscar o agendamento principal com as relações básicas
      const appointment = await Appointment.findByPk(appointmentId, {
        include: [
          {
            model: Services,
            as: "Service",
            attributes: ["id", "name", "price"],
          },
          {
            model: Finance,
            as: "finance",
            attributes: ["id", "status", "amount"],
          },
        ],
      });

      if (!appointment) {
        return res.status(404).json({
          error: "Agendamento não encontrado",
        });
      }

      // Calcular valor base do serviço principal
      const servicePrice = parseFloat(appointment.Service?.price || 0);

      // Para pegar serviços secundários e terciários, vamos buscar pelos IDs diretamente
      let secondaryService = null;
      let tertiaryService = null;

      if (appointment.secondaryServiceId) {
        secondaryService = await Services.findByPk(
          appointment.secondaryServiceId,
          {
            attributes: ["id", "name", "price"],
          }
        );
      }

      if (appointment.tertiaryServiceId) {
        tertiaryService = await Services.findByPk(
          appointment.tertiaryServiceId,
          {
            attributes: ["id", "name", "price"],
          }
        );
      }

      const secondaryServicePrice = parseFloat(secondaryService?.price || 0);
      const tertiaryServicePrice = parseFloat(tertiaryService?.price || 0);

      const totalServicePrice =
        servicePrice + secondaryServicePrice + tertiaryServicePrice;

      let result = {
        totalContracted: 0,
        totalPaid: 0,
        totalRemaining: 0,
        isPackage: false,
        packageInfo: null,
      };

      // Verificar se é um pacote
      if (appointment.package && appointment.packageMax) {
        result.isPackage = true;
        const totalSessions = appointment.packageMax;
        result.totalContracted = totalServicePrice * totalSessions;

        // Buscar todos os agendamentos do mesmo pacote
        const packageAppointments = await Appointment.findAll({
          where: {
            petId: appointment.petId,
            customerId: appointment.customerId,
            package: appointment.package,
            packageMax: appointment.packageMax,
            usersId: req.user.establishment,
          },
          include: [
            {
              model: Finance,
              as: "finance",
              attributes: ["id", "status", "amount"],
            },
          ],
          order: [["packageNumber", "ASC"]],
        });

        // Contar sessões pagas
        const paidSessions = packageAppointments.filter(
          (apt) => apt.finance?.status?.toLowerCase() === "pago"
        ).length;

        result.totalPaid = paidSessions * totalServicePrice;
        result.totalRemaining = Math.max(
          0,
          result.totalContracted - result.totalPaid
        );

        result.packageInfo = {
          sessionsCompleted: appointment.packageNumber || 0,
          totalSessions: totalSessions,
          paidSessions: paidSessions,
          sessionPrice: totalServicePrice,
        };
      } else {
        // Agendamento individual
        result.totalContracted = totalServicePrice;

        if (appointment.finance?.status?.toLowerCase() === "pago") {
          result.totalPaid = totalServicePrice;
        } else {
          result.totalPaid = 0;
        }

        result.totalRemaining = Math.max(
          0,
          result.totalContracted - result.totalPaid
        );
      }

      res.json(result);
    } catch (error) {
      console.error("Erro ao calcular valores financeiros:", error);
      res.status(500).json({
        error: "Erro interno do servidor",
        details: error.message,
      });
    }
  }
);

// Endpoint para pagar pacote completo (POST /finance/pay-package)
router.post("/finance/pay-package", authenticate, async (req, res) => {
  try {
    const { appointmentId, paymentMethod, paymentStatus = "pago" } = req.body;

    // Buscar o agendamento para identificar o pacote
    const appointment = await Appointment.findByPk(appointmentId, {
      include: [
        {
          model: Services,
          as: "Service",
          attributes: ["id", "name", "price"],
        },
        {
          model: Finance,
          as: "finance",
          attributes: ["id", "status", "amount"],
        },
      ],
    });

    if (!appointment) {
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }

    if (!appointment.package || !appointment.packageMax) {
      return res
        .status(400)
        .json({ error: "Este agendamento não é um pacote" });
    }

    // Buscar todas as sessões do mesmo pacote
    const packageAppointments = await Appointment.findAll({
      where: {
        petId: appointment.petId,
        customerId: appointment.customerId,
        package: appointment.package,
        packageMax: appointment.packageMax,
        usersId: req.user.establishment,
      },
      include: [
        {
          model: Finance,
          as: "finance",
          attributes: ["id", "status", "amount"],
        },
      ],
    });

    // Calcular valor por sessão
    let valorServicos = parseFloat(appointment.Service?.price || 0);

    // Buscar serviços secundários e terciários se existirem
    if (appointment.secondaryServiceId) {
      const secondaryService = await Services.findByPk(
        appointment.secondaryServiceId
      );
      valorServicos += parseFloat(secondaryService?.price || 0);
    }

    if (appointment.tertiaryServiceId) {
      const tertiaryService = await Services.findByPk(
        appointment.tertiaryServiceId
      );
      valorServicos += parseFloat(tertiaryService?.price || 0);
    }

    const totalPackageValue = valorServicos * appointment.packageMax;

    // Atualizar ou criar registros financeiros para todas as sessões
    const updatePromises = packageAppointments.map(async (apt) => {
      if (apt.finance) {
        // Atualizar registro existente
        return await Finance.update(
          {
            status: paymentStatus,
            paymentMethod: paymentMethod,
            amount: valorServicos,
            updatedAt: new Date(),
          },
          {
            where: { id: apt.finance.id },
          }
        );
      } else {
        // Criar novo registro financeiro
        return await Finance.create({
          appointmentId: apt.id,
          status: paymentStatus,
          paymentMethod: paymentMethod,
          amount: valorServicos,
          type: "receita",
          description: `Pagamento pacote - Sessão ${apt.packageNumber}/${apt.packageMax}`,
          usersId: req.user.establishment,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: `Pacote pago com sucesso! ${packageAppointments.length} sessões atualizadas.`,
      data: {
        packageId: appointment.package,
        totalSessions: packageAppointments.length,
        totalAmount: totalPackageValue,
        paymentMethod,
        paymentStatus,
      },
    });
  } catch (error) {
    console.error("Erro ao pagar pacote completo:", error);
    res.status(500).json({
      error: "Erro interno do servidor",
      details: error.message,
    });
  }
});

export default router;
