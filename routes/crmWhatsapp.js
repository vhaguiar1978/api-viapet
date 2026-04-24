import express from "express";
import axios from "axios";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import Settings from "../models/Settings.js";
import CrmWhatsappMessage from "../models/CrmWhatsappMessage.js";
import Custumers from "../models/Custumers.js";

const router = express.Router();

function getMetaAppId() {
  return readFirstValidEnv([
    "META_APP_ID",
    "METAAPP_ID",
    "METAAPPID",
    "META_APPID",
    "META_APP_ID_ALT",
  ]);
}

function getMetaAppSecret() {
  return readFirstValidEnv([
    "META_APP_SECRET",
    "METAAPP_SECRET",
    "METAAPPSECRET",
    "META_SECRET",
    "META_APP_SECRET_ALT",
  ]);
}

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
}

function readFirstValidEnv(keys = []) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim().replace(/^['"]+|['"]+$/g, "");
    if (normalized) return normalized;
  }
  return "";
}

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

function getMetaErrorMessage(error) {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    ""
  );
}

function isMetaTokenInvalidError(error) {
  const rawMessage = String(getMetaErrorMessage(error) || "").toLowerCase();
  return (
    rawMessage.includes("error validating access token") ||
    rawMessage.includes("session has been invalidated") ||
    rawMessage.includes("access token") && rawMessage.includes("invalid")
  );
}

async function persistInvalidMetaToken(settings, error) {
  if (!settings) return;
  settings.whatsappConnection = {
    ...(settings.whatsappConnection || {}),
    accessToken: "",
    accessTokenConfigured: false,
    oauthConnectedAt: null,
    tokenInvalid: true,
    tokenErrorMessage: getMetaErrorMessage(error),
  };
  await settings.save();
}

router.get("/crm-whatsapp/status", authenticate, async (req, res) => {
  try {
    const settings = await Settings.findOne({
      where: { usersId: getEstablishmentId(req) },
      attributes: ["whatsappConnection"],
    });

    const { config, phoneNumberId, businessAccountId, verifyToken, token } =
      resolveWhatsappConfig(settings);
    const lastWebhookAt = config.lastWebhookAt || null;
    const recentMessages = await CrmWhatsappMessage.count({
      where: {
        usersId: getEstablishmentId(req),
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

    const hasMetaAppId = Boolean(getMetaAppId());
    const hasMetaAppSecret = Boolean(getMetaAppSecret());
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
        oauthAvailable: hasMetaAppId,
        oauthReady: hasMetaAppId && hasMetaAppSecret,
        oauthConnectedAt: config.oauthConnectedAt || null,
        tokenInvalid: Boolean(config.tokenInvalid),
        tokenErrorMessage: config.tokenErrorMessage || "",
      },
    });
  } catch (error) {
    console.error("Erro ao buscar status do WhatsApp CRM:", error);
    return res.status(200).json({
      message: "Status parcial do WhatsApp CRM (modo de contingencia)",
      data: {
        ...{
          provider: "WhatsApp Cloud API",
          configured: false,
          connected: false,
          recentMessages: 0,
          lastWebhookAt: null,
          webhookUrl: `${process.env.URL || ""}/webhook`,
          phoneNumberId: "",
          businessAccountId: "",
          oauthAvailable: Boolean(getMetaAppId()),
          oauthReady: Boolean(getMetaAppId() && getMetaAppSecret()),
          oauthConnectedAt: null,
          tokenInvalid: false,
          tokenErrorMessage: "",
        },
        degraded: true,
      },
    });
  }
});

router.get("/crm-whatsapp/messages", authenticate, async (req, res) => {
  try {
    const { customerId, phone } = req.query;
    const where = {
      usersId: getEstablishmentId(req),
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
      where: { usersId: getEstablishmentId(req) },
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
      usersId: getEstablishmentId(req),
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
        tokenInvalid: false,
        tokenErrorMessage: "",
      };
      await settings.save();
    }

    return res.status(200).json({
      message: "Mensagem enviada com sucesso pelo CRM",
      data: saved,
    });
  } catch (error) {
    console.error("Erro ao enviar mensagem do WhatsApp CRM:", error.response?.data || error);

    if (isMetaTokenInvalidError(error)) {
      try {
        const settings = await Settings.findOne({
          where: { usersId: getEstablishmentId(req) },
        });
        await persistInvalidMetaToken(settings, error);
      } catch (persistError) {
        console.error("Erro ao marcar token invalido do WhatsApp CRM:", persistError);
      }

      return res.status(409).json({
        message: "A conexao com a Meta expirou. Reconecte o WhatsApp para voltar a enviar mensagens.",
        requiresReconnect: true,
        tokenInvalid: true,
      });
    }

    return res.status(500).json({
      message: getMetaErrorMessage(error) || "Nao foi possivel enviar a mensagem pelo WhatsApp CRM",
      error: error.message,
    });
  }
});

router.post("/crm-whatsapp/test-connection", authenticate, async (req, res) => {
  let settings = null;
  try {
    settings = await Settings.findOne({
      where: { usersId: getEstablishmentId(req) },
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

    if (settings) {
      settings.whatsappConnection = {
        ...(settings.whatsappConnection || {}),
        accessTokenConfigured: true,
        tokenInvalid: false,
        tokenErrorMessage: "",
      };
      await settings.save();
    }

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

    if (isMetaTokenInvalidError(error)) {
      try {
        await persistInvalidMetaToken(settings, error);
      } catch (persistError) {
        console.error("Erro ao salvar status de token invalido do WhatsApp CRM:", persistError);
      }

      return res.status(409).json({
        message: "Sua conexao com a Meta expirou. Reconecte o WhatsApp para voltar a receber mensagens.",
        requiresReconnect: true,
        tokenInvalid: true,
        data: {
          phoneNumberId,
          businessAccountId,
        },
      });
    }

    return res.status(500).json({
      message: getMetaErrorMessage(error) || "Nao foi possivel validar a conexao com a Meta",
      error: error.message,
    });
  }
});

// ─── GET /whatsapp-crm-config ───────────────────────────────────────────────
router.get("/whatsapp-crm-config", authenticate, async (req, res) => {
  try {
    const settings = await Settings.findOne({
      where: { usersId: getEstablishmentId(req) },
      attributes: ["whatsappConnection"],
    });

    const { config, phoneNumberId, businessAccountId, verifyToken, token } =
      resolveWhatsappConfig(settings);

    return res.status(200).json({
      message: "Configuracao do WhatsApp CRM carregada com sucesso",
      data: {
        provider: config.provider || "WhatsApp Cloud API",
        phoneNumberId,
        businessAccountId,
        verifyToken,
        accessTokenConfigured: Boolean(config.accessToken || config.accessTokenConfigured || token),
        accessTokenPreview: config.accessToken ? config.accessToken.slice(-4) : token ? "Configurado no servidor" : "",
        defaultCountryCode: config.defaultCountryCode || "55",
        webhookUrl: `${process.env.URL || ""}/webhook`,
        status: phoneNumberId ? "configured" : "pending",
      },
    });
  } catch (error) {
    console.error("Erro ao buscar configuracao do WhatsApp CRM:", error);
    return res.status(500).json({ message: "Erro no servidor", error: error.message });
  }
});

// ─── POST /whatsapp-crm-config ───────────────────────────────────────────────
router.post("/whatsapp-crm-config", authenticate, async (req, res) => {
  try {
    const {
      provider,
      phoneNumberId,
      businessAccountId,
      verifyToken,
      accessToken,
      accessTokenConfigured,
      defaultCountryCode,
    } = req.body || {};

    let settings = await Settings.findOne({
      where: { usersId: getEstablishmentId(req) },
    });

    if (!settings) {
      return res.status(404).json({ message: "Configuracoes do estabelecimento nao encontradas" });
    }

    const current = settings.whatsappConnection || {};

    // Only overwrite accessToken when a new one is provided
    const nextToken = accessToken && String(accessToken).trim() ? String(accessToken).trim() : current.accessToken || "";

    settings.whatsappConnection = {
      ...current,
      provider: provider || current.provider || "WhatsApp Cloud API",
      phoneNumberId: phoneNumberId !== undefined ? String(phoneNumberId || "").trim() : (current.phoneNumberId || ""),
      businessAccountId: businessAccountId !== undefined ? String(businessAccountId || "").trim() : (current.businessAccountId || ""),
      verifyToken: verifyToken !== undefined ? String(verifyToken || "").trim() : (current.verifyToken || ""),
      accessToken: nextToken,
      accessTokenConfigured: Boolean(nextToken || accessTokenConfigured),
      defaultCountryCode: defaultCountryCode || current.defaultCountryCode || "55",
    };

    await settings.save();

    return res.status(200).json({
      message: "Configuracao do WhatsApp CRM salva com sucesso",
      data: {
        provider: settings.whatsappConnection.provider,
        phoneNumberId: settings.whatsappConnection.phoneNumberId,
        businessAccountId: settings.whatsappConnection.businessAccountId,
        verifyToken: settings.whatsappConnection.verifyToken,
        accessTokenConfigured: settings.whatsappConnection.accessTokenConfigured,
        accessTokenPreview: nextToken ? nextToken.slice(-4) : "",
        defaultCountryCode: settings.whatsappConnection.defaultCountryCode,
        webhookUrl: `${process.env.URL || ""}/webhook`,
      },
    });
  } catch (error) {
    console.error("Erro ao salvar configuracao do WhatsApp CRM:", error);
    return res.status(500).json({ message: "Erro no servidor", error: error.message });
  }
});

// ─── POST /crm-whatsapp/broadcast ────────────────────────────────────────────
router.post("/crm-whatsapp/broadcast", authenticate, async (req, res) => {
  try {
    const { message, phones } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({ message: "Mensagem e obrigatoria" });
    }

    const settings = await Settings.findOne({
      where: { usersId: getEstablishmentId(req) },
    });

    const { phoneNumberId, token } = resolveWhatsappConfig(settings);

    if (!phoneNumberId || !token) {
      return res.status(400).json({
        message: "WhatsApp Cloud API nao configurado. Configure o Phone Number ID e o Access Token primeiro.",
      });
    }

    // Build recipient list
    let recipientPhones = [];

    if (Array.isArray(phones) && phones.length > 0) {
      // Explicit list provided
      recipientPhones = phones.map(normalizePhone).filter(Boolean);
    } else {
      // Use all customers with phone
      const customers = await Custumers.findAll({
        where: {
          usersId: getEstablishmentId(req),
          status: true,
          phone: { [Op.not]: null, [Op.ne]: "" },
        },
        attributes: ["phone", "name", "id"],
      });
      recipientPhones = customers
        .map((c) => ({ phone: normalizePhone(c.phone), name: c.name, customerId: c.id }))
        .filter((c) => c.phone);
    }

    if (!recipientPhones.length) {
      return res.status(400).json({ message: "Nenhum destinatario com telefone encontrado" });
    }

    const bodyText = String(message).trim();
    const apiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const results = { sent: 0, failed: 0, errors: [] };

    for (const recipient of recipientPhones) {
      const phone = typeof recipient === "string" ? recipient : recipient.phone;
      const name = typeof recipient === "object" ? recipient.name : null;
      const customerId = typeof recipient === "object" ? recipient.customerId : null;

      try {
        const response = await axios.post(
          apiUrl,
          {
            messaging_product: "whatsapp",
            to: phone,
            type: "text",
            text: { body: bodyText },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        await CrmWhatsappMessage.create({
        usersId: getEstablishmentId(req),
          customerId: customerId || null,
          customerName: name || null,
          phone,
          direction: "outbound",
          channel: "whatsapp",
          messageType: "text",
          body: bodyText,
          whatsappMessageId: response?.data?.messages?.[0]?.id || null,
          status: "sent",
          receivedAt: new Date(),
          payload: response?.data || {},
        });

        results.sent += 1;
      } catch (sendError) {
        if (isMetaTokenInvalidError(sendError)) {
          try {
            await persistInvalidMetaToken(settings, sendError);
          } catch (persistError) {
            console.error("Erro ao salvar token invalido no broadcast CRM:", persistError);
          }

          return res.status(409).json({
            message: "A conexao com a Meta expirou. Reconecte o WhatsApp para voltar a enviar mensagens.",
            requiresReconnect: true,
            tokenInvalid: true,
            data: results,
          });
        }

        results.failed += 1;
        results.errors.push({
          phone,
          error: sendError.response?.data?.error?.message || sendError.message,
        });
      }

      // Small delay to avoid hitting rate limits (10 msgs/sec limit on Cloud API)
      await new Promise((resolve) => setTimeout(resolve, 110));
    }

    return res.status(200).json({
      message: `Disparo concluido: ${results.sent} enviados, ${results.failed} falhas`,
      data: results,
    });
  } catch (error) {
    console.error("Erro no broadcast WhatsApp:", error);
    return res.status(500).json({ message: "Erro no servidor", error: error.message });
  }
});

export default router;
