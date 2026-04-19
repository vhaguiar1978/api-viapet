import express from "express";
import Appointment from "../models/Appointment.js";
import auth from "../middlewares/auth.js";
import Pets from "../models/Pets.js";
import Custumers from "../models/Custumers.js";
import Services from "../models/Services.js";
import Settings from "../models/Settings.js";
import Users from "../models/Users.js";
import AppointmentItem from "../models/AppointmentItem.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import AppointmentStatusHistory from "../models/AppointmentStatusHistory.js";
import { Op } from "sequelize";
import {
  mensagemPacotinho,
  mensagemAgendamento,
  mensagemMotorista,
} from "../service/whatsapp.js";
import Finance from "../models/Finance.js";
import Sales from "../models/Sales.js";
import SaleItems from "../models/SaleItem.js";
import Products from "../models/Products.js";
import sequelize from "../database/config.js";
import Drivers from "../models/Drivers.js";
import {
  hydrateAppointmentsWithFinancialDetails,
  syncAppointmentFinance,
} from "../service/appointmentFinance.js";

const router = express.Router();

const REQUIRED_APPOINTMENT_FIELDS = [
  "petId",
  "customerId",
  "serviceId",
  "type",
  "date",
  "time",
];

function getMissingRequiredFields(payload, requiredFields) {
  return requiredFields.filter((field) => {
    const value = payload?.[field];
    return value === undefined || value === null || value === "";
  });
}

function isComandaManagedFinanceReference(reference) {
  return /^appointment_(payment:|balance:|free:)/.test(String(reference || ""));
}

function buildAppointmentFinancePayload({
  description,
  totalAmount,
  date,
  type,
  observation,
  userId,
  establishmentId,
}) {
  return {
    type: "entrada",
    description,
    amount: totalAmount,
    date: new Date(date),
    dueDate: new Date(date),
    category: "Serviços",
    subCategory: type,
    expenseType: "variavel",
    frequency: "unico",
    paymentMethod: "Pendente",
    status: "pendente",
    reference: "appointment",
    notes: observation,
    createdBy: userId,
    usersId: establishmentId,
  };
}

function decodeDriverChecklistToken(token) {
  try {
    if (!token) return null;
    const decoded = Buffer.from(String(token), "base64").toString("utf8");
    const payload = JSON.parse(decoded);
    return {
      date: String(payload?.date || "").slice(0, 10),
      rows: Array.isArray(payload?.rows) ? payload.rows : [],
    };
  } catch {
    return null;
  }
}

function normalizeAgendaTypeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesRequestedAgendaType(appointment, requestedType) {
  const normalizedType = normalizeAgendaTypeText(requestedType);
  if (!normalizedType || !["estetica", "clinica"].includes(normalizedType)) {
    return true;
  }

  const serviceText = normalizeAgendaTypeText(
    `${appointment?.Service?.name || ""} ${appointment?.Service?.category || ""}`,
  );
  const nameText = normalizeAgendaTypeText(appointment?.Service?.name || "");
  const explicitType = normalizeAgendaTypeText(appointment?.type || "");
  const nameLooksAesthetic = /banho|tosa|estetica|hidrat/.test(nameText);
  const nameLooksClinic = /clinica|consulta|exame|vacina|procedimento|cirurgia|retorno|atendimento/.test(nameText);
  const serviceLooksAesthetic = nameLooksAesthetic || (!nameLooksClinic && /banho|tosa|estetica|hidrat/.test(serviceText));
  const serviceLooksClinic = nameLooksClinic || (!nameLooksAesthetic && /clinica|consulta|exame|vacina|procedimento|cirurgia/.test(serviceText));

  if (normalizedType === "estetica") {
    return serviceLooksAesthetic || (explicitType === "estetica" && !serviceLooksClinic);
  }

  return serviceLooksClinic || (explicitType === "clinica" && !serviceLooksAesthetic);
}

const SHARED_DRIVER_CHECKLIST_STATUSES = [
  "Buscar pet",
  "Entregar pet",
  "Sem status",
  "Realizado",
];

async function updateSharedDriverChecklistStatus(req, res, nextStatus) {
  const { id } = req.params;
  const checklist = decodeDriverChecklistToken(req.body?.token);

  if (!checklist || !checklist.rows.some((row) => String(row?.id) === String(id))) {
    return res.status(403).json({
      message: "Link do motorista invalido ou expirado.",
    });
  }

  if (!SHARED_DRIVER_CHECKLIST_STATUSES.includes(nextStatus)) {
    return res.status(400).json({
      message: 'Status invalido. Use "Buscar pet", "Entregar pet", "Realizado" ou "Sem status".',
    });
  }

  const appointment = await Appointment.findByPk(id);
  if (!appointment) {
    return res.status(404).json({
      message: "Agendamento nao encontrado",
    });
  }

  const appointmentDate = String(appointment.date || "").slice(0, 10);
  if (checklist.date && appointmentDate && checklist.date !== appointmentDate) {
    return res.status(409).json({
      message: "Esse servico nao pertence a data desta lista.",
    });
  }

  await appointment.update({ driver_status: nextStatus });

  if (["Buscar pet", "Entregar pet"].includes(nextStatus)) {
    try {
      await mensagemMotorista(id, nextStatus);
      return res.status(200).json({
        message: "Status do motorista atualizado com sucesso",
        data: {
          appointmentId: appointment.id,
          driverStatus: appointment.driver_status,
        },
      });
    } catch (messageError) {
      console.error("Erro ao enviar mensagem do motorista:", messageError);
      return res.status(200).json({
        message: "Status atualizado, mas houve um erro ao enviar a mensagem",
        data: {
          appointmentId: appointment.id,
          driverStatus: appointment.driver_status,
        },
        messageError: messageError.message,
      });
    }
  }

  return res.status(200).json({
    message: "Status do motorista atualizado com sucesso",
    data: {
      appointmentId: appointment.id,
      driverStatus: appointment.driver_status,
    },
  });
}

// Criar novo agendamento
router.post("/appointments", auth, async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const missingFields = getMissingRequiredFields(
      req.body,
      REQUIRED_APPOINTMENT_FIELDS,
    );
    if (missingFields.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        message: "Dados obrigatorios ausentes",
        missingFields,
      });
    }
    const {
      petId,
      customerId,
      serviceId,
      responsibleId,
      sellerName,
      type,
      date,
      time,
      observation,
      secondaryServiceId,
      tertiaryServiceId,
      instagram,
      facebook,
      whatsapp,
      tiktok,
      skipFinance,
      packageGroupId,
      package: isPackage,
      packageNumber,
      packageMax,
    } = req.body;

    // Verifica se o pet existe e pertence ao estabelecimento
    const pet = await Pets.findOne({
      where: {
        id: petId,
        usersId: req.user.establishment,
      },
      transaction,
    });

    if (!pet) {
      await transaction.rollback();
      return res.status(404).json({ message: "Pet não encontrado" });
    }

    // Busca o cliente para enviar mensagem
    const customer = await Custumers.findOne({
      where: {
        id: customerId,
        usersId: req.user.establishment,
      },
      transaction,
    });

    if (!customer) {
      await transaction.rollback();
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    // Busca o serviço para incluir na mensagem e valor
    const service = await Services.findOne({
      where: {
        id: serviceId,
        establishment: req.user.establishment,
      },
      transaction,
    });

    if (!service) {
      await transaction.rollback();
      return res.status(404).json({ message: "Serviço não encontrado" });
    }

    // Calcula o valor total do agendamento
    let totalAmount = Number(service.price || 0);

    // Adiciona valores de serviços secundários e terciários se existirem
    if (secondaryServiceId) {
      const secondaryService = await Services.findOne({
        where: {
          id: secondaryServiceId,
          establishment: req.user.establishment,
        },
      });
      if (secondaryService) {
        totalAmount += Number(secondaryService.price || 0);
      }
    }

    if (tertiaryServiceId) {
      const tertiaryService = await Services.findOne({
        where: {
          id: tertiaryServiceId,
          establishment: req.user.establishment,
        },
      });
      if (tertiaryService) {
        totalAmount += Number(tertiaryService.price || 0);
      }
    }

    // Cria a transação financeira
    const finance = skipFinance ? null : await Finance.create({
      type: "entrada",
      description: `Agendamento - ${service.name} - ${pet.name}`,
      amount: totalAmount,
      date: new Date(date),
      dueDate: new Date(date),
      category: "Serviços",
      subCategory: type,
      expenseType: "variavel",
      frequency: "unico",
      paymentMethod: "Pendente",
      status: "pendente",
      reference: "appointment",
      notes: observation,
      createdBy: req.user.id,
      usersId: req.user.establishment,
    }, { transaction });

    const appointment = await Appointment.create({
      usersId: req.user.establishment,
      petId,
      customerId,
      serviceId,
      responsibleId,
      sellerName,
      type,
      date,
      time,
      observation,
      secondaryServiceId,
      tertiaryServiceId,
      instagram,
      facebook,
      whatsapp,
      tiktok,
      financeId: finance?.id || null,
      package: Boolean(isPackage) || Number(packageMax || 0) > 1,
      packageNumber:
        packageNumber !== undefined && packageNumber !== null && String(packageNumber).trim() !== ""
          ? Number(packageNumber)
          : null,
      packageMax:
        packageMax !== undefined && packageMax !== null && String(packageMax).trim() !== ""
          ? Number(packageMax)
          : null,
      packageGroupId: packageGroupId || null,
    }, { transaction });

    // Busca as configurações de mensagem do WhatsApp
    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
      transaction,
    });

    // Verifica se o cliente tem telefone e se as configurações permitem envio de mensagem
    await transaction.commit();

    if (customer.phone && settings?.notifyClient) {
      try {
        await mensagemAgendamento(appointment.id);
      } catch (notifyError) {
        console.error(
          "Erro ao enviar mensagem de confirmação do agendamento:",
          notifyError,
        );
      }
    }

    return res.status(201).json({
      message: "Agendamento criado com sucesso",
      data: appointment,
    });
  } catch (error) {
    if (!transaction.finished) {
      await transaction.rollback();
    }
    console.error("Erro ao criar agendamento:", error);
    return res.status(500).json({
      message: "Erro ao criar agendamento",
      error: error.message,
    });
  }
});
router.get("/appointments/monthly", auth, async (req, res) => {
  try {
    let { month, year, responsibleId } = req.query; // Usar let para permitir modificação

    if (!month || !year) {
      return res.status(400).json({
        message: "Mês e ano são obrigatórios como parâmetros de consulta.",
      });
    }

    // Garantir que month e year sejam números inteiros válidos
    month = parseInt(month, 10);
    year = parseInt(year, 10);

    // Verificar se a conversão resultou em NaN
    if (isNaN(month) || isNaN(year)) {
      return res.status(400).json({
        message: "Mês e ano devem ser valores numéricos válidos.",
      });
    }

    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const startOfNextMonth = new Date(
      Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 0, 0, 0, 0),
    );

    const where = {
      usersId: req.user.establishment,
      date: {
        [Op.gte]: startOfMonth,
        [Op.lt]: startOfNextMonth,
      },
    };

    if (responsibleId) {
      where.responsibleId = responsibleId;
    }

    const appointments = await Appointment.findAll({
      where,
      include: [
        {
          model: Pets,
          as: "Pet",
        },
        {
          model: Custumers,
          as: "Custumer",
        },
        {
          model: Services,
          as: "Service",
        },
        {
          model: Users,
          as: "responsible",
        },
        {
          model: Finance,
          as: "finance",
        },
      ],
      order: [
        ["date", "ASC"],
        ["time", "ASC"],
      ],
    });
    const hydratedAppointments = await hydrateAppointmentsWithFinancialDetails(
      appointments,
      req.user.establishment,
      { includePackageContext: true },
    );

    // Calcular dados agregados
    let quantidadePacientesAtendidos = new Set();
    let quantidadeAgendamentosClinica = 0;
    let quantidadeAgendamentosEstetica = 0;
    let quantidadeAgendamentosInternacao = 0;
    let quantidadeServicos = 0;
    let totalFaturado = 0;

    hydratedAppointments.forEach((appointment) => {
      quantidadePacientesAtendidos.add(appointment.customerId);
      const summary = appointment.summary || {};
      const normalizedType = String(appointment.type || "").trim().toLowerCase();

      if (normalizedType === "clinica") {
        quantidadeAgendamentosClinica++;
      } else if (normalizedType === "estetica") {
        quantidadeAgendamentosEstetica++;
      } else if (normalizedType === "internacao") {
        quantidadeAgendamentosInternacao++;
      }
      quantidadeServicos += Math.max(
        Number(summary?.servicesCount || 0) || 0,
        Number(summary?.itemCount || 0) || 0,
        1,
      );
      totalFaturado += Number(summary?.paid || appointment?.finance?.amount || 0) || 0;
    });

    const dadosAgregados = {
      quantidadePacientesAtendidos: quantidadePacientesAtendidos.size,
      quantidadeAgendamentosClinica,
      quantidadeAgendamentosEstetica,
      quantidadeAgendamentosInternacao,
      quantidadeServicos,
      totalFaturado: totalFaturado.toFixed(2),
    };

    return res.status(200).json({
      message: "Agendamentos e dados mensais encontrados com sucesso.",
      data: {
        appointments: hydratedAppointments,
        dadosAgregados,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar agendamentos e dados mensais:", error);
    return res.status(500).json({
      message: "Erro ao buscar agendamentos e dados mensais",
      error: error.message,
    });
  }
});
// Listar agendamentos
router.get("/appointments", auth, async (req, res) => {
  try {
    const { date, startDate, endDate, status, type } = req.query;
    const useHydratedResponse = String(req.query?.hydrated || "") === "1";
    const includePackageContext = String(req.query?.packageContext || "") === "1";

    const where = {
      usersId: req.user.establishment,
    };

    if (date) {
      where.date = date;
    } else if (startDate && endDate) {
      where.date = {
        [Op.gte]: startDate,
        [Op.lte]: endDate,
      };
    }
    if (status) {
      where.status = status;
    }
    const requestedAgendaType = type;
    if (type && !["estetica", "clinica"].includes(normalizeAgendaTypeText(type))) {
      where.type = type;
    }

    const appointments = await Appointment.findAll({
      where,
      include: [
        {
          model: Pets,
          as: "Pet",
        },
        {
          model: Custumers,
          as: "Custumer",
        },
        {
          model: Services,
          as: "Service",
        },
        {
          model: Users,
          as: "responsible",
        },
        {
          model: Finance,
          as: "finance",
        },
        {
          model: Drivers,
          as: "driver",
        },
      ],
      order: [
        ["date", "ASC"],
        ["time", "ASC"],
      ],
    });

    // Buscar informações adicionais para cada agendamento
    let appointmentsWithDetails = [];

    if (useHydratedResponse) {
      appointmentsWithDetails = await hydrateAppointmentsWithFinancialDetails(
        appointments,
        req.user.establishment,
        { includePackageContext },
      );
    } else {
      appointmentsWithDetails = await Promise.all(
      appointments.map(async (appointment) => {
        const pet = await Pets.findByPk(appointment.petId);
        const customer = await Custumers.findByPk(appointment.customerId);
        const service = await Services.findByPk(appointment.serviceId);
        const responsible = await Users.findByPk(appointment.responsibleId);
        let finance = await Finance.findByPk(appointment.financeId);
        const driver = await Drivers.findByPk(appointment.driverId);

        // Buscar vendas relacionadas ao agendamento
        const sales = await Sales.findAll({
          where: { appointmentId: appointment.id },
        });

        // Para cada venda, buscar seus itens e status financeiro
        const salesWithItems = await Promise.all(
          sales.map(async (sale) => {
            const saleItems = await SaleItems.findAll({
              where: { saleId: sale.id },
            });

            // Para cada item, buscar informações do produto
            const itemsWithProducts = await Promise.all(
              saleItems.map(async (item) => {
                const product = await Products.findByPk(item.productId);
                return {
                  ...item.dataValues,
                  product: product,
                };
              }),
            );

            // Buscar o registro financeiro da venda
            const saleFinance = await Finance.findOne({
              where: { reference: sale.id },
            });

            return {
              ...sale.dataValues,
              saleItems: itemsWithProducts,
              status: saleFinance?.status || "pendente",
            };
          }),
        );

        let totalAmount = Number(service?.price || 0);
        let secondaryService = null;
        let tertiaryService = null;

        if (appointment.secondaryServiceId) {
          secondaryService = await Services.findByPk(
            appointment.secondaryServiceId,
          );
          totalAmount += Number(secondaryService?.price || 0);
        }

        if (appointment.tertiaryServiceId) {
          tertiaryService = await Services.findByPk(
            appointment.tertiaryServiceId,
          );
          totalAmount += Number(tertiaryService?.price || 0);
        }

        // Se não houver transação financeira, criar uma
        if (false && !finance) {
          const newFinance = await Finance.create({
            type: "entrada",
            description: `Agendamento - ${service?.name} - ${pet?.name}`,
            amount: totalAmount,
            date: new Date(appointment.date),
            dueDate: new Date(appointment.date),
            category: "Serviços",
            subCategory: appointment.type,
            expenseType: "variavel",
            frequency: "unico",
            paymentMethod: "Pendente",
            status: "pendente",
            reference: "appointment",
            createdBy: req.user.id,
            usersId: req.user.establishment,
          });

          // Atualizar o financeId no agendamento
          await Appointment.update(
            { financeId: newFinance.id },
            { where: { id: appointment.id } },
          );

          finance = newFinance;
        }
        // Se houver transação mas o valor estiver diferente, atualizar
        else if (false && finance.amount !== totalAmount) {
          await Finance.update(
            { amount: totalAmount },
            { where: { id: finance.id } },
          );
          finance.amount = totalAmount;
        }

        return {
          ...appointment.dataValues,
          Pet: pet,
          Custumer: customer,
          Service: service,
          responsible: responsible,
          finance: finance,
          driver: driver,
          secondaryService,
          tertiaryService,
          totalAmount,
          sales: salesWithItems,
        };
      }),
    );
    }

    const filteredAppointments = appointmentsWithDetails.filter((appointment) =>
      matchesRequestedAgendaType(appointment, requestedAgendaType),
    );

    return res.json({
      message: "Agendamentos encontrados com sucesso",
      data: filteredAppointments,
    });
  } catch (error) {
    console.error("Erro ao buscar agendamentos:", error);
    return res.status(500).json({
      message: "Erro ao buscar agendamentos",
      error: error.message,
    });
  }
});
// Atribuir motorista ao agendamento
router.patch("/appointments/:id/driver/:driverId", auth, async (req, res) => {
  try {
    const { id, driverId } = req.params;

    // Buscar o agendamento
    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!appointment) {
      return res.status(404).json({
        message: "Agendamento não encontrado",
      });
    }

    // Se driverId for null, limpa o motorista do agendamento
    if (driverId == "null") {
      await appointment.update({ driverId: null });
      return res.status(200).json({
        message: "Motorista removido com sucesso",
        data: {
          appointmentId: id,
          driverId: null,
        },
      });
    }

    // Verificar se o motorista existe e pertence ao estabelecimento
    const driver = await Drivers.findOne({
      where: {
        id: driverId,
        usersId: req.user.establishment,
      },
    });

    if (!driver) {
      return res.status(404).json({
        message: "Motorista não encontrado",
      });
    }

    // Atualizar o agendamento com o motorista
    await appointment.update({ driverId });

    return res.status(200).json({
      message: "Motorista atribuído com sucesso",
      data: {
        appointmentId: id,
        driverId,
      },
    });
  } catch (error) {
    console.error("Erro ao atribuir motorista:", error);
    return res.status(500).json({
      message: "Erro ao atribuir motorista",
      error: error.message,
    });
  }
});

// Atualizar status do agendamento
router.patch("/appointments/:id/status", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
      include: [
        {
          model: Services,
          attributes: ["name", "price"],
        },
        {
          model: Custumers,
          attributes: ["name"],
        },
      ],
    });

    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    await appointment.update({ status });

    return res.status(200).json({
      message: "Status do agendamento atualizado com sucesso",
      data: appointment,
    });
  } catch (error) {
    console.error("Erro ao atualizar status do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao atualizar status do agendamento",
      error: error.message,
    });
  }
});

// Marcar servico do motorista como realizado pelo link compartilhado
router.patch("/appointments/driver-checklist/:id/ok", async (req, res) => {
  try {
    return await updateSharedDriverChecklistStatus(req, res, "Realizado");
  } catch (error) {
    console.error("Erro ao marcar servico do motorista:", error);
    return res.status(500).json({
      message: "Erro ao marcar servico do motorista",
      error: error.message,
    });
  }
});

router.patch("/appointments/driver-checklist/:id/status", async (req, res) => {
  try {
    const nextStatus = String(req.body?.status || "").trim();
    return await updateSharedDriverChecklistStatus(req, res, nextStatus);
  } catch (error) {
    console.error("Erro ao atualizar status compartilhado do motorista:", error);
    return res.status(500).json({
      message: "Erro ao atualizar status compartilhado do motorista",
      error: error.message,
    });
  }
});

// Atualizar status do motorista
router.patch("/appointments/:id/driver-status", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validar se o status foi fornecido
    if (!status) {
      return res.status(400).json({
        message: "Status é obrigatório",
      });
    }

    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });
    if (!appointment) {
      return res.status(404).json({
        message: "Agendamento não encontrado",
      });
    }

    // Validar se o status é válido
    if (!["Buscar pet", "Entregar pet", "Sem status", "Realizado"].includes(status)) {
      return res.status(400).json({
        message: 'Status invalido. Use "Buscar pet", "Entregar pet", "Realizado" ou "Sem status"',
      });
    }

    await appointment.update({ driver_status: status });

    // So envia mensagem para acoes de rota; OK/Realizado apenas atualiza a lista.
    if (["Buscar pet", "Entregar pet"].includes(status)) {
      try {
        await mensagemMotorista(id, status);
        return res.status(200).json({
          message: "Status do motorista atualizado com sucesso",
          data: appointment,
        });
      } catch (messageError) {
        console.error("Erro ao enviar mensagem:", messageError);
        // Ainda retorna sucesso na atualização, mas loga o erro da mensagem
        return res.status(200).json({
          message: "Status atualizado, mas houve um erro ao enviar a mensagem",
          data: appointment,
          messageError: messageError.message,
        });
      }
    }

    // Retorna sucesso sem tentar enviar mensagem para OK/Realizado ou Sem status.
    return res.status(200).json({
      message: "Status do motorista atualizado com sucesso",
      data: appointment,
    });
  } catch (error) {
    console.error("Erro ao atualizar status do motorista:", error);
    return res.status(500).json({
      message: "Erro ao atualizar status do motorista",
      error: error.message,
    });
  }
});

// Atualizar agendamento
router.put("/appointments/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customerId,
      petId,
      serviceId,
      type,
      responsibleId,
      sellerName,
      date,
      time,
      observation,
      status,
      instagram,
      facebook,
      whatsapp,
      tiktok,
      secondaryServiceId,
      tertiaryServiceId,
      skipFinance,
      packageGroupId,
      package: isPackage,
      packageNumber,
      packageMax,
    } = req.body;

    console.log("PUT /appointments/:id - Request Params:", req.params);
    console.log("PUT /appointments/:id - Request Body:", req.body);

    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Agendamento nao encontrado" });
    }

    const linkedFinance = appointment.financeId
      ? await Finance.findByPk(appointment.financeId)
      : null;
    const [appointmentItemsCount, appointmentPaymentsCount] = await Promise.all([
      AppointmentItem.count({
        where: {
          appointmentId: appointment.id,
          usersId: req.user.establishment,
        },
      }),
      AppointmentPayment.count({
        where: {
          appointmentId: appointment.id,
          usersId: req.user.establishment,
        },
      }),
    ]);
    const hasComandaData =
      appointmentItemsCount > 0 ||
      appointmentPaymentsCount > 0 ||
      isComandaManagedFinanceReference(linkedFinance?.reference);

    const resolvedServiceId = serviceId || appointment.serviceId;
    const mainService = await Services.findOne({
      where: {
        id: resolvedServiceId,
        establishment: req.user.establishment,
      },
    });
    let totalAmount = Number(mainService?.price || 0);

    if (secondaryServiceId) {
      const secondaryService = await Services.findOne({
        where: {
          id: secondaryServiceId,
          establishment: req.user.establishment,
        },
      });
      if (secondaryService) {
        totalAmount += Number(secondaryService.price || 0);
      }
    }

    if (tertiaryServiceId) {
      const tertiaryService = await Services.findOne({
        where: {
          id: tertiaryServiceId,
          establishment: req.user.establishment,
        },
      });
      if (tertiaryService) {
        totalAmount += Number(tertiaryService.price || 0);
      }
    }

    const financePet = await Pets.findByPk(petId || appointment.petId);
    const financeDescription = `Agendamento - ${mainService?.name || "Serviço"} - ${financePet?.name || "Pet"}`;

    const updateData = {
      customerId: customerId || appointment.customerId,
      petId: petId || appointment.petId,
      responsibleId:
        responsibleId !== undefined ? responsibleId : appointment.responsibleId,
      sellerName:
        sellerName !== undefined ? sellerName : appointment.sellerName,
      date: date || appointment.date,
      time: time || appointment.time,
      observation:
        observation !== undefined ? observation : appointment.observation,
      status: status || appointment.status,
      type: type || appointment.type,
      instagram: instagram !== undefined ? instagram : appointment.instagram,
      facebook: facebook !== undefined ? facebook : appointment.facebook,
      whatsapp: whatsapp !== undefined ? whatsapp : appointment.whatsapp,
      tiktok: tiktok !== undefined ? tiktok : appointment.tiktok,
      serviceId: resolvedServiceId,
      secondaryServiceId:
        secondaryServiceId !== undefined
          ? secondaryServiceId
          : appointment.secondaryServiceId,
      tertiaryServiceId:
        tertiaryServiceId !== undefined
          ? tertiaryServiceId
          : appointment.tertiaryServiceId,
      package:
        isPackage !== undefined
          ? Boolean(isPackage)
          : Number(packageMax || appointment.packageMax || 0) > 1 || Boolean(appointment.package),
      packageNumber:
        packageNumber !== undefined
          ? (packageNumber === null || String(packageNumber).trim() === "" ? null : Number(packageNumber))
          : appointment.packageNumber,
      packageMax:
        packageMax !== undefined
          ? (packageMax === null || String(packageMax).trim() === "" ? null : Number(packageMax))
          : appointment.packageMax,
      packageGroupId:
        packageGroupId !== undefined ? packageGroupId : appointment.packageGroupId,
    };

    console.log("PUT /appointments/:id - Update Data:", updateData);

    await Appointment.update(updateData, {
      where: { id: appointment.id },
    });

    if (hasComandaData) {
      await syncAppointmentFinance(appointment.id);
    } else if (skipFinance) {
      if (linkedFinance) {
        await linkedFinance.destroy();
      }
      await appointment.update({ financeId: null });
    } else if (appointment.financeId && linkedFinance) {
      await linkedFinance.update({
        ...buildAppointmentFinancePayload({
          description: financeDescription,
          totalAmount,
          date: date || appointment.date,
          type: type || appointment.type,
          observation:
            observation !== undefined ? observation : appointment.observation,
          userId: req.user.id,
          establishmentId: req.user.establishment,
        }),
      });
    } else if (!skipFinance) {
      const finance = await Finance.create(
        buildAppointmentFinancePayload({
          description: financeDescription,
          totalAmount,
          date: date || appointment.date,
          type: type || appointment.type,
          observation:
            observation !== undefined ? observation : appointment.observation,
          userId: req.user.id,
          establishmentId: req.user.establishment,
        }),
      );
      await appointment.update({ financeId: finance.id });
    }

    const updatedAppointment = await Appointment.findByPk(id);
    const pet = await Pets.findByPk(updatedAppointment.petId);
    const customer = await Custumers.findByPk(updatedAppointment.customerId);
    const service = await Services.findByPk(updatedAppointment.serviceId);
    const responsible = await Users.findByPk(updatedAppointment.responsibleId);
    const finance = await Finance.findByPk(updatedAppointment.financeId);

    let secondaryService = null;
    let tertiaryService = null;

    if (updatedAppointment.secondaryServiceId) {
      secondaryService = await Services.findByPk(
        updatedAppointment.secondaryServiceId,
      );
    }

    if (updatedAppointment.tertiaryServiceId) {
      tertiaryService = await Services.findByPk(
        updatedAppointment.tertiaryServiceId,
      );
    }

    const appointmentWithDetails = {
      ...updatedAppointment.dataValues,
      Pet: pet,
      Custumer: customer,
      Service: service,
      responsible,
      finance,
      secondaryService,
      tertiaryService,
      totalAmount,
    };

    console.log("PUT /appointments/:id - Response Data:", appointmentWithDetails);

    return res.status(200).json({
      message: "Agendamento atualizado com sucesso",
      data: appointmentWithDetails,
    });
  } catch (error) {
    console.error("Erro ao atualizar agendamento:", error);
    console.error("PUT /appointments/:id - Error Details:", error);
    return res.status(500).json({
      message: "Erro ao atualizar agendamento",
      error: error.message,
    });
  }
});

// Buscar agendamentos por cliente
router.get("/appointments/customer/:customerId", auth, async (req, res) => {
  try {
    const { customerId } = req.params;

    const appointments = await Appointment.findAll({
      where: {
        usersId: req.user.establishment,
        customerId,
      },
      include: [
        {
          model: Pets,
          attributes: ["name", "species", "breed"],
        },
        {
          model: Services,
          attributes: ["name", "price"],
        },
        {
          model: Users,
          as: "responsible",
          attributes: ["name"],
        },
      ],
      order: [
        ["date", "DESC"],
        ["time", "ASC"],
      ],
    });

    return res.status(200).json({
      message: "Agendamentos encontrados com sucesso",
      data: appointments,
    });
  } catch (error) {
    console.error("Erro ao buscar agendamentos do cliente:", error);
    return res.status(500).json({
      message: "Erro ao buscar agendamentos do cliente",
      error: error.message,
    });
  }
});

// Excluir agendamento
router.delete("/appointments/:id", auth, async (req, res) => {
  let t;

  try {
    const { id } = req.params;

    // Busca o agendamento
    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!appointment) {
      return res.status(404).json({
        message: "Agendamento não encontrado",
      });
    }

    t = await sequelize.transaction();

    // Busca todas as vendas relacionadas ao agendamento
    const sales = await Sales.findAll({
      where: {
        appointmentId: id,
        usersId: req.user.establishment,
      },
      transaction: t,
    });
    const appointmentPayments = await AppointmentPayment.findAll({
      where: {
        appointmentId: id,
        usersId: req.user.establishment,
      },
      transaction: t,
    });
    const paymentFinanceIds = appointmentPayments
      .map((payment) => payment.financeId)
      .filter(Boolean);

    // Para cada venda, exclui os itens e a transação financeira relacionada
    for (const sale of sales) {
      // Exclui os itens da venda
      await SaleItems.destroy({
        where: {
          saleId: sale.id,
          usersId: req.user.establishment,
        },
        transaction: t,
      });

      // Exclui a transação financeira relacionada à venda
      await Finance.destroy({
        where: {
          reference: sale.id,
          category: "Vendas",
          usersId: req.user.establishment,
        },
        transaction: t,
      });

      // Exclui a venda
      await sale.destroy({ transaction: t });
    }

    // Exclui a transação financeira do agendamento
    await AppointmentStatusHistory.destroy({
      where: {
        appointmentId: id,
        usersId: req.user.establishment,
      },
      transaction: t,
    });

    await AppointmentItem.destroy({
      where: {
        appointmentId: id,
        usersId: req.user.establishment,
      },
      transaction: t,
    });

    await AppointmentPayment.destroy({
      where: {
        appointmentId: id,
        usersId: req.user.establishment,
      },
      transaction: t,
    });

    const financeFilters = [
      { reference: `appointment_balance:${id}` },
      { reference: `appointment_free:${id}` },
    ];
    if (appointment.financeId) {
      financeFilters.push({ id: appointment.financeId });
    }
    if (paymentFinanceIds.length > 0) {
      financeFilters.push({
        id: {
          [Op.in]: paymentFinanceIds,
        },
      });
    }

    await Finance.destroy({
      where: {
        usersId: req.user.establishment,
        [Op.or]: financeFilters,
      },
      transaction: t,
    });

    // Finalmente, exclui o agendamento
    await appointment.destroy({ transaction: t });

    await t.commit();

    return res.status(200).json({
      message: "Agendamento excluído com sucesso",
    });
  } catch (error) {
    if (t) {
      await t.rollback();
    }
    console.error("Erro ao excluir agendamento:", error);
    return res.status(500).json({
      message: "Erro ao excluir agendamento",
      error: error.message,
    });
  }
});
// Criar pacote de agendamentos
router.post("/appointments/package", auth, async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      customerId,
      petId,
      serviceId,
      secondaryServiceId,
      tertiaryServiceId,
      dates,
      observation,
      responsibleId,
      sellerName,
      type,
      packageGroupId: requestedPackageGroupId,
    } = req.body;
    const packageGroupId =
      String(requestedPackageGroupId || "").trim() || `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const resolvePackageOccurrenceStaff = (occurrence, occurrenceIndex) => {
      const explicitResponsibleId = String(occurrence?.responsibleId || "").trim();
      const explicitSellerName = String(occurrence?.sellerName || "").trim();

      if (explicitResponsibleId || explicitSellerName) {
        return {
          responsibleId: explicitResponsibleId || null,
          sellerName: explicitSellerName || null,
        };
      }

      if (occurrenceIndex === 0) {
        return {
          responsibleId: responsibleId || null,
          sellerName: sellerName || null,
        };
      }

      return {
        responsibleId: null,
        sellerName: null,
      };
    };

    // Validação dos dados
    const requiredFields = {
      customerId,
      petId,
      serviceId,
      dates,
      type,
    };

    const invalidFields = [];

    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value) {
        invalidFields.push(field);
      }
    }

    if (!Array.isArray(dates) || dates.length === 0) {
      invalidFields.push("dates (deve ser um array não vazio)");
    }

    if (invalidFields.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        message: "Dados inválidos",
        invalidFields: invalidFields,
      });
    }

    // Buscar cliente e pet para mensagem
    const customer = await Custumers.findOne({
      where: {
        id: customerId,
        usersId: req.user.establishment,
      },
      transaction,
    });

    if (!customer) {
      await transaction.rollback();
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    const pet = await Pets.findOne({
      where: {
        id: petId,
        usersId: req.user.establishment,
      },
      transaction,
    });

    if (!pet) {
      await transaction.rollback();
      return res.status(404).json({ message: "Pet não encontrado" });
    }

    // Buscar serviço para mensagem
    const service = await Services.findOne({
      where: {
        id: serviceId,
        establishment: req.user.establishment,
      },
      transaction,
    });

    if (!service) {
      await transaction.rollback();
      return res.status(404).json({ message: "Serviço não encontrado" });
    }

    // Array para armazenar todos os agendamentos criados
    const createdAppointments = [];

    // Ordenar as datas em ordem cronológica
    const sortedDates = [...dates].sort((a, b) => {
      const dateA = new Date(`${a.date} ${a.time}`);
      const dateB = new Date(`${b.date} ${b.time}`);
      return dateA - dateB;
    });

    const totalAppointments = sortedDates.length;

    // Criar um agendamento para cada data/horário
    for (let i = 0; i < sortedDates.length; i++) {
      const occurrence = sortedDates[i];
      const { date, time } = occurrence;
      const occurrenceStaff = resolvePackageOccurrenceStaff(occurrence, i);
      const occurrenceResponsibleId = occurrenceStaff.responsibleId;
      const occurrenceSellerName = occurrenceStaff.sellerName;

      // Validar formato de data e hora
      if (!date || !time) {
        await transaction.rollback();
        return res.status(400).json({
          message: "Cada agendamento deve conter data e horário",
        });
      }

      // Verificar disponibilidade do horário apenas se houver responsibleId
      if (occurrenceResponsibleId) {
        const existingAppointment = await Appointment.findOne({
          where: {
            date,
            time,
            responsibleId: occurrenceResponsibleId,
            type,
            status: {
              [Op.notIn]: ["cancelado", "concluido"],
            },
          },
          transaction,
        });

        if (existingAppointment) {
          await transaction.rollback();
          return res.status(400).json({
            message: `Horário ${time} do dia ${date} já está ocupado para este profissional`,
          });
        }
      }

      // Criar o agendamento
      const newAppointment = await Appointment.create({
        customerId,
        petId,
        serviceId,
        secondaryServiceId,
        tertiaryServiceId,
        responsibleId: occurrenceResponsibleId,
        sellerName: occurrenceSellerName,
        type,
        date,
        time,
        observation: observation || "",
        status: "agendado",
        usersId: req.user.establishment,
        package: true,
        packageNumber: i + 1,
        packageMax: totalAppointments,
        packageGroupId,
      }, { transaction });

      // Calcula o valor total do agendamento
      let totalAmount = Number(service.price || 0);

      // Adiciona valores de serviços secundários e terciários se existirem
      if (secondaryServiceId) {
        const secondaryService = await Services.findOne({
          where: {
            id: secondaryServiceId,
            establishment: req.user.establishment,
          },
          transaction,
        });
        if (secondaryService) {
          totalAmount += Number(secondaryService.price || 0);
        }
      }

      if (tertiaryServiceId) {
        const tertiaryService = await Services.findOne({
          where: {
            id: tertiaryServiceId,
            establishment: req.user.establishment,
          },
          transaction,
        });
        if (tertiaryService) {
          totalAmount += Number(tertiaryService.price || 0);
        }
      }

      // Cria a transação financeira
      const finance = await Finance.create({
        type: "entrada",
        description: `Agendamento em Pacote (${i + 1}/${totalAppointments}) - ${service.name} - ${pet.name}`,
        amount: totalAmount,
        date: new Date(date),
        dueDate: new Date(date),
        category: "Serviços",
        subCategory: type,
        expenseType: "variavel",
        frequency: "unico",
        paymentMethod: "Pendente",
        status: "pendente",
        reference: "appointment",
        notes: observation,
        createdBy: req.user.id,
        usersId: req.user.establishment,
      }, { transaction });

      // Atualiza o agendamento com o ID da finança
      await newAppointment.update({ financeId: finance.id }, { transaction });

      createdAppointments.push(newAppointment);
    }

    await transaction.commit();

    // Enviar mensagem WhatsApp para o cliente
    if (customer.phone) {
      try {
        await mensagemPacotinho(createdAppointments.map((app) => app.id));
      } catch (notifyError) {
        console.error(
          "Erro ao enviar mensagem de confirmação do pacote:",
          notifyError,
        );
      }
    }

    return res.status(201).json({
      message: "Pacote de agendamentos criado com sucesso",
      data: createdAppointments,
    });
  } catch (error) {
    if (!transaction.finished) {
      await transaction.rollback();
    }
    console.error("Erro ao criar pacote de agendamentos:", error);
    return res.status(500).json({
      message: "Erro ao criar pacote de agendamentos",
      error: error.message,
    });
  }
});

//Fila de agendamento geral
router.get("/appointments/queue/geral/true", auth, async (req, res) => {
  const appointments = await Appointment.findAll({
    where: {
      queue: true,
      usersId: req.user.establishment,
    },
    include: [
      {
        model: Pets,
        as: "Pet",
      },
      {
        model: Custumers,
        as: "Custumer",
      },
      {
        model: Services,
        as: "Service",
      },
    ],
    order: [["queueTime", "ASC"]],
  });
  return res.status(200).json({ data: appointments });
});
//Fila de agendamento geral
router.get("/appointments/queue/geral/false", auth, async (req, res) => {
  const appointments = await Appointment.findAll({
    where: {
      queue: false,
      usersId: req.user.establishment,
    },
    include: [
      {
        model: Pets,
        as: "Pet",
      },
      {
        model: Custumers,
        as: "Custumer",
      },
      {
        model: Services,
        as: "Service",
      },
    ],
    order: [["queueTime", "ASC"]],
  });
  return res.status(200).json({ data: appointments });
});

//adicionar na fila geral
router.patch("/appointments/queue/geral/add/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    // Cria um datetime completo com a data atual
    const now = new Date();
    const queueTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    );

    await appointment.update({
      queue: true,
      queueTime: queueTime,
      queueInternacao: false, // Garante que não está em outras filas ao mesmo tempo
      queueExame: false,
    });

    return res.status(200).json({
      message: "Agendamento adicionado à fila geral com sucesso",
      data: appointment,
    });
  } catch (error) {
    console.error("Erro ao adicionar à fila geral:", error);
    return res.status(500).json({
      message: "Erro ao adicionar à fila geral",
      error: error.message,
    });
  }
});

//tirar da fila geral
router.patch("/appointments/queue/geral/remove/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    await appointment.update({
      queue: false,
      queueTime: null, // Limpa o horário da fila
    });

    return res
      .status(200)
      .json({ message: "Agendamento removido da fila geral com sucesso" });
  } catch (error) {
    console.error("Erro ao remover da fila geral:", error);
    return res.status(500).json({
      message: "Erro ao remover da fila geral",
      error: error.message,
    });
  }
});

//Fila de agendamento Internacao
router.get("/appointments/queue/internacao/true", auth, async (req, res) => {
  const appointments = await Appointment.findAll({
    where: {
      queueInternacao: true,
      usersId: req.user.establishment,
    },
    include: [
      {
        model: Pets,
        as: "Pet",
      },
      {
        model: Custumers,
        as: "Custumer",
      },
      {
        model: Services,
        as: "Service",
      },
    ],
    order: [["queueTime", "ASC"]], //Mantém a ordenação por queueTime para consistência
  });
  return res.status(200).json({ data: appointments });
});

//Fila de agendamento Internacao
router.get("/appointments/queue/internacao/false", auth, async (req, res) => {
  const appointments = await Appointment.findAll({
    where: {
      queueInternacao: false,
      usersId: req.user.establishment,
    },
    include: [
      {
        model: Pets,
        as: "Pet",
      },
      {
        model: Custumers,
        as: "Custumer",
      },
      {
        model: Services,
        as: "Service",
      },
    ],
    order: [["queueTime", "ASC"]], //Mantém a ordenação por queueTime para consistência
  });
  return res.status(200).json({ data: appointments });
});

//adicionar na fila de internação
router.patch(
  "/appointments/queue/internacao/add/:id",
  auth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const appointment = await Appointment.findOne({
        where: {
          id,
          usersId: req.user.establishment,
        },
      });

      if (!appointment) {
        return res.status(404).json({ message: "Agendamento não encontrado" });
      }
      // Cria um datetime completo com a data atual
      const now = new Date();
      const queueTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours(),
        now.getMinutes(),
      );

      await appointment.update({
        queueInternacao: true,
        queueTime: queueTime,
        queue: false, // Garante que não está em outras filas ao mesmo tempo
        queueExame: false,
      });

      return res.status(200).json({
        message: "Agendamento adicionado à fila de internação com sucesso",
        data: appointment,
      });
    } catch (error) {
      console.error("Erro ao adicionar à fila de internação:", error);
      return res.status(500).json({
        message: "Erro ao adicionar à fila de internação",
        error: error.message,
      });
    }
  },
);

//tirar da fila de internação
router.patch(
  "/appointments/queue/internacao/remove/:id",
  auth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const appointment = await Appointment.findOne({
        where: {
          id,
          usersId: req.user.establishment,
        },
      });

      if (!appointment) {
        return res.status(404).json({ message: "Agendamento não encontrado" });
      }

      await appointment.update({
        queueInternacao: false,
        queueTime: null, // Limpa o horário da fila
      });

      return res.status(200).json({
        message: "Agendamento removido da fila de internação com sucesso",
      });
    } catch (error) {
      console.error("Erro ao remover da fila de internação:", error);
      return res.status(500).json({
        message: "Erro ao remover da fila de internação",
        error: error.message,
      });
    }
  },
);

//Fila de agendamento Exame
router.get("/appointments/queue/exame/true", auth, async (req, res) => {
  const appointments = await Appointment.findAll({
    where: {
      queueExame: true,
      usersId: req.user.establishment,
    },
    include: [
      {
        model: Pets,
        as: "Pet",
      },
      {
        model: Custumers,
        as: "Custumer",
      },
      {
        model: Services,
        as: "Service",
      },
    ],
    order: [["queueTime", "ASC"]], //Mantém a ordenação por queueTime para consistência
  });
  return res.status(200).json({ data: appointments });
});

//Fila de agendamento Exame
router.get("/appointments/queue/exame/false", auth, async (req, res) => {
  const appointments = await Appointment.findAll({
    where: {
      queueExame: false,
      usersId: req.user.establishment,
    },
    include: [
      {
        model: Pets,
        as: "Pet",
      },
      {
        model: Custumers,
        as: "Custumer",
      },
      {
        model: Services,
        as: "Service",
      },
    ],
    order: [["queueTime", "ASC"]], //Mantém a ordenação por queueTime para consistência
  });
  return res.status(200).json({ data: appointments });
});

//adicionar na fila de exame
router.patch("/appointments/queue/exame/add/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }
    // Cria um datetime completo com a data atual
    const now = new Date();
    const queueTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    );

    await appointment.update({
      queueExame: true,
      queueTime: queueTime,
      queue: false, // Garante que não está em outras filas ao mesmo tempo
      queueInternacao: false,
    });

    return res.status(200).json({
      message: "Agendamento adicionado à fila de exame com sucesso",
      data: appointment,
    });
  } catch (error) {
    console.error("Erro ao adicionar à fila de exame:", error);
    return res.status(500).json({
      message: "Erro ao adicionar à fila de exame",
      error: error.message,
    });
  }
});

//remover da fila de exame
router.patch("/appointments/queue/exame/remove/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    await appointment.update({
      queueExame: false,
      queueTime: null, // Limpa o horário da fila
    });

    return res
      .status(200)
      .json({ message: "Agendamento removido da fila de exame com sucesso" });
  } catch (error) {
    console.error("Erro ao remover da fila de exame:", error);
    return res.status(500).json({
      message: "Erro ao remover da fila de exame",
      error: error.message,
    });
  }
});
export default router;
