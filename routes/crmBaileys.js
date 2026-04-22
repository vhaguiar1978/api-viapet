import express from "express";
import authenticate from "../middlewares/auth.js";
import BaileysService from "../service/baileys.js";
import Settings from "../models/Settings.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
}

function normalizeBaileysErrorMessage(errorValue = "") {
  const raw = String(errorValue || "").trim();
  const lower = raw.toLowerCase();

  if (!raw) return "";
  if (lower === "connection failure" || lower.includes("stream errored out")) {
    return "Falha na conexão com o WhatsApp. Vamos gerar uma nova sessão para reconectar.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Tempo de resposta excedido ao conectar no WhatsApp. Tente novamente em alguns segundos.";
  }
  if (lower.includes("forbidden") || lower.includes("blocked")) {
    return "Conexão bloqueada temporariamente pelo WhatsApp. Aguarde e tente novamente.";
  }
  return raw;
}

function buildBaileysConnectPayload(status = {}) {
  const responseStatus = status.qrCode ? "scanning"
    : status.status === "error" ? "error"
    : "connecting";
  const normalizedError = normalizeBaileysErrorMessage(status?.lastError?.message || "");

  return {
    status: responseStatus,
    qrCode: status.qrCode || null,
    lastError: status.lastError
      ? {
          ...status.lastError,
          message: normalizedError || status.lastError.message,
        }
      : null,
    message: responseStatus === "error"
      ? (normalizedError || status.lastError?.message || "Falha ao conectar")
      : "Conectando ao WhatsApp...",
  };
}

// Initialize Baileys connection and get QR code
router.post("/crm-baileys/connect", authenticate, async (req, res) => {
  try {
    const userId = getEstablishmentId(req);
    const establishment = req.body.establishment || "default";

    // Get user settings to verify establishment
    const settings = await Settings.findOne({
      where: { usersId: userId },
    });

    if (!settings) {
      return res.status(404).json({ error: "User settings not found" });
    }

    // Get or create Baileys service instance
    const baileysService = BaileysService.getInstance(userId, establishment);

    // Apply hourly limit from settings (configurable per user)
    const hourlyLimit = settings.whatsappConnection?.baileys?.hourlyLimit || 200;
    baileysService.setHourlyLimit(hourlyLimit);

    // Initialize connection (returns quickly, QR arrives async via events)
    await baileysService.initialize();
    let status = await baileysService.getStatus();
    let payload = buildBaileysConnectPayload(status);

    // Auto-recuperação: quando vier erro genérico, limpa sessão e tenta uma vez de novo
    if (payload.status === "error") {
      const rawError = String(status?.lastError?.message || "").trim().toLowerCase();
      const canRecover =
        rawError === "connection failure" ||
        rawError.includes("stream errored out") ||
        rawError.includes("bad session");

      if (canRecover) {
        try {
          await baileysService.reset();
          BaileysService.resetInstance(userId, establishment);
          const freshService = BaileysService.getInstance(userId, establishment);
          freshService.setHourlyLimit(hourlyLimit);
          await freshService.initialize();
          status = await freshService.getStatus();
          payload = buildBaileysConnectPayload(status);
        } catch (recoverError) {
          console.warn("Baileys auto-recovery failed:", recoverError?.message || recoverError);
        }
      }
    }

    res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    console.error("Error in /crm-baileys/connect:", error);
    res.status(500).json({
      error: "Failed to initiate connection",
      details: error.message,
    });
  }
});

// Get current connection status
router.get("/crm-baileys/status", authenticate, async (req, res) => {
  try {
    const userId = getEstablishmentId(req);
    const establishment = req.query.establishment || "default";

    const baileysService = BaileysService.getInstance(userId, establishment);
    const status = await baileysService.getStatus();

    // Always read DB to get persisted status/QR (handles cold-start cases)
    const settings = await Settings.findOne({ where: { usersId: userId } });
    const dbBaileys = settings?.whatsappConnection?.baileys || {};

    // Prefer in-memory QR, fall back to DB
    const qrCode = status.qrCode || dbBaileys.qrCode || null;
    // Prefer in-memory status, but if memory says "disconnected" and DB says something else, use DB
    const connectionStatus = (status.status !== "disconnected")
      ? status.status
      : (dbBaileys.connectionStatus || "disconnected");

    res.json({
      success: true,
      data: {
        ...status,
        qrCode,
        status: connectionStatus,
        lastError: status.lastError || dbBaileys.lastError || null,
        connectionAttempts: status.connectionAttempts || dbBaileys.connectionAttempts || 0,
      },
    });
  } catch (error) {
    console.error("Error in /crm-baileys/status:", error);
    res.status(500).json({
      error: "Failed to get status",
      details: error.message,
    });
  }
});

// Get fresh QR code
router.get("/crm-baileys/qr", authenticate, async (req, res) => {
  try {
    const userId = getEstablishmentId(req);
    const establishment = req.query.establishment || "default";

    const baileysService = BaileysService.getInstance(userId, establishment);
    const status = await baileysService.getStatus();

    if (!status.qrCode) {
      return res.status(400).json({
        error: "QR code not available",
        message: "Connection may already be established or in an invalid state",
      });
    }

    res.json({
      success: true,
      data: {
        qrCode: status.qrCode,
        status: status.status,
      },
    });
  } catch (error) {
    console.error("Error in /crm-baileys/qr:", error);
    res.status(500).json({
      error: "Failed to get QR code",
      details: error.message,
    });
  }
});

// Disconnect
router.post("/crm-baileys/disconnect", authenticate, async (req, res) => {
  try {
    const userId = getEstablishmentId(req);
    const establishment = req.body.establishment || "default";

    const baileysService = BaileysService.getInstance(userId, establishment);
    await baileysService.disconnect();

    res.json({
      success: true,
      message: "Disconnected successfully",
    });
  } catch (error) {
    console.error("Error in /crm-baileys/disconnect:", error);
    res.status(500).json({
      error: "Failed to disconnect",
      details: error.message,
    });
  }
});

// Force reset: clear auth state, destroy instance, ready for fresh QR
router.post("/crm-baileys/reset", authenticate, async (req, res) => {
  try {
    const userId = getEstablishmentId(req);
    const establishment = req.body.establishment || "default";

    // Reset the existing instance (clears DB auth state too)
    const baileysService = BaileysService.getInstance(userId, establishment);
    await baileysService.reset();

    // Remove from singleton map so next call creates a clean instance
    BaileysService.resetInstance(userId, establishment);

    res.json({
      success: true,
      message: "Conexão resetada com sucesso. Clique em Conectar para gerar um novo QR code.",
    });
  } catch (error) {
    console.error("Error in /crm-baileys/reset:", error);
    res.status(500).json({
      error: "Failed to reset connection",
      details: error.message,
    });
  }
});

// Send message via Baileys
router.post("/crm-baileys/send", authenticate, async (req, res) => {
  try {
    const userId = getEstablishmentId(req);
    const { phone, text, conversationId } = req.body;
    const establishment = req.body.establishment || "default";

    // Validate input
    if (!phone || !text) {
      return res.status(400).json({
        error: "Missing required fields: phone and text",
      });
    }

    const baileysService = BaileysService.getInstance(userId, establishment);

    // Check if connected
    const isConnected = await baileysService.isConnected();
    if (!isConnected) {
      return res.status(400).json({
        error: "Baileys not connected. Please connect first.",
        status: await baileysService.getStatus(),
      });
    }

    // Send message
    const result = await baileysService.sendMessage(phone, text);

    // Save to database if conversationId provided
    if (conversationId) {
      try {
        const conversation = await CrmConversation.findByPk(conversationId);
        if (conversation) {
          await CrmConversationMessage.create({
            id: uuidv4(),
            conversationId: conversationId,
            usersId: userId,
            customerId: conversation.customerId,
            direction: "outbound",
            channel: "baileys",
            messageType: "text",
            body: text,
            providerMessageId: result.key?.id || `local_${Date.now()}`,
            status: "sent",
            sentAt: new Date(),
            payload: result,
          });

          // Update conversation last message
          conversation.lastMessagePreview = text.substring(0, 100);
          conversation.lastMessageAt = new Date();
          conversation.lastOutboundAt = new Date();
          await conversation.save();
        }
      } catch (dbError) {
        console.warn("Failed to save message to database:", dbError.message);
        // Continue anyway - message was sent even if DB save failed
      }
    }

    res.json({
      success: true,
      data: {
        message: "Message sent successfully",
        messageId: result.key?.id || `local_${Date.now()}`,
        phone,
      },
    });
  } catch (error) {
    console.error("Error in /crm-baileys/send:", error);

    // Check if it's a rate limit error
    if (error.message.includes("Rate limit exceeded")) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        message:
          "Maximum 60 messages per hour. Please wait before sending more.",
        details: error.message,
      });
    }

    res.status(500).json({
      error: "Failed to send message",
      details: error.message,
    });
  }
});

// Get health status and ban risk
router.get("/crm-baileys/health", authenticate, async (req, res) => {
  try {
    const userId = getEstablishmentId(req);

    const settings = await Settings.findOne({
      where: { usersId: userId },
    });

    if (!settings) {
      return res.status(404).json({ error: "Settings not found" });
    }

    const baileysConfig = settings.whatsappConnection?.baileys || {};
    const health = baileysConfig.health || {
      messagesLastHour: 0,
      totalMessagesThisMonth: 0,
      riskScore: 0,
      errorCount: 0,
    };

    // Determine recommended action based on risk score
    let recommendedAction = null;
    if (health.riskScore > 0.7) {
      recommendedAction =
        "⚠️ High ban risk. Consider pausing automation for 24 hours.";
    } else if (health.riskScore > 0.5) {
      recommendedAction = "⚠️ Moderate ban risk. Monitor closely.";
    }

    res.json({
      success: true,
      data: {
        status: baileysConfig.connectionStatus || "unknown",
        health,
        connectedPhone: baileysConfig.connectedPhone || null,
        hourlyLimit: baileysConfig.hourlyLimit || 200,
        recommendedAction,
        warningLevel:
          health.riskScore > 0.7
            ? "critical"
            : health.riskScore > 0.5
              ? "warning"
              : "safe",
      },
    });
  } catch (error) {
    console.error("Error in /crm-baileys/health:", error);
    res.status(500).json({
      error: "Failed to get health status",
      details: error.message,
    });
  }
});

// Update hourly send limit
router.post("/crm-baileys/config", authenticate, async (req, res) => {
  try {
    const userId = getEstablishmentId(req);
    const { hourlyLimit } = req.body;

    if (hourlyLimit !== undefined && (isNaN(hourlyLimit) || hourlyLimit < 10 || hourlyLimit > 500)) {
      return res.status(400).json({ error: "hourlyLimit deve ser entre 10 e 500" });
    }

    const settings = await Settings.findOne({ where: { usersId: userId } });
    if (!settings) return res.status(404).json({ error: "Settings not found" });

    const baileysConfig = settings.whatsappConnection?.baileys || {};
    settings.whatsappConnection = {
      ...settings.whatsappConnection,
      baileys: {
        ...baileysConfig,
        ...(hourlyLimit !== undefined && { hourlyLimit: Number(hourlyLimit) }),
      },
    };
    await settings.save();

    // Apply immediately to running instance
    const establishment = req.body.establishment || "default";
    const baileysService = BaileysService.getInstance(userId, establishment);
    if (hourlyLimit !== undefined) baileysService.setHourlyLimit(hourlyLimit);

    res.json({ success: true, data: { hourlyLimit: Number(hourlyLimit) } });
  } catch (error) {
    console.error("Error in /crm-baileys/config:", error);
    res.status(500).json({ error: "Failed to update config", details: error.message });
  }
});

export default router;
