import express from "express";
import { Op } from "sequelize";
import Services from "../models/Services.js";
import authenticate from "../middlewares/auth.js";
import owner from "../middlewares/owner.js";

const router = express.Router();

router.get("/services/search", authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    let whereClause = { establishment: req.user.establishment };

    if (search) {
      whereClause = {
        ...whereClause,
        name: { [Op.like]: `%${search}%` },
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
      message: "Erro ao buscar servicos",
      error: error.message,
    });
  }
});

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
      message: "Erro ao buscar servicos",
      error: error.message,
    });
  }
});

router.post("/services", authenticate, owner, async (req, res) => {
  const { name, description, price, duration, category, observation, cost } = req.body;

  if (!String(name || "").trim()) {
    return res.status(400).json({
      message: "Por favor, informe pelo menos o nome do servico",
    });
  }

  const normalizedDuration = duration || null;
  const normalizedPrice = price == null || price === "" ? 0 : price;
  const normalizedCost = cost == null || cost === "" ? 0 : cost;

  try {
    const newService = await Services.create({
      name: String(name).trim(),
      description,
      price: normalizedPrice,
      duration: normalizedDuration,
      category,
      observation,
      establishment: req.user.establishment,
      usersId: req.user.id,
      cost: normalizedCost,
    });

    return res.status(201).json({
      message: "Servico criado com sucesso",
      service: newService,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao criar servico",
      error: error.message,
    });
  }
});

router.put("/services", authenticate, owner, async (req, res) => {
  const { name, description, price, duration, category, observation, id, cost } = req.body;

  try {
    const service = await Services.findByPk(id);

    if (!service) {
      return res.status(404).json({
        message: "Servico nao encontrado",
      });
    }

    if (service.establishment !== req.user.establishment) {
      return res.status(403).json({
        message: "Voce nao tem permissao para editar este servico",
      });
    }

    await service.update({
      name: name ? String(name).trim() : service.name,
      description: description ?? service.description,
      price: price ?? service.price,
      duration: duration ?? service.duration,
      category: category || service.category,
      observation: observation ?? service.observation,
      cost: cost ?? service.cost,
    });

    return res.status(200).json({
      message: "Servico atualizado com sucesso",
      service,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao atualizar servico",
      error: error.message,
    });
  }
});

router.delete("/services", authenticate, owner, async (req, res) => {
  const { id } = req.body;

  try {
    const service = await Services.findByPk(id);

    if (!service) {
      return res.status(404).json({
        message: "Servico nao encontrado",
      });
    }

    if (service.establishment !== req.user.establishment) {
      return res.status(403).json({
        message: "Voce nao tem permissao para deletar este servico",
      });
    }

    await service.destroy();

    return res.status(200).json({
      message: "Servico deletado com sucesso",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao deletar servico",
      error: error.message,
    });
  }
});

export default router;
