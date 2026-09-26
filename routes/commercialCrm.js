import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import CommercialLead from "../models/CommercialLead.js";
import Seller from "../models/Seller.js";
import CommercialLeadEvent from "../models/CommercialLeadEvent.js";
import CommercialAiSetting from "../models/CommercialAiSetting.js";
import CommercialActivity from "../models/CommercialActivity.js";
import sequelize from "../database/config.js";
import authenticate from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import { generateCommercialCopilot } from "../service/commercialAiCopilot.js";

const router = express.Router();
const STAGES = ["found", "qualified", "contact_started", "replied", "interested", "demo", "trial", "negotiation", "won", "lost"];
const admin = [authenticate, adminMiddleware];
const secret = () => process.env.JWT_SECRET || process.env.JWTSECRET || process.env.JWT_SECRET_KEY;
const auth = async (req, res, next) => { try { const decoded = jwt.verify(req.headers.authorization?.split(" ")[1], secret()); if (decoded.role !== "seller") return res.status(403).json({ message: "Acesso restrito." }); const seller = await Seller.findOne({ where: { id: decoded.id, systemId: "VIAPET", status: "active" } }); if (!seller) return res.status(403).json({ message: "Acesso não liberado." }); req.seller = seller; next(); } catch { return res.status(401).json({ message: "Sessão inválida." }); } };
const cleanPhone = (value) => String(value || "").replace(/\D/g, "");

async function googleSearch({ segment, state, city, neighborhood, limit }) {
  if (!process.env.GOOGLE_PLACES_API_KEY) return null;
  const textQuery = [segment, neighborhood, city, state, "Brasil"].filter(Boolean).join(" em ");
  const response = await axios.post("https://places.googleapis.com/v1/places:searchText", { textQuery, languageCode: "pt-BR", regionCode: "BR", pageSize: Math.min(limit, 20) }, { headers: { "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.location" }, timeout: 15000 });
  return (response.data.places || []).map((place) => ({ sourceProvider: "google_places", externalId: place.id, businessName: place.displayName?.text || "Empresa", address: place.formattedAddress, phone: cleanPhone(place.nationalPhoneNumber), whatsapp: cleanPhone(place.nationalPhoneNumber), website: place.websiteUri, latitude: place.location?.latitude, longitude: place.location?.longitude }));
}

router.get("/commercial/leads", auth, async (req, res) => {
  const rows = await CommercialLead.findAll({ where: { systemId: "VIAPET", sellerId: req.seller.id, ownerType: "seller" }, order: [["updatedAt", "DESC"]], limit: 500 });
  return res.json({ ok: true, data: rows });
});

router.post("/commercial/prospecting/search", auth, async (req, res) => {
  try {
    const segment = String(req.body.segment || "").trim(), state = String(req.body.state || "").trim(), city = String(req.body.city || "").trim(), neighborhood = String(req.body.neighborhood || "").trim();
    const limit = Math.min(20, Math.max(1, Number(req.body.limit || 20)));
    if (!segment || !state || !city) return res.status(400).json({ message: "Informe segmento, estado e cidade." });
    const found = await googleSearch({ segment, state, city, neighborhood, limit });
    if (!found) return res.status(503).json({ message: "Configure GOOGLE_PLACES_API_KEY para ativar a busca comercial. O modo público gratuito não é seguro para prospecção em produção." });
    const saved = [];
    for (const item of found) {
      const [lead, created] = await CommercialLead.findOrCreate({ where: { systemId: "VIAPET", sourceProvider: item.sourceProvider, externalId: item.externalId }, defaults: { ...item, sellerId: req.seller.id, ownerType: "seller", segment, state, city, neighborhood, stage: "found", contactPermission: "unknown", metadata: { search: { segment, state, city, neighborhood } } } });
      if (created) await CommercialLeadEvent.create({ systemId: "VIAPET", leadId: lead.id, eventType: "lead_found", newStage: "found", newSellerId: req.seller.id, actorType: "seller", actorId: req.seller.id, metadata: { provider: item.sourceProvider } });
      if (lead.sellerId === req.seller.id) saved.push(lead);
    }
    return res.json({ ok: true, data: saved, provider: "google_places", duplicatesRemoved: found.length - saved.filter((item) => item.isNewRecord).length });
  } catch (error) { return res.status(error.response?.status || 500).json({ message: "Não foi possível concluir a busca agora.", error: error.response?.data?.error?.message || error.message }); }
});

router.patch("/commercial/leads/:id", auth, async (req, res) => {
  const lead = await CommercialLead.findOne({ where: { id: req.params.id, sellerId: req.seller.id, systemId: "VIAPET" } });
  if (!lead) return res.status(404).json({ message: "Lead não encontrado." });
  const allowed = ["stage", "contactPermission", "nextActionAt", "aiEnabled", "lossReason"];
  const patch = {}; for (const key of allowed) if (key in req.body) patch[key] = req.body[key];
  if (patch.stage && !STAGES.includes(patch.stage)) return res.status(400).json({ message: "Etapa comercial inválida." });
  if (patch.stage === "lost" && !String(patch.lossReason || lead.lossReason || "").trim()) return res.status(400).json({ message: "Informe o motivo da perda para encerrar este lead." });
  if (patch.aiEnabled && lead.contactPermission !== "opted_in" && patch.contactPermission !== "opted_in") return res.status(400).json({ message: "A IA só pode contatar leads com permissão registrada." });
  const previousStage = lead.stage;
  await sequelize.transaction(async (transaction) => {
    await lead.update(patch, { transaction });
    if (patch.stage && patch.stage !== previousStage) await CommercialLeadEvent.create({ systemId: "VIAPET", leadId: lead.id, eventType: "stage_changed", previousStage, newStage: patch.stage, actorType: "seller", actorId: req.seller.id }, { transaction });
    if (patch.contactPermission) await CommercialLeadEvent.create({ systemId: "VIAPET", leadId: lead.id, eventType: "contact_permission_changed", actorType: "seller", actorId: req.seller.id, metadata: { contactPermission: patch.contactPermission } }, { transaction });
  });
  return res.json({ ok: true, data: lead });
});

router.get("/commercial/leads/:id/timeline", auth, async (req, res) => {
  const lead = await CommercialLead.findOne({ where: { id: req.params.id, sellerId: req.seller.id, systemId: "VIAPET" } });
  if (!lead) return res.status(404).json({ message: "Lead não encontrado." });
  const events = await CommercialLeadEvent.findAll({ where: { leadId: lead.id, systemId: "VIAPET" }, order: [["createdAt", "DESC"]], limit: 200 });
  return res.json({ ok: true, data: events });
});

router.get("/commercial/leads/:id", auth, async (req, res) => {
  const lead = await CommercialLead.findOne({ where: { id: req.params.id, sellerId: req.seller.id, systemId: "VIAPET" } });
  if (!lead) return res.status(404).json({ message: "Lead não encontrado." });
  const [events, activities] = await Promise.all([CommercialLeadEvent.findAll({ where: { leadId: lead.id, systemId: "VIAPET" }, order: [["createdAt", "DESC"]], limit: 100 }), CommercialActivity.findAll({ where: { leadId: lead.id, sellerId: req.seller.id, systemId: "VIAPET" }, order: [["status", "ASC"], ["dueAt", "ASC"]] })]);
  return res.json({ ok: true, data: { lead, events, activities } });
});

router.post("/commercial/leads/:id/ai-copilot", auth, async (req, res) => {
  try {
    const lead = await CommercialLead.findOne({ where: { id: req.params.id, sellerId: req.seller.id, ownerType: "seller", systemId: "VIAPET" } });
    if (!lead) return res.status(404).json({ message: "Lead não encontrado na sua carteira." });
    const [settings] = await CommercialAiSetting.findOrCreate({ where: { systemId: "VIAPET" }, defaults: {} });
    if (!settings.active) return res.status(403).json({ message: "A IA comercial está pausada pelo administrador." });
    const suggestion = await generateCommercialCopilot({ lead, objective: req.body.objective, tone: req.body.tone });
    await CommercialLeadEvent.create({ systemId: "VIAPET", leadId: lead.id, eventType: "ai_copilot_suggestion", actorType: "ai", actorId: req.seller.id, metadata: { objective: req.body.objective || "primeiro_contato", suggestion } });
    return res.json({ ok: true, data: suggestion, safety: { draftOnly: true, sent: false, contactPermission: lead.contactPermission } });
  } catch (error) {
    console.error("[commercial-ai-copilot]", error.message);
    return res.status(502).json({ message: error.message || "Não foi possível gerar a sugestão agora." });
  }
});

router.post("/commercial/leads/:id/activities", auth, async (req, res) => {
  const lead = await CommercialLead.findOne({ where: { id: req.params.id, sellerId: req.seller.id, systemId: "VIAPET" } });
  if (!lead) return res.status(404).json({ message: "Lead não encontrado." });
  const title = String(req.body.title || "").trim();
  if (!title) return res.status(400).json({ message: "Informe a próxima ação." });
  const activity = await sequelize.transaction(async (transaction) => {
    const row = await CommercialActivity.create({ systemId: "VIAPET", leadId: lead.id, sellerId: req.seller.id, type: req.body.type || "follow_up", title, notes: req.body.notes || null, dueAt: req.body.dueAt || null }, { transaction });
    await lead.update({ nextActionAt: row.dueAt }, { transaction });
    await CommercialLeadEvent.create({ systemId: "VIAPET", leadId: lead.id, eventType: "activity_created", actorType: "seller", actorId: req.seller.id, metadata: { activityId: row.id, type: row.type, dueAt: row.dueAt } }, { transaction });
    return row;
  });
  return res.status(201).json({ ok: true, data: activity });
});

router.patch("/commercial/activities/:id", auth, async (req, res) => {
  const activity = await CommercialActivity.findOne({ where: { id: req.params.id, sellerId: req.seller.id, systemId: "VIAPET" } });
  if (!activity) return res.status(404).json({ message: "Atividade não encontrada." });
  if (req.body.status === "completed") await activity.update({ status: "completed", completedAt: new Date() });
  return res.json({ ok: true, data: activity });
});

router.get("/admin/commercial/leads", ...admin, async (_req, res) => {
  const [leads, sellers] = await Promise.all([CommercialLead.findAll({ where: { systemId: "VIAPET" }, order: [["updatedAt", "DESC"]], limit: 1000 }), Seller.findAll({ where: { systemId: "VIAPET", status: "active" }, attributes: ["id", "name"] })]);
  const names = new Map(sellers.map((item) => [item.id, item.name]));
  return res.json({ ok: true, data: leads.map((lead) => ({ ...lead.toJSON(), sellerName: names.get(lead.sellerId) || (lead.ownerType === "ai" ? "IA ViaPet" : "Sem responsável") })), sellers });
});

router.patch("/admin/commercial/leads/:id/owner", ...admin, async (req, res) => {
  const lead = await CommercialLead.findOne({ where: { id: req.params.id, systemId: "VIAPET" } });
  if (!lead) return res.status(404).json({ message: "Lead não encontrado." });
  const ownerType = req.body.ownerType === "ai" ? "ai" : "seller";
  const sellerId = ownerType === "seller" ? req.body.sellerId : null;
  if (ownerType === "seller" && !await Seller.count({ where: { id: sellerId, systemId: "VIAPET", status: "active" } })) return res.status(400).json({ message: "Selecione um vendedor ativo." });
  const previousSellerId = lead.sellerId;
  await sequelize.transaction(async (transaction) => { await lead.update({ ownerType, sellerId }, { transaction }); await CommercialLeadEvent.create({ systemId: "VIAPET", leadId: lead.id, eventType: "owner_changed", previousSellerId, newSellerId: sellerId, actorType: "admin", actorId: req.user.id, reason: req.body.reason || null, metadata: { ownerType } }, { transaction }); });
  return res.json({ ok: true, data: lead });
});

router.get("/admin/commercial/ai-settings", ...admin, async (_req, res) => {
  const [settings] = await CommercialAiSetting.findOrCreate({ where: { systemId: "VIAPET" }, defaults: {} });
  return res.json({ ok: true, data: settings });
});

router.put("/admin/commercial/ai-settings", ...admin, async (req, res) => {
  const [settings] = await CommercialAiSetting.findOrCreate({ where: { systemId: "VIAPET" }, defaults: {} });
  const mode = ["suggest_only", "qualification", "autonomous"].includes(req.body.mode) ? req.body.mode : settings.mode;
  const dailyLeadLimit = Math.min(500, Math.max(1, Number(req.body.dailyLeadLimit || settings.dailyLeadLimit)));
  const dailyContactLimit = Math.min(200, Math.max(0, Number(req.body.dailyContactLimit ?? settings.dailyContactLimit)));
  if (mode === "autonomous" && req.body.requireOptIn === false) return res.status(400).json({ message: "O modo autônomo exige controle de opt-in." });
  await settings.update({ active: req.body.active === true, mode, states: Array.isArray(req.body.states) ? req.body.states : settings.states, cities: Array.isArray(req.body.cities) ? req.body.cities : settings.cities,
    segments: Array.isArray(req.body.segments) ? req.body.segments : settings.segments, dailyLeadLimit, dailyContactLimit, contactStartTime: req.body.contactStartTime || settings.contactStartTime,
    contactEndTime: req.body.contactEndTime || settings.contactEndTime, requireOptIn: true, pauseOnHumanReply: req.body.pauseOnHumanReply !== false, updatedBy: req.user.id });
  return res.json({ ok: true, data: settings });
});

export default router;
