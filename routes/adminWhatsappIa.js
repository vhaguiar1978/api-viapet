import express from "express";
import adminMiddleware from "../middlewares/admin.js";
import {
  createOrUpdateConsent,
  getConfigSummary,
  getConversationDetail,
  getDashboard,
  listConversations,
  listInactiveUsers,
  listKnowledge,
  scanInactiveUsers,
  startInactiveConversation,
  testAiResponse,
  updateConversationAction,
  upsertKnowledge,
} from "../service/adminWhatsappIa.js";

const router = express.Router();

router.use("/admin/whatsapp-ia", adminMiddleware);

router.get("/admin/whatsapp-ia/dashboard", async (req, res) => {
  try {
    const data = await getDashboard({ period: req.query.period || "30d" });
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: "Nao foi possivel carregar a visao geral do WhatsApp IA", error: error.message });
  }
});

router.get("/admin/whatsapp-ia/conversations", async (req, res) => {
  try {
    const data = await listConversations({
      status: req.query.status || "",
      search: req.query.search || "",
      limit: req.query.limit || 40,
    });
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: "Nao foi possivel listar conversas", error: error.message });
  }
});

router.get("/admin/whatsapp-ia/conversations/:id", async (req, res) => {
  try {
    const data = await getConversationDetail(req.params.id);
    if (!data) return res.status(404).json({ message: "Conversa nao encontrada" });
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: "Nao foi possivel carregar a conversa", error: error.message });
  }
});

router.post("/admin/whatsapp-ia/conversations/:id/action", async (req, res) => {
  try {
    const data = await updateConversationAction({
      id: req.params.id,
      action: req.body?.action,
      payload: req.body || {},
      adminUserId: req.user.id,
    });
    return res.json({ message: "Conversa atualizada com sucesso", data });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Nao foi possivel atualizar a conversa" });
  }
});

router.get("/admin/whatsapp-ia/inactive-users", async (req, res) => {
  try {
    const data = await listInactiveUsers({
      days: req.query.days || undefined,
      search: req.query.search || "",
      limit: req.query.limit || 80,
    });
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: "Nao foi possivel listar usuarios inativos", error: error.message });
  }
});

router.post("/admin/whatsapp-ia/inactive-users/scan", async (req, res) => {
  try {
    const data = await scanInactiveUsers({ days: req.body?.days || req.query.days || undefined });
    return res.json({ message: "Usuarios inativos atualizados", data });
  } catch (error) {
    return res.status(500).json({ message: "Nao foi possivel executar a verificacao", error: error.message });
  }
});

router.post("/admin/whatsapp-ia/inactive-users/:userId/start", async (req, res) => {
  try {
    const data = await startInactiveConversation({ adminUserId: req.user.id, userId: req.params.userId });
    return res.status(201).json({ message: "Conversa iniciada com sucesso", data });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Nao foi possivel iniciar conversa" });
  }
});

router.post("/admin/whatsapp-ia/consents/:userId", async (req, res) => {
  try {
    const data = await createOrUpdateConsent({
      userId: req.params.userId,
      consentStatus: req.body?.consentStatus || "granted",
      source: req.body?.source || "admin",
    });
    return res.json({ message: "Consentimento atualizado", data });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Nao foi possivel atualizar consentimento" });
  }
});

router.get("/admin/whatsapp-ia/knowledge", async (req, res) => {
  try {
    const data = await listKnowledge({
      search: req.query.search || "",
      category: req.query.category || "",
      status: req.query.status || "",
    });
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: "Nao foi possivel listar conhecimento", error: error.message });
  }
});

router.post("/admin/whatsapp-ia/knowledge", async (req, res) => {
  try {
    const data = await upsertKnowledge(req.body || {}, req.user.id);
    return res.status(201).json({ message: "Conhecimento salvo com sucesso", data });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Nao foi possivel salvar conhecimento" });
  }
});

router.post("/admin/whatsapp-ia/test-ai", async (req, res) => {
  try {
    const data = await testAiResponse({
      message: req.body?.message || "",
      userId: req.body?.userId || null,
      adminUserId: req.user.id,
    });
    return res.json({ data });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Nao foi possivel testar a IA" });
  }
});

router.get("/admin/whatsapp-ia/config", async (_req, res) => {
  try {
    const data = await getConfigSummary();
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: "Nao foi possivel carregar configuracoes", error: error.message });
  }
});

export default router;
