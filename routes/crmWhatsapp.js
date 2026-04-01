import express from "express";
import axios from "axios";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import Settings from "../models/Settings.js";
import CrmWhatsappMessage from "../models/CrmWhatsappMessage.js";

const router = express.Router();

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function resolveWhatsappConfig(settings) {
  const config = settings?.whatsappConnection || {};
  return {
    config,
    phoneNumberId:
      config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    businessAccountId:
      config.businessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    verifyToken:
      config.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || "genius",
    token: config.accessToken || process.env.WHATSAPP_TOKEN || "",
  };
}

router.get("/crm-whatsapp/status", authenticate, async (req, res) => {
  try {
    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
      attributes: ["whatsappConnection"],
    });

    const { config, phoneNumberId, businessAccountId, verifyToken, token } =
      resolveWhatsappConfig(settings);
    const lastWebhookAt = config.lastWebhookAt || null;
    const recentMessages = await CrmWhatsappMessage.count({
      where: {
        usersId: req.user.establishment,
        createdAt: {
          [Op.gte]: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
        },
      },
    });

    const isConfigured = Boolean(
      phoneNumberId,
    ) && Boolean(config.accessTokenConfigured || token);

    const isConnected = Boolean(
      lastWebhookAt &&
        new Date(lastWebhookAt).getTime() >= Date.now() - 1000 * 60 * 60 * 24 * 2,
    );

    return res.status(200).json({
      message: "Status do WhatsApp CRM carregado com sucesso",
      data: {
        provider: config.provider || "WhatsApp Cloud API",
        configured: isConfigured,
        phoneNumberId,
        businessAccountId,
        accessNumber:
          config?.accountSettings?.crmAccessWhatsapp ||
          config?.accountSettings?.supportWhatsapp ||
          "",
        webhookValidated: Boolean(verifyToken),
        connected: isConnected,
        lastWebhookAt,
        recentMessages,
        webhookUrl: `${process.env.URL || ""}/webhook`,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar status do WhatsApp CRM:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.get("/crm-whatsapp/messages", authenticate, async (req, res) => {
  try {
    const { customerId, phone } = req.query;
    const where = {
      usersId: req.user.establishment,
    };

    if (customerId) {
      where.customerId = customerId;
    }

    if (phone) {
      where.phone = {
        [Op.like]: `%${String(phone).replace(/\D/g, "")}%`,
      };
    }

    const rows = await CrmWhatsappMessage.findAll({
      where,
      order: [["receivedAt", "DESC"]],
      limit: 200,
    });

    return res.status(200).json({
      message: "Mensagens do WhatsApp CRM carregadas com sucesso",
      data: rows,
    });
  } catch (error) {
    console.error("Erro ao buscar mensagens do WhatsApp CRM:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.post("/crm-whatsapp/send", authenticate, async (req, res) => {
  try {
    const { customerId, customerName, phone, text } = req.body || {};

    if (!phone || !text) {
      return res.status(400).json({
        message: "Telefone e mensagem sao obrigatorios",
      });
    }

    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
    });

    const { config, phoneNumberId, token, verifyToken } =
      resolveWhatsappConfig(settings);

    if (!phoneNumberId || !token) {
      return res.status(400).json({
        message: "WhatsApp Cloud API nao configurado",
      });
    }

    const destinationPhone = normalizePhone(phone);
    const bodyText = String(text || "").trim();

    if (!destinationPhone || !bodyText) {
      return res.status(400).json({
        message: "Telefone ou mensagem invalidos",
      });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: destinationPhone,
        type: "text",
        text: {
          body: bodyText,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    const saved = await CrmWhatsappMessage.create({
      usersId: req.user.establishment,
      customerId: customerId || null,
      customerName: customerName || null,
      phone: destinationPhone,
      direction: "outbound",
      channel: "whatsapp",
      messageType: "text",
      body: bodyText,
      whatsappMessageId: response?.data?.messages?.[0]?.id || null,
      status: "sent",
      receivedAt: new Date(),
      payload: response?.data || {},
    });

    if (settings) {
      settings.whatsappConnection = {
        ...(settings.whatsappConnection || {}),
        provider:
          settings.whatsappConnection?.provider || "WhatsApp Cloud API",
        phoneNumberId,
        verifyToken,
        accessToken: settings.whatsappConnection?.accessToken || token,
        accessTokenConfigured: true,
        lastOutboundAt: new Date().toISOString(),
      };
      await settings.save();
    }

    return res.status(200).json({
      message: "Mensagem enviada com sucesso pelo CRM",
      data: saved,
    });
  } catch (error) {
    console.error("Erro ao enviar mensagem do WhatsApp CRM:", error.response?.data || error);
    return res.status(500).json({
      message: error.response?.data?.error?.message || "Nao foi possivel enviar a mensagem pelo WhatsApp CRM",
      error: error.message,
    });
  }
});

router.post("/crm-whatsapp/test-connection", authenticate, async (req, res) => {
  try {
    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
      attributes: ["whatsappConnection"],
    });

    const { phoneNumberId, businessAccountId, token } =
      resolveWhatsappConfig(settings);

    if (!phoneNumberId || !token) {
      return res.status(400).json({
        message: "Preencha o Phone Number ID e o Access Token para testar a conexao",
      });
    }

    const response = await axios.get(
      `https://graph.facebook.com/v21.0/${phoneNumberId}`,
      {
        params: {
          fields: "id,display_phone_number,verified_name,quality_rating",
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return res.status(200).json({
      message: "Conexao com a Meta validada com sucesso",
      data: {
        phoneNumberId,
        businessAccountId,
        displayPhoneNumber: response?.data?.display_phone_number || "",
        verifiedName: response?.data?.verified_name || "",
        qualityRating: response?.data?.quality_rating || "",
        raw: response?.data || {},
      },
    });
  } catch (error) {
    console.error(
      "Erro ao testar conexao do WhatsApp CRM:",
      error.response?.data || error,
    );
    return res.status(500).json({
      message:
        error.response?.data?.error?.message ||
        "Nao foi possivel validar a conexao com a Meta",
      error: error.message,
    });
  }
});

export default router;
