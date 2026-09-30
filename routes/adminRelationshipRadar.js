import express from "express";
import { Op } from "sequelize";
import adminMiddleware from "../middlewares/admin.js";
import Users from "../models/Users.js";
import ActivityLog from "../models/ActivityLog.js";
import Subscription from "../models/Subscription.js";
import PaymentHistory from "../models/PaymentHistory.js";
import WhatsappConsent from "../models/WhatsappConsent.js";
import WhatsappIaConversation from "../models/WhatsappIaConversation.js";
import SellerCustomer from "../models/SellerCustomer.js";
import RelationshipRadarSetting from "../models/RelationshipRadarSetting.js";
import { RADAR_DEFAULTS, evaluateRelationship } from "../service/relationshipRadarRules.js";

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
    const ids = users.map((user) => user.id);
    const since = new Date(Date.now() - 7 * 86400000);
    const [activities, subscriptions, payments, consents, conversations, sellers] = await Promise.all([
      ActivityLog.findAll({ where: { user_id: { [Op.in]: ids }, created_at: { [Op.gte]: since } }, attributes: ["user_id", "modulo", "acao", "descricao", "metadata_json", "created_at"], order: [["created_at", "DESC"]], limit: 2000 }),
      Subscription.findAll({ where: { user_id: { [Op.in]: ids } }, order: [["created_at", "DESC"]] }),
      PaymentHistory.findAll({ where: { user_id: { [Op.in]: ids }, status: "approved" }, order: [["date_approved", "DESC"]], limit: 200 }),
      WhatsappConsent.findAll({ where: { userId: { [Op.in]: ids } }, order: [["updatedAt", "DESC"]] }),
      WhatsappIaConversation.findAll({ where: { userId: { [Op.in]: ids } }, order: [["updatedAt", "DESC"]] }),
      SellerCustomer.findAll({ where: { systemId: "VIAPET", userId: { [Op.in]: ids } }, attributes: ["userId", "sellerId"] }),
    ]);
    const firstBy = (rows, key) => new Map(rows.slice().reverse().map((row) => [String(row[key]), row]));
    const activityBy = new Map();
    for (const activity of activities) { const key = String(activity.user_id); const list = activityBy.get(key) || []; list.push(activity); activityBy.set(key, list); }
    const subscriptionBy = firstBy(subscriptions, "user_id");
    const paymentBy = firstBy(payments, "user_id");
    const consentBy = firstBy(consents, "userId");
    const conversationBy = firstBy(conversations, "userId");
    const sellerBy = firstBy(sellers, "userId");
    const data = users.map((user) => {
      const id = String(user.id);
      const decision = evaluateRelationship({ user, activities: activityBy.get(id) || [], subscription: subscriptionBy.get(id), payment: paymentBy.get(id), consent: consentBy.get(id), conversation: conversationBy.get(id), sellerId: sellerBy.get(id)?.sellerId, settings });
      return { id: user.id, name: user.companyName || user.name, createdAt: user.createdAt, lastAccess: user.lastAccess, sellerId: sellerBy.get(id)?.sellerId || null, ...decision };
    });
    return res.json({ data, total: count, page, settings });
  } catch (error) { return res.status(500).json({ message: "Não foi possível avaliar os clientes.", error: error.message }); }
});

export default router;
