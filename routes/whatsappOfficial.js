import express from "express";
import axios from "axios";
import authenticate from "../middlewares/auth.js";
import {
  buildWebhookChallengeResponse,
  isValidWebhookSignature,
  isValidWebhookVerifyToken,
  processWebhookPayload,
} from "../service/whatsappOfficial/whatsappWebhookService.js";
import {
  disconnectConnection,
  getCompanyIdFromRequest,
  getConnectionByCompany,
  upsertConnectionForCompany,
} from "../service/whatsappOfficial/whatsappConnectionService.js";
import { sendTemplateMessage, sendTextMessage } from "../service/whatsappOfficial/whatsappSendService.js";
import { listTemplates, upsertTemplate } from "../service/whatsappOfficial/whatsappTemplateService.js";

const router = express.Router();

router.get("/api/webhooks/whatsapp", async (req, res) => {
  const { mode, token, challenge } = buildWebhookChallengeResponse(req);
  if (mode !== "subscribe" || !challenge) {
    return res.status(403).send("Forbidden");
  }
  const valid = await isValidWebhookVerifyToken(token);
  if (!valid) {
    return res.status(403).send("Forbidden");
  }
  return res.status(200).send(challenge);
});

router.post("/api/webhooks/whatsapp", async (req, res) => {
  if (!isValidWebhookSignature(req)) {
    return res.status(403).json({ message: "Assinatura do webhook invalida" });
  }

  res.status(200).json({ received: true });
  setImmediate(async () => {
    try {
      await processWebhookPayload(req.body || {});
    } catch (error) {
      console.error("[WHATSAPP WEBHOOK] Erro ao processar payload:", error);
    }
  });
});

router.get("/api/whatsapp/connections/status", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const { connection } = await getConnectionByCompany(companyId);
    return res.json({
      data: {
        companyId,
        status: connection.status,
        wabaId: connection.wabaId || "",
        phoneNumberId: connection.phoneNumberId || "",
        businessPhone: connection.businessPhone || "",
        webhookVerified: Boolean(connection.webhookVerified),
        lastEventAt: connection.lastEventAt || null,
        lastError: connection.lastError || "",
        accessTokenConfigured: Boolean(connection.accessTokenEncrypted),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao carregar status da conexao", error: error.message });
  }
});

router.post("/api/whatsapp/connections", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const {
      phoneNumberId,
      wabaId,
      businessPhone,
      verifyToken,
      accessToken,
    } = req.body || {};

    const result = await upsertConnectionForCompany(companyId, {
      phoneNumberId,
      wabaId,
      businessPhone,
      verifyToken,
      accessToken,
      status: phoneNumberId && accessToken ? "connected" : "disconnected",
      metadata: {
        configuredBy: req.user?.id || null,
      },
    });

    return res.json({
      message: "Conexao do WhatsApp atualizada com sucesso",
      data: {
        companyId,
        status: result.connection.status,
        phoneNumberId: result.connection.phoneNumberId || "",
        wabaId: result.connection.wabaId || "",
        businessPhone: result.connection.businessPhone || "",
        webhookVerified: Boolean(result.connection.webhookVerified),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao salvar conexao", error: error.message });
  }
});

router.post("/api/whatsapp/connections/test", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const { connection, accessToken } = await getConnectionByCompany(companyId);

    if (!connection.phoneNumberId || !accessToken) {
      return res.status(400).json({
        message: "Informe Phone Number ID e Access Token para testar a conexao",
      });
    }

    const response = await axios.get(
      `https://graph.facebook.com/v21.0/${connection.phoneNumberId}`,
      {
        params: {
          fields: "id,display_phone_number,verified_name,quality_rating",
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    await upsertConnectionForCompany(companyId, {
      status: "connected",
      webhookVerified: Boolean(connection.webhookVerified),
      lastError: null,
      businessPhone:
        response?.data?.display_phone_number || connection.businessPhone || "",
      metadata: {
        ...(connection.metadata || {}),
        qualityRating: response?.data?.quality_rating || "",
      },
    });

    return res.json({
      message: "Conexao validada com sucesso",
      data: {
        phoneNumberId: connection.phoneNumberId,
        displayPhoneNumber: response?.data?.display_phone_number || "",
        verifiedName: response?.data?.verified_name || "",
        qualityRating: response?.data?.quality_rating || "",
      },
    });
  } catch (error) {
    return res.status(500).json({
      message:
        error?.response?.data?.error?.message ||
        "Nao foi possivel validar a conexao",
      error: error.message,
    });
  }
});

router.post("/api/whatsapp/connections/disconnect", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    await disconnectConnection(companyId);
    return res.json({ message: "Conexao desconectada com sucesso" });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao desconectar", error: error.message });
  }
});

router.post("/api/whatsapp/messages/send-text", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const { to, body, conversationId } = req.body || {};
    if (!to || !String(body || "").trim()) {
      return res.status(400).json({ message: "Telefone e texto sao obrigatorios" });
    }
    const sent = await sendTextMessage({
      companyId,
      to,
      body: String(body || ""),
      conversationId: conversationId || null,
    });
    return res.status(201).json({
      message: "Mensagem enviada com sucesso",
      data: sent,
    });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao enviar mensagem", error: error.message });
  }
});

router.post("/api/whatsapp/messages/send-template", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const { to, templateName, language, components, conversationId } = req.body || {};
    if (!to || !String(templateName || "").trim()) {
      return res.status(400).json({ message: "Telefone e template_name sao obrigatorios" });
    }
    const sent = await sendTemplateMessage({
      companyId,
      to,
      templateName: String(templateName || ""),
      language: String(language || "pt_BR"),
      components: Array.isArray(components) ? components : [],
      conversationId: conversationId || null,
    });
    return res.status(201).json({
      message: "Template enviado com sucesso",
      data: sent,
    });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao enviar template", error: error.message });
  }
});

router.get("/api/whatsapp/templates", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const rows = await listTemplates(companyId);
    return res.json({ data: rows });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao listar templates", error: error.message });
  }
});

router.post("/api/whatsapp/templates", authenticate, async (req, res) => {
  try {
    const companyId = getCompanyIdFromRequest(req);
    const template = await upsertTemplate(companyId, req.body || {});
    return res.status(201).json({
      message: "Template salvo com sucesso",
      data: template,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Erro ao salvar template" });
  }
});

export default router;
