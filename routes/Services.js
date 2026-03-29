import express from "express";
import Services from "../models/Services.js";
import authenticate from "../middlewares/auth.js";
import owner from "../middlewares/owner.js";
import { Op } from "sequelize";
import sequelize from "../database/config.js"; // Importe a instância do sequelize

const router = express.Router();

router.get("/services/search", authenticate, async (req, res) => {
  // NOVA ROTA para busca de Serviços
  try {
    const { search } = req.query; // Recebe o termo de busca da query string

    let whereClause = { establishment: req.user.establishment }; // Cláusula WHERE base

    if (search) {
      // Se um termo de busca for fornecido
      whereClause = {
        ...whereClause,
        name: { [Op.like]: `%${search}%` }, // Adiciona filtro por nome (case-insensitive usando Op.like direto)
      };
    }

    const services = await Services.findAll({
      where: whereClause,
      order: [["name", "ASC"]],
    });
    return res.status(200).json(services);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao buscar serviços",
      error: error.message,
    });
  }
});

// Get all services
router.get("/services", authenticate, async (req, res) => {
  try {
    const services = await Services.findAll({
      where: { establishment: req.user.establishment },
      order: [["name", "ASC"]],
    });
    return res.status(200).json(services);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao buscar serviços",
      error: error.message,
    });
  }
});

// Add new service
router.post("/services", authenticate, owner, async (req, res) => {
  const { name, description, price, duration, category, observation, cost } =
    req.body; // COST IS NOW BEING EXTRACTED FROM req.body

  if (!name || !price) {
    // VALIDAÇÃO REMOVIDA PARA DURATION
    return res.status(400).json({
      message:
        "Por favor, preencha todos os campos obrigatórios (Nome e Preço)", // Mensagem atualizada
    });
  }

  // VALOR PADRÃO PARA DURATION (OPCIONAL - SE QUISER VALOR PADRÃO 0)
  const serviceDuration = duration || null; // AGORA PODE SER null SE NÃO FOR FORNECIDO, ou 0 se quiser 0 como padrão. Use null para realmente permitir nulo no DB se configurado.

  try {
    const newService = await Services.create({
      name,
      description,
      price,
      duration: serviceDuration, // USANDO VALOR PADRÃO OU VALOR FORNECIDO
      category,
      observation,
      establishment: req.user.establishment,
      usersId: req.user.id,
      cost, // COST IS NOW BEING PASSED TO CREATE FUNCTION
    });

    return res.status(201).json({
      message: "Serviço criado com sucesso",
      service: newService,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao criar serviço",
      error: error.message,
    });
  }
});

// Edit service
router.put("/services", authenticate, owner, async (req, res) => {
  const {
    name,
    description,
    price,
    duration,
    category,
    observation,
    id,
    cost,
  } = req.body;

  try {
    const service = await Services.findByPk(id);

    if (!service) {
      return res.status(404).json({
        message: "Serviço não encontrado",
      });
    }

    if (service.establishment !== req.user.establishment) {
      return res.status(403).json({
        message: "Você não tem permissão para editar este serviço",
      });
    }

    await service.update({
      name: name || service.name,
      description: description || service.description,
      price: price || service.price,
      duration: duration || service.duration,
      category: category || service.category,
      observation: observation || service.observation,
      cost: cost || service.cost,
    });

    return res.status(200).json({
      message: "Serviço atualizado com sucesso",
      service,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao atualizar serviço",
      error: error.message,
    });
  }
});

// Delete service
router.delete("/services", authenticate, owner, async (req, res) => {
  const { id } = req.body;

  try {
    const service = await Services.findByPk(id);

    if (!service) {
      return res.status(404).json({
        message: "Serviço não encontrado",
      });
    }

    if (service.establishment !== req.user.establishment) {
      return res.status(403).json({
        message: "Você não tem permissão para deletar este serviço",
      });
    }

    await service.destroy();

    return res.status(200).json({
      message: "Serviço deletado com sucesso",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao deletar serviço",
      error: error.message,
    });
  }
});

export default router;
