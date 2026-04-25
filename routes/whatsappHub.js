import express from "express";
import authenticate from "../middlewares/auth.js";
import {
  buildWhatsappHubOverview,
  launchSimpleWhatsapp,
  listRecentWhatsappLogs,
  listWhatsappActivity,
  listWhatsappInbox,
} from "../service/whatsappOfficial/whatsappHubService.js";
import {
  disconnectConnection,
  getCompanyIdFromRequest,
  getConnectionByCompany,
  upsertConnectionForCompany,
} from "../service/whatsappOfficial/whatsappConnectionService.js";
import {
  deleteTemplate,
  listTemplates,
  upsertTemplate,
} from "../service/whatsappOfficial/whatsappTemplateService.js";
import {
  sendTemplateMessage,
  sendTextMessage,
} from "../service/whatsappOfficial/whatsappSendService.js";

const router = express.Router();

function serializeConnection(connection = null) {
  if (!connection) {
    return {
      integrationMode: "simple",
      status: "ready",
      businessId: "",
      businessName: "",
      wabaId: "",
      phoneNumberId: "",
      businessPhone: "",
      verifyToken: "",
      webhookVerified: false,
      lastEventAt: null,
      lastError: "",
      connectedAt: null,
      accessTokenConfigured: false,
    };
  }

  return {
    id: connection.id,
    integrationMode: connection.integrationMode || "simple",
    status: connection.status || "ready",
    businessId: connection.businessId || "",
    businessName: connection.businessName || "",
    wabaId: connection.wabaId || "",
    phoneNumberId: connection.phoneNumberId || "",
    businessPhone: connection.businessPhone || "",
    verifyToken: connection.verifyToken || "",
    webhookVerified: Boolean(connection.webhookVerified),
    lastEventAt: connection.lastEventAt || null,
    lastError: connection.lastError || "",
    connectedAt: connection.connectedAt || null,
    accessTokenConfigured: Boolean(connection.accessTokenEncrypted),
  };
}

function serializeTemplate(template) {
  return {
    id: template.id,
    name: template.templateName,
    templateName: template.templateName,
    title: template.title || template.templateName,
    language: template.language || "pt_BR",
    category: template.category || "",
    body: template.body || "",
    variables: Array.isArray(template.variables) ? template.variables : [],
    active: template.active !== false,
    isSystem: Boolean(template.isSystem),
    status: template.status || "active",
    components: template.components || {},
    sortOrder: Number(template.sortOrder || 0),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

router.get("/api/whatsapp-hub/overview", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const overview = await buildWhatsappHubOverview(companyId);
    return res.json({
      data: {
        connection: serializeConnection(overview.connection),
        templates: overview.templates.map(serializeTemplate),
        activity: overview.activity,
        inbox: overview.inbox,
        logs: overview.logs,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel carregar a central do WhatsApp.",
      error: error.message,
    });
  }
});

router.get("/api/whatsapp-hub/config", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const { connection } = await getConnectionByCompany(companyId);
    return res.json({
      data: serializeConnection(connection),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel carregar a configuracao do WhatsApp.",
      error: error.message,
    });
  }
});

router.put("/api/whatsapp-hub/config", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const payload = req.body || {};
    const integrationMode = String(payload.integrationMode || "simple").trim() || "simple";
    const status =
      integrationMode === "simple"
        ? "ready"
        : payload.phoneNumberId && payload.accessToken
          ? "connected"
          : payload.phoneNumberId
            ? "awaiting_webhook"
            : "awaiting_config";

    const result = await upsertConnectionForCompany(companyId, {
      integrationMode,
      businessId: payload.businessId,
      businessName: payload.businessName,
      wabaId: payload.wabaId,
      phoneNumberId: payload.phoneNumberId,
      businessPhone: payload.businessPhone,
      verifyToken: payload.verifyToken,
      accessToken: payload.accessToken,
      status,
      connectedAt:
        integrationMode === "api" && payload.phoneNumberId
          ? new Date()
          : integrationMode === "simple"
            ? null
            : undefined,
      metadata: {
        ...(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
        updatedBy: req.user?.id || null,
      },
    });

    return res.json({
      message: "Configuracao do WhatsApp atualizada com sucesso.",
      data: serializeConnection(result.connection),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel salvar a configuracao do WhatsApp.",
      error: error.message,
    });
  }
});

router.post("/api/whatsapp-hub/config/disconnect", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    await disconnectConnection(companyId);
    const { connection } = await getConnectionByCompany(companyId);
    return res.json({
      message: "WhatsApp desconectado com sucesso.",
      data: serializeConnection(connection),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel desconectar o WhatsApp.",
      error: error.message,
    });
  }
});

router.get("/api/whatsapp-hub/templates", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const templates = await listTemplates(companyId);
    return res.json({
      data: templates.map(serializeTemplate),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel listar os modelos de mensagem.",
      error: error.message,
    });
  }
});

router.post("/api/whatsapp-hub/templates", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const template = await upsertTemplate(companyId, req.body || {});
    return res.status(201).json({
      message: "Modelo salvo com sucesso.",
      data: serializeTemplate(template),
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Nao foi possivel salvar o modelo.",
    });
  }
});

router.delete("/api/whatsapp-hub/templates/:templateId", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    await deleteTemplate(companyId, req.params.templateId);
    return res.json({ message: "Modelo removido com sucesso." });
  } catch (error) {
    return res.status(404).json({
      message: error.message || "Nao foi possivel remover o modelo.",
    });
  }
});

router.get("/api/whatsapp-hub/activity", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const rows = await listWhatsappActivity(companyId, {
      limit: req.query.limit,
    });
    return res.json({ data: rows });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel carregar o historico do WhatsApp.",
      error: error.message,
    });
  }
});

router.get("/api/whatsapp-hub/inbox", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const rows = await listWhatsappInbox(companyId, {
      limit: req.query.limit,
    });
    return res.json({ data: rows });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel carregar a inbox do WhatsApp.",
      error: error.message,
    });
  }
});

router.get("/api/whatsapp-hub/logs", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const rows = await listRecentWhatsappLogs(companyId, req.query.limit);
    return res.json({ data: rows });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel carregar os logs do WhatsApp.",
      error: error.message,
    });
  }
});

router.post("/api/whatsapp-hub/launch", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const launched = await launchSimpleWhatsapp(companyId, req.body || {});
    return res.status(201).json({
      message: "Acao de WhatsApp simples registrada com sucesso.",
      data: launched,
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Nao foi possivel abrir o WhatsApp simples.",
    });
  }
});

router.post("/api/whatsapp-hub/send", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const {
      to,
      body,
      templateName,
      language,
      components,
      conversationId,
    } = req.body || {};

    const sent = templateName
      ? await sendTemplateMessage({
          companyId,
          to,
          templateName,
          language,
          components,
          conversationId,
        })
      : await sendTextMessage({
          companyId,
          to,
          body,
          conversationId,
        });

    return res.status(201).json({
      message: "Mensagem enviada com sucesso.",
      data: sent,
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Nao foi possivel enviar a mensagem.",
    });
  }
});

export default router;
