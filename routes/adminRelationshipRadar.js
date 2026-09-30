import express from "express";
import adminMiddleware from "../middlewares/admin.js";
import Users from "../models/Users.js";
import RelationshipRadarSetting from "../models/RelationshipRadarSetting.js";
import RelationshipMission from "../models/RelationshipMission.js";
import { RADAR_DEFAULTS } from "../service/relationshipRadarRules.js";
import { assessRelationshipUsers } from "../service/relationshipRadarData.js";
import { logActivity } from "../service/activityLogger.js";
import AiKnowledge from "../models/AiKnowledge.js";
import Subscription from "../models/Subscription.js";
import PaymentHistory from "../models/PaymentHistory.js";
import { previewRelationshipResponse } from "../service/relationshipAssistantPreview.js";

const router = express.Router();
router.use("/admin/relationship-radar", adminMiddleware);

async function getSettings() {
  const [row] = await RelationshipRadarSetting.findOrCreate({ where: { systemId: "VIAPET" }, defaults: { settings: RADAR_DEFAULTS } });
  return { row, settings: { ...RADAR_DEFAULTS, ...(row.settings || {}) } };
}

router.get("/admin/relationship-radar/settings", async (_req, res) => {
  try { const { settings } = await getSettings(); return res.json({ data: settings }); }
  catch (error) { return res.status(500).json({ message: "Não foi possível carregar as regras do Radar.", error: error.message }); }
});

router.put("/admin/relationship-radar/settings", async (req, res) => {
  try {
    const { row, settings } = await getSettings();
    const days = [...new Set((Array.isArray(req.body.operationalDays) ? req.body.operationalDays : settings.operationalDays).map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
    if (!days.length) return res.status(400).json({ message: "Selecione ao menos um dia de funcionamento." });
    const holidays = (Array.isArray(req.body.holidays) ? req.body.holidays : settings.holidays).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day))).slice(0, 200);
    const next = { ...settings, operationalDays: days, holidays,
      inactivityThresholdDays: Math.min(30, Math.max(1, Number(req.body.inactivityThresholdDays ?? settings.inactivityThresholdDays) || 3)),
      contactStart: String(req.body.contactStart ?? settings.contactStart).slice(0, 5),
      contactEnd: String(req.body.contactEnd ?? settings.contactEnd).slice(0, 5),
      instructions: String(req.body.instructions ?? settings.instructions).slice(0, 4000),
      mode: "observe" };
    await row.update({ settings: next, updatedBy: req.user.id });
    return res.json({ data: next });
  } catch (error) { return res.status(500).json({ message: "Não foi possível salvar as regras do Radar.", error: error.message }); }
});

router.get("/admin/relationship-radar", async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const page = Math.max(1, Number(req.query.page) || 1);
    const { settings } = await getSettings();
    const { count, rows: users } = await Users.findAndCountAll({
      where: { role: "proprietario", status: true },
      attributes: ["id", "name", "companyName", "createdAt", "lastAccess", "plan"],
      order: [["createdAt", "DESC"]], limit, offset: (page - 1) * limit,
    });
    if (!users.length) return res.json({ data: [], total: count, page, settings });
    const data = await assessRelationshipUsers(users, settings);
    return res.json({ data, total: count, page, settings });
  } catch (error) { return res.status(500).json({ message: "Não foi possível avaliar os clientes.", error: error.message }); }
});

router.get("/admin/relationship-radar/missions", async (_req, res) => {
  try {
    const missions = await RelationshipMission.findAll({ where: { systemId: "VIAPET" }, order: [["createdAt", "DESC"]], limit: 50 });
    return res.json({ data: missions });
  } catch (error) { return res.status(500).json({ message: "Não foi possível listar as missões.", error: error.message }); }
});

router.post("/admin/relationship-radar/simulate", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim().slice(0, 1500);
    if (!message) return res.status(400).json({ message: "Digite uma mensagem para testar." });
    const userId = req.body.userId || null;
    const user = userId ? await Users.findOne({ where: { id: userId, role: "proprietario" }, attributes: ["id"] }) : null;
    if (userId && !user) return res.status(404).json({ message: "Cliente não encontrado." });
    const [knowledge, subscription, payment] = await Promise.all([
      AiKnowledge.findAll({ where: { status: "published" }, attributes: ["title", "keywords", "questions", "content", "videoLink", "internalLink"], limit: 120 }),
      user ? Subscription.findOne({ where: { user_id: user.id }, order: [["created_at", "DESC"]] }) : null,
      user ? PaymentHistory.findOne({ where: { user_id: user.id, status: "approved" }, order: [["date_approved", "DESC"]] }) : null,
    ]);
    const data = previewRelationshipResponse({ message, knowledge, subscription, payment });
    return res.json({ data: { ...data, sent: false, userId: user?.id || null } });
  } catch (error) { return res.status(500).json({ message: "Não foi possível testar a Assistente.", error: error.message }); }
});

router.post("/admin/relationship-radar/missions", async (req, res) => {
  try {
    const userIds = [...new Set(Array.isArray(req.body.userIds) ? req.body.userIds.map(String) : [])];
    const name = String(req.body.name || "").trim().slice(0, 160);
    const instruction = String(req.body.instruction || "").trim().slice(0, 4000);
    if (!name || !instruction || !userIds.length || userIds.length > 25 || userIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return res.status(400).json({ message: "Informe nome, instrução e até 25 clientes válidos." });
    const users = await Users.findAll({ where: { id: userIds, role: "proprietario", status: true }, attributes: ["id", "name", "companyName", "createdAt", "lastAccess", "plan"] });
    if (users.length !== userIds.length) return res.status(400).json({ message: "Há clientes inválidos ou indisponíveis na seleção." });
    const { settings } = await getSettings();
    const results = await assessRelationshipUsers(users, settings);
    const mission = await RelationshipMission.create({ systemId: "VIAPET", name, instruction, userIds, results, status: "observed", createdBy: req.user.id, analyzedAt: new Date() });
    await logActivity({ req, modulo: "relationship_radar", acao: "mission_analyzed", descricao: `Missão ${name}: ${results.length} clientes analisados sem envio.`, entidadeTipo: "relationship_mission", entidadeId: mission.id, metadata: { userIds, decisions: results.map((row) => ({ userId: row.id, state: row.state, nextAction: row.nextAction, reason: row.reason })) } });
    return res.status(201).json({ data: mission });
  } catch (error) { return res.status(500).json({ message: "Não foi possível analisar a missão.", error: error.message }); }
});

export default router;
