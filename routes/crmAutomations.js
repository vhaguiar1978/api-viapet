import express from "express";
import authenticate from "../middlewares/auth.js";
import Settings from "../models/Settings.js";
import {
  buildDefaultAutomations,
  mergeAutomationsConfig,
  runAutomationsForUser,
  AUTOMATION_TYPES,
} from "../service/crmAutomations.js";

const router = express.Router();

function getUserId(req) {
  return req.user?.establishment || req.user?.id || null;
}

router.get("/crm-automations", authenticate, async (req, res) => {
  try {
    const usersId = getUserId(req);
    const settings = await Settings.findOne({ where: { usersId } });
    // GET nao cria — apenas le. Se nao existir, retorna defaults.
    const stored = settings?.crmAutomations || null;
    const config = mergeAutomationsConfig(stored);
    return res.status(200).json({ data: config });
  } catch (error) {
    console.error("Erro ao carregar automacoes:", error);
    return res.status(500).json({ message: "Erro ao carregar automacoes", error: error.message });
  }
});

router.put("/crm-automations", authenticate, async (req, res) => {
  try {
    const usersId = getUserId(req);
    let settings = await Settings.findOne({ where: { usersId } });
    if (!settings) {
      settings = await Settings.create({ usersId, crmAutomations: buildDefaultAutomations() });
    }
    const merged = mergeAutomationsConfig({ ...settings.crmAutomations, ...(req.body || {}) });
    // Mantem chaves desconhecidas fora — escreve apenas o config validado
    settings.crmAutomations = merged;
    await settings.save();
    return res.status(200).json({ data: merged, message: "Automacoes atualizadas" });
  } catch (error) {
    console.error("Erro ao atualizar automacoes:", error);
    return res.status(500).json({ message: "Erro ao atualizar automacoes", error: error.message });
  }
});

// Roda manualmente (uso para teste/debug)
router.post("/crm-automations/run", authenticate, async (req, res) => {
  try {
    const usersId = getUserId(req);
    const result = await runAutomationsForUser(usersId);
    return res.status(200).json({ data: result });
  } catch (error) {
    console.error("Erro ao rodar automacoes:", error);
    return res.status(500).json({ message: "Erro ao rodar automacoes", error: error.message });
  }
});

router.get("/crm-automations/types", authenticate, (_req, res) => {
  res.status(200).json({ data: AUTOMATION_TYPES });
});

export default router;
