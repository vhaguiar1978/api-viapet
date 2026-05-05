import express from "express";
import authenticate from "../middlewares/auth.js";
import { getPlanStatus, PLAN_DEFINITIONS } from "../service/planLimits.js";

const router = express.Router();

router.get("/crm-plan-status", authenticate, async (req, res) => {
  try {
    const userId = req.user?.establishment || req.user?.id;
    if (!userId) return res.status(401).json({ message: "Usuario nao identificado" });
    const status = await getPlanStatus(userId);
    return res.status(200).json({ data: status });
  } catch (error) {
    console.error("Erro ao buscar status do plano:", error);
    return res.status(500).json({ message: "Erro ao buscar status do plano", error: error.message });
  }
});

router.get("/crm-plan-status/catalog", authenticate, (_req, res) => {
  res.status(200).json({ data: PLAN_DEFINITIONS });
});

export default router;
