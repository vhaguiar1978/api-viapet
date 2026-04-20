import express from "express";
import authenticate from "../middlewares/auth.js";
import BaileysService from "../service/baileys.js";
import Settings from "../models/Settings.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Initialize Baileys connection and get QR code
router.post("/crm-baileys/connect", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
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

    // Initialize connection
    await baileysService.initialize();

    // Get initial status
    const status = await baileysService.getStatus();

    res.json({
      success: true,
      data: {
        status: status.status,
        qrCode: status.qrCode,
        message: "Connection initiated, QR code generated. Scan with your phone to connect.",
      },
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
    const { userId } = req.user;
    const establishment = req.query.establishment || "default";

    const baileysService = BaileysService.getInstance(userId, establishment);
    const status = await baileysService.getStatus();

    res.json({
      success: true,
      data: status,
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
    const { userId } = req.user;
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
    const { userId } = req.user;
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

// Send message via Baileys
router.post("/crm-baileys/send", authenticate, async (req, res) => {
  try {
    const { userId } = req.user;
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
    const { userId } = req.user;
    const establishment = req.query.establishment || "default";

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

export default router;
