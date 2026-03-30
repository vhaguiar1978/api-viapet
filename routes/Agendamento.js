import express from "express";
import Appointment from "../models/Appointment.js";
import auth from "../middlewares/auth.js";
import Pets from "../models/Pets.js";
import Custumers from "../models/Custumers.js";
import Services from "../models/Services.js";
import Settings from "../models/Settings.js";
import Users from "../models/Users.js";
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

const router = express.Router();
// Criar novo agendamento
router.post("/appointments", auth, async (req, res) => {
  try {
    const {
      petId,
      customerId,
      serviceId,
      responsibleId,
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
    } = req.body;

    // Verifica se o pet existe e pertence ao estabelecimento
    const pet = await Pets.findOne({
      where: {
        id: petId,
        usersId: req.user.establishment,
      },
    });

    if (!pet) {
      return res.status(404).json({ message: "Pet não encontrado" });
    }

    // Busca o cliente para enviar mensagem
    const customer = await Custumers.findOne({
      where: {
        id: customerId,
        usersId: req.user.establishment,
      },
    });

    if (!customer) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    // Busca o serviço para incluir na mensagem e valor
    const service = await Services.findOne({
      where: {
        id: serviceId,
        establishment: req.user.establishment,
      },
    });

    if (!service) {
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
    const finance = await Finance.create({
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
    });

    const appointment = await Appointment.create({
      usersId: req.user.establishment,
      petId,
      customerId,
      serviceId,
      responsibleId,
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
      financeId: finance.id,
    });

    // Busca as configurações de mensagem do WhatsApp
    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
    });

    // Verifica se o cliente tem telefone e se as configurações permitem envio de mensagem
    if (customer.phone && settings?.notifyClient) {
      await mensagemAgendamento(appointment.id);
    }

    return res.status(201).json({
      message: "Agendamento criado com sucesso",
      data: appointment,
    });
  } catch (error) {
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

    const where = {
      usersId: req.user.establishment,
      [Op.and]: [
        sequelize.where(
          sequelize.fn("MONTH", sequelize.col("Appointment.date")),
          "=",
          month,
        ),
        sequelize.where(
          sequelize.fn("YEAR", sequelize.col("Appointment.date")),
          "=",
          year,
        ),
      ],
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

    // Calcular dados agregados
    let quantidadePacientesAtendidos = new Set();
    let quantidadeAgendamentosClinica = 0;
    let quantidadeAgendamentosEstetica = 0;
    let quantidadeServicos = appointments.length;
    let totalFaturado = 0;

    appointments.forEach((appointment) => {
      quantidadePacientesAtendidos.add(appointment.customerId);
      if (appointment.type === "clinica") {
        quantidadeAgendamentosClinica++;
      } else if (appointment.type === "estetica") {
        quantidadeAgendamentosEstetica++;
      }
      if (appointment.finance && appointment.finance.status === "pago") {
        totalFaturado += Number(appointment.finance.amount);
      }
    });

    const dadosAgregados = {
      quantidadePacientesAtendidos: quantidadePacientesAtendidos.size,
      quantidadeAgendamentosClinica,
      quantidadeAgendamentosEstetica,
      quantidadeServicos,
      totalFaturado: totalFaturado.toFixed(2),
    };

    return res.status(200).json({
      message: "Agendamentos e dados mensais encontrados com sucesso.",
      data: {
        appointments,
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
    const { date, status, type } = req.query;

    const where = {
      usersId: req.user.establishment,
    };

    if (date) {
      where.date = date;
    }
    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }

    const appointments = await Appointment.findAll({
      where,
      order: [
        ["date", "ASC"],
        ["time", "ASC"],
      ],
    });

    // Buscar informações adicionais para cada agendamento
    const appointmentsWithDetails = await Promise.all(
      appointments.map(async (appointment) => {
        const pet = await Pets.findByPk(appointment.petId);
        const customer = await Custumers.findByPk(appointment.customerId);
        const service = await Services.findByPk(appointment.serviceId);
        const responsible = await Users.findByPk(appointment.responsibleId);
        const finance = await Finance.findByPk(appointment.financeId);
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
        if (!finance) {
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
        else if (finance.amount !== totalAmount) {
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

    return res.json({
      message: "Agendamentos encontrados com sucesso",
      data: appointmentsWithDetails,
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
    if (!["Buscar pet", "Entregar pet", "Sem status"].includes(status)) {
      return res.status(400).json({
        message: 'Status inválido. Use "Buscar pet" ou "Entregar pet"',
      });
    }

    await appointment.update({ driver_status: status });

    // Só envia mensagem se o status não for 'Sem status'
    if (status !== "Sem status") {
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

    // Retorna sucesso sem tentar enviar mensagem para 'Sem status'
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
      serviceId,
      responsibleId,
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
    } = req.body;

    console.log("PUT /appointments/:id - Request Params:", req.params); // LOG PARAMS
    console.log("PUT /appointments/:id - Request Body:", req.body); // LOG BODY

    // Buscar o agendamento
    const appointment = await Appointment.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    // Buscar serviços para calcular o valor total
    const mainService = await Services.findOne({
      where: {
        id: serviceId || appointment.serviceId,
        establishment: req.user.establishment,
      },
    }); // Mantém o || aqui para evitar erro se serviceId não for fornecido em criação
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

    const updateData = {
      // Crie um objeto para os dados de atualização
      responsibleId,
      date,
      time,
      observation,
      status,
      instagram: instagram !== undefined ? instagram : appointment.instagram,
      facebook: facebook !== undefined ? facebook : appointment.facebook,
      whatsapp: whatsapp !== undefined ? whatsapp : appointment.whatsapp,
      tiktok: tiktok !== undefined ? tiktok : appointment.tiktok,
      serviceId: serviceId, // USAR DIRETAMENTE do req.body (SEM ||)
      secondaryServiceId: secondaryServiceId, // USAR DIRETAMENTE do req.body (SEM ||)
      tertiaryServiceId: tertiaryServiceId, // USAR DIRETAMENTE do req.body (SEM ||)
    };

    console.log("PUT /appointments/:id - Update Data:", updateData); // LOG Dados que serão usados no Update

    // Atualizar o agendamento
    await Appointment.update(updateData, {
      where: { id: appointment.id },
    });

    console.log("PUT /appointments/:id - Appointment.update DONE"); // LOG após update

    // Atualizar a transação financeira
    if (appointment.financeId) {
      await Finance.update(
        {
          amount: totalAmount,
          dueDate: new Date(date || appointment.date),
        },
        {
          where: { id: appointment.financeId },
        },
      );
    }

    // Buscar o agendamento atualizado com todas as informações
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
      responsible: responsible,
      finance: finance,
      secondaryService,
      tertiaryService,
      totalAmount,
    };

    console.log(
      "PUT /appointments/:id - Response Data:",
      appointmentWithDetails,
    ); // LOG Response Data

    return res.status(200).json({
      message: "Agendamento atualizado com sucesso",
      data: appointmentWithDetails,
    });
  } catch (error) {
    console.error("Erro ao atualizar agendamento:", error);
    console.error("PUT /appointments/:id - Error Details:", error); // LOG Erro Completo
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
  const t = await sequelize.transaction();

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

    // Busca todas as vendas relacionadas ao agendamento
    const sales = await Sales.findAll({
      where: {
        appointmentId: id,
        usersId: req.user.establishment,
      },
    });

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
    await Finance.destroy({
      where: {
        id: appointment.financeId,
        usersId: req.user.establishment,
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
    await t.rollback();
    console.error("Erro ao excluir agendamento:", error);
    return res.status(500).json({
      message: "Erro ao excluir agendamento",
      error: error.message,
    });
  }
});
// Criar pacote de agendamentos
router.post("/appointments/package", auth, async (req, res) => {
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
      type,
    } = req.body;

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
    });

    if (!customer) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    const pet = await Pets.findOne({
      where: {
        id: petId,
        usersId: req.user.establishment,
      },
    });

    if (!pet) {
      return res.status(404).json({ message: "Pet não encontrado" });
    }

    // Buscar serviço para mensagem
    const service = await Services.findOne({
      where: {
        id: serviceId,
        establishment: req.user.establishment,
      },
    });

    if (!service) {
      return res.status(404).json({ message: "Serviço não encontrado" });
    }

    // Array para armazenar todos os agendamentos criados
    const createdAppointments = [];

    // Ordenar as datas em ordem cronológica
    const sortedDates = dates.sort((a, b) => {
      const dateA = new Date(`${a.date} ${a.time}`);
      const dateB = new Date(`${b.date} ${b.time}`);
      return dateA - dateB;
    });

    const totalAppointments = sortedDates.length;

    // Criar um agendamento para cada data/horário
    for (let i = 0; i < sortedDates.length; i++) {
      const { date, time } = sortedDates[i];

      // Validar formato de data e hora
      if (!date || !time) {
        return res.status(400).json({
          message: "Cada agendamento deve conter data e horário",
        });
      }

      // Verificar disponibilidade do horário apenas se houver responsibleId
      if (responsibleId) {
        const existingAppointment = await Appointment.findOne({
          where: {
            date,
            time,
            responsibleId,
            type,
            status: {
              [Op.notIn]: ["cancelado", "concluido"],
            },
          },
        });

        if (existingAppointment) {
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
        responsibleId,
        type,
        date,
        time,
        observation: observation || "",
        status: "agendado",
        usersId: req.user.establishment,
        package: true,
        packageNumber: i + 1,
        packageMax: totalAppointments,
      });

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
      });

      // Atualiza o agendamento com o ID da finança
      await newAppointment.update({ financeId: finance.id });

      createdAppointments.push(newAppointment);
    }

    // Enviar mensagem WhatsApp para o cliente
    if (customer.phone) {
      await mensagemPacotinho(createdAppointments.map((app) => app.id));
    }

    return res.status(201).json({
      message: "Pacote de agendamentos criado com sucesso",
      data: createdAppointments,
    });
  } catch (error) {
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
