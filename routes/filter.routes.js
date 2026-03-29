// filter.routes.js
import express from "express";
import auth from "../middlewares/auth.js";
import Custumers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import Appointment from "../models/Appointment.js";
import { Op, Sequelize } from "sequelize";
import sequelize from "../database/config.js";

const router = express.Router();

router.use(auth);

// Rota para filtrar clientes com paginação e "começo da letra"
router.get("/customers", async (req, res) => {
  try {
    const {
      nome,
      endereco,
      cidade,
      bairro,
      estado,
      telefone,
      page = 1,
      pageSize = 10,
    } = req.query; // Adicionado paginação

    const whereClause = {
      usersId: req.user.establishment,
    };

    if (nome) {
      whereClause.name = { [Op.startsWith]: nome }; // Alterado para startsWith
    }
    if (endereco) {
      whereClause.address = { [Op.startsWith]: endereco }; // Alterado para startsWith
    }
    if (cidade) {
      whereClause.city = { [Op.startsWith]: cidade }; // Alterado para startsWith
    }
    if (bairro) {
      whereClause.complement = { [Op.startsWith]: bairro }; // Alterado para startsWith
    }
    if (estado) {
      whereClause.state = { [Op.startsWith]: estado }; // Alterado para startsWith
    }
    if (telefone) {
      whereClause.phone = { [Op.startsWith]: telefone }; // Alterado para startsWith
    }

    const limit = parseInt(pageSize);
    const offset = (parseInt(page) - 1) * limit;

    const { count, rows: clientes } = await Custumers.findAndCountAll({
      // Usando findAndCountAll
      where: whereClause,
      order: [["name", "ASC"]],
      limit: limit, // Adicionado limit para paginação
      offset: offset, // Adicionado offset para paginação
    });

    const totalPages = Math.ceil(count / pageSize);

    return res.status(200).json({
      message: "Clientes filtrados com sucesso",
      data: clientes,
      pagination: {
        // Adicionado metadados de paginação
        currentPage: parseInt(page),
        pageSize: limit,
        totalItems: count,
        totalPages: totalPages,
      },
    });
  } catch (error) {
    console.error("Erro ao filtrar clientes:", error);
    return res.status(500).json({
      message: "Erro ao filtrar clientes",
      error: error.message,
    });
  }
});

// Rota para filtrar pets com paginação e "começo da letra"
router.get("/pets", async (req, res) => {
  try {
    const {
      nome,
      especie,
      raca,
      sexo,
      agendamento,
      criadoEm,
      donoNome,
      page = 1,
      pageSize = 10,
    } = req.query; // Adicionado paginação

    const whereClause = {
      usersId: req.user.establishment,
    };
    const includeOptions = [
      {
        model: Custumers,
        as: "Custumer",
        attributes: ["name", "phone", "email"],
      },
    ];

    if (nome) {
      whereClause.name = { [Op.startsWith]: nome }; // Alterado para startsWith
    }
    if (especie) {
      whereClause.species = { [Op.startsWith]: especie }; // Alterado para startsWith
    }
    if (raca) {
      whereClause.breed = { [Op.startsWith]: raca }; // Alterado para startsWith
    }
    if (sexo) {
      whereClause.sex = sexo;
    }

    if (agendamento) {
      let startDate;
      const today = new Date();
      if (agendamento === "ultima_semana") {
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);
      } else if (agendamento === "ultima_quinzena") {
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 15);
      } else if (agendamento === "ultimo_mes") {
        startDate = new Date(today);
        startDate.setMonth(today.getMonth() - 1);
      } else if (agendamento === "ultimos_6_meses") {
        startDate = new Date(today);
        startDate.setMonth(today.getMonth() - 6);
      }

      if (startDate) {
        includeOptions.push({
          model: Appointment,
          as: "Appointments",
          where: {
            date: { [Op.gte]: startDate },
          },
          required: true,
        });
      }
    }

    if (criadoEm) {
      const today = new Date();
      const currentYear = today.getFullYear();
      let startDate, endDate;

      if (criadoEm === "marco") {
        startDate = new Date(currentYear, 2, 1);
        endDate = new Date(currentYear, 2, 31, 23, 59, 59, 999);
      } else if (criadoEm === "fevereiro") {
        startDate = new Date(currentYear, 1, 1);
        endDate = new Date(currentYear, 1, 29, 23, 59, 59, 999);
      } else if (criadoEm === "janeiro") {
        startDate = new Date(currentYear, 0, 1);
        endDate = new Date(currentYear, 0, 31, 23, 59, 59, 999);
      } else if (criadoEm === "deste_ano") {
        startDate = new Date(currentYear, 0, 1);
        endDate = new Date(currentYear, 11, 31, 23, 59, 59, 999);
      } else if (criadoEm === "ano_passado") {
        const lastYear = currentYear - 1;
        startDate = new Date(lastYear, 0, 1);
        endDate = new Date(lastYear, 11, 31, 23, 59, 59, 999);
      }

      if (startDate && endDate) {
        whereClause.createdAt = { [Op.between]: [startDate, endDate] };
      }
    }

    if (donoNome) {
      includeOptions[0].where = {
        name: { [Op.startsWith]: donoNome }, // Alterado para startsWith
      };
    }

    const limit = parseInt(pageSize);
    const offset = (parseInt(page) - 1) * limit;

    const { count, rows: pets } = await Pets.findAndCountAll({
      // Usando findAndCountAll
      where: whereClause,
      include: includeOptions,
      order: [["name", "ASC"]],
      limit: limit, // Adicionado limit para paginação
      offset: offset, // Adicionado offset para paginação
    });

    const totalPages = Math.ceil(count / pageSize);

    return res.status(200).json({
      message: "Pets filtrados com sucesso",
      data: pets,
      pagination: {
        // Adicionado metadados de paginação
        currentPage: parseInt(page),
        pageSize: limit,
        totalItems: count,
        totalPages: totalPages,
      },
    });
  } catch (error) {
    console.error("Erro ao filtrar pets:", error);
    return res.status(500).json({
      message: "Erro ao filtrar pets",
      error: error.message,
    });
  }
});

export default router;
