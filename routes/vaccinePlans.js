import express from "express";
import authenticate from "../middlewares/auth.js";
import owner from "../middlewares/owner.js";
import VaccinePlan from "../models/VaccinePlan.js";

const router = express.Router();

router.get("/vaccine-plans", authenticate, async (req, res) => {
  try {
    const plans = await VaccinePlan.findAll({
      where: { establishment: req.user.establishment },
      order: [["name", "ASC"]],
    });

    res.status(200).json({ data: plans });
  } catch (error) {
    res.status(500).json({
      message: "Erro ao buscar planos vacinais",
      error: error.message,
    });
  }
});

router.post("/vaccine-plans", authenticate, owner, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Nome do plano vacinal é obrigatório" });
    }

    const plan = await VaccinePlan.create({
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      establishment: req.user.establishment,
      usersId: req.user.id,
    });

    res.status(201).json({
      message: "Plano vacinal criado com sucesso",
      data: plan,
    });
  } catch (error) {
    res.status(500).json({
      message: "Erro ao criar plano vacinal",
      error: error.message,
    });
  }
});

router.put("/vaccine-plans/:id", authenticate, owner, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const plan = await VaccinePlan.findOne({
      where: { id, establishment: req.user.establishment },
    });

    if (!plan) {
      return res.status(404).json({ message: "Plano vacinal não encontrado" });
    }

    await plan.update({
      name: name ? String(name).trim() : plan.name,
      description: description !== undefined ? description : plan.description,
    });

    res.status(200).json({
      message: "Plano vacinal atualizado com sucesso",
      data: plan,
    });
  } catch (error) {
    res.status(500).json({
      message: "Erro ao atualizar plano vacinal",
      error: error.message,
    });
  }
});

router.delete("/vaccine-plans/:id", authenticate, owner, async (req, res) => {
  try {
    const { id } = req.params;

    const plan = await VaccinePlan.findOne({
      where: { id, establishment: req.user.establishment },
    });

    if (!plan) {
      return res.status(404).json({ message: "Plano vacinal não encontrado" });
    }

    await plan.destroy();

    res.status(200).json({ message: "Plano vacinal removido com sucesso" });
  } catch (error) {
    res.status(500).json({
      message: "Erro ao remover plano vacinal",
      error: error.message,
    });
  }
});

export default router;
