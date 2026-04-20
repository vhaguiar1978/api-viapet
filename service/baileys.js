import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  isJidBroadcast,
} from "baileys";
import qrcode from "qrcode";
import Settings from "../models/Settings.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import Custumers from "../models/Custumers.js";
import { v4 as uuidv4 } from "uuid";

class BaileysService {
  constructor(userId, establishment) {
    this.userId = userId;
    this.establishment = establishment;
    this.sock = null;
    this.authState = null;
    this.qrCode = null;
    this.connectionStatus = "disconnected";
    this.messageQueue = [];
    this.lastMessageTime = 0;
    this.messageTimestamps = [];
    this.errorPatterns = [];
    this.isInitializing = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async initialize() {
    // Prevent concurrent initializations
    if (this.isInitializing) {
      console.log(`[Baileys] Already initializing for user ${this.userId}, skipping`);
      return { success: true };
    }
    // If already connected or scanning, don't reinitialize
    if (this.connectionStatus === "connected" || this.connectionStatus === "scanning") {
      console.log(`[Baileys] Already ${this.connectionStatus} for user ${this.userId}, skipping`);
      return { success: true };
    }
    // Stop if max retries exceeded
    if (this.retryCount >= this.maxRetries) {
      console.log(`[Baileys] Max retries (${this.maxRetries}) reached for user ${this.userId}`);
      this.connectionStatus = "error";
      return { success: false };
    }

    this.isInitializing = true;
    try {
      const settings = await Settings.findOne({
        where: { usersId: this.userId },
      });

      if (!settings) {
        throw new Error("Settings not found for user");
      }

      // Close existing socket before creating new one
      if (this.sock) {
        try { this.sock.end(); } catch (_) {}
        this.sock = null;
      }

      const { state: auth, saveCreds } = await useMultiFileAuthState(
        `./auth_info_baileys_${this.userId}`,
      );
      this.authState = auth;
      this.saveCreds = saveCreds;

      this.sock = makeWASocket({
        auth,
        printQRInTerminal: false,
        connectTimeoutMs: 30000,
        retryRequestDelayMs: 2000,
      });

      this.sock.ev.on("connection.update", this.handleConnectionUpdate.bind(this));
      this.sock.ev.on("messages.upsert", this.handleMessagesUpsert.bind(this));
      this.sock.ev.on("message.reaction", this.handleMessageReaction.bind(this));
      this.sock.ev.on("creds.update", this.saveCreds);

      this.connectionStatus = "connecting";
      await this.updateSettings(settings);
      return { success: true };
    } catch (error) {
      console.error("Error initializing Baileys:", error);
      this.connectionStatus = "error";
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.qrCode = await qrcode.toDataURL(qr);
      this.connectionStatus = "scanning";
      this.retryCount = 0; // Reset retries when QR arrives
      await this.updateSettingsInDb();
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      if (isLoggedOut) {
        this.connectionStatus = "disconnected";
        this.qrCode = null;
        this.retryCount = 0;
      } else {
        this.retryCount += 1;
        if (this.retryCount < this.maxRetries) {
          console.log(`[Baileys] Connection closed, retry ${this.retryCount}/${this.maxRetries}`);
          this.connectionStatus = "connecting";
          const delay = this.retryCount * 3000;
          setTimeout(() => this.initialize(), delay);
        } else {
          console.log(`[Baileys] Max retries reached, stopping reconnection`);
          this.connectionStatus = "error";
          await this.updateSettingsInDb();
        }
      }
    } else if (connection === "open") {
      this.connectionStatus = "connected";
      this.qrCode = null;
      this.retryCount = 0;
      const phoneNumber = this.sock.user?.id?.replace(/:.*/, "");
      await this.updateSettingsInDb({ connectedPhone: phoneNumber });
    }

    await this.updateSettingsInDb();
  }

  async handleMessagesUpsert({ messages, type }) {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (isJidBroadcast(msg.key.remoteJid)) continue;

      await this.processInboundMessage(msg);
    }
  }

  async handleMessageReaction({ reaction, key }) {
    console.log("Message reaction received:", reaction);
  }

  async processInboundMessage(msg) {
    try {
      const fromJid = msg.key.remoteJid;
      const phone = fromJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
      const messageBody = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";

      if (!messageBody) return;

      // Find or create customer
      let customer = await Custumers.findOne({
        where: { phone },
        attributes: ["id", "name"],
      });

      if (!customer) {
        customer = await Custumers.create({
          id: uuidv4(),
          usersId: this.userId,
          phone,
          name: phone,
          // Add other required fields based on your model
        });
      }

      // Find or create conversation
      let conversation = await CrmConversation.findOne({
        where: {
          usersId: this.userId,
          customerId: customer.id,
          channel: "baileys",
        },
      });

      if (!conversation) {
        conversation = await CrmConversation.create({
          id: uuidv4(),
          usersId: this.userId,
          customerId: customer.id,
          channel: "baileys",
          status: "active",
          source: "crm",
          customerName: customer.name,
          phone: phone,
          lastMessagePreview: messageBody.substring(0, 100),
          lastMessageAt: new Date(),
          lastInboundAt: new Date(),
        });
      } else {
        // Update conversation with latest message info
        conversation.lastMessagePreview = messageBody.substring(0, 100);
        conversation.lastMessageAt = new Date();
        conversation.lastInboundAt = new Date();
        conversation.unreadCount += 1;
        await conversation.save();
      }

      // Create message record
      await CrmConversationMessage.create({
        id: uuidv4(),
        conversationId: conversation.id,
        usersId: this.userId,
        customerId: customer.id,
        direction: "inbound",
        channel: "baileys",
        messageType: "text",
        body: messageBody,
        providerMessageId: msg.key.id,
        status: "received",
        receivedAt: new Date(),
        payload: msg,
      });

      console.log(`Inbound message processed from ${phone}: ${messageBody}`);
    } catch (error) {
      console.error("Error processing inbound message:", error);
    }
  }

  async sendMessage(phone, text, options = {}) {
    if (this.connectionStatus !== "connected") {
      throw new Error(`Cannot send message: Baileys not connected (status: ${this.connectionStatus})`);
    }

    try {
      // Check rate limit
      this.enforceRateLimit();

      // Add random delay
      const delay = this.getRandomDelay(2000, 5000);
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phone);

      // Send message
      const result = await this.sock.sendMessage(formattedPhone, {
        text,
        ...options,
      });

      // Record message timestamp
      this.messageTimestamps.push(Date.now());

      // Update health metrics
      await this.updateHealthMetrics();

      return result;
    } catch (error) {
      await this.detectBanPattern(error);
      throw error;
    }
  }

  async sendImage(phone, imageBuffer, caption = "") {
    if (this.connectionStatus !== "connected") {
      throw new Error("Baileys not connected");
    }

    try {
      this.enforceRateLimit();
      const delay = this.getRandomDelay(2000, 5000);
      await new Promise((resolve) => setTimeout(resolve, delay));

      const formattedPhone = this.formatPhoneNumber(phone);
      const result = await this.sock.sendMessage(formattedPhone, {
        image: imageBuffer,
        caption: caption || undefined,
      });

      this.messageTimestamps.push(Date.now());
      await this.updateHealthMetrics();

      return result;
    } catch (error) {
      await this.detectBanPattern(error);
      throw error;
    }
  }

  formatPhoneNumber(phone) {
    let formatted = phone.replace(/\D/g, "");
    if (!formatted.startsWith("55")) {
      formatted = "55" + formatted;
    }
    return `${formatted}@s.whatsapp.net`;
  }

  enforceRateLimit() {
    // Clean up old timestamps (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.messageTimestamps = this.messageTimestamps.filter(
      (ts) => ts > oneHourAgo,
    );

    // Check if we've exceeded 60 messages per hour
    if (this.messageTimestamps.length >= 60) {
      throw new Error(
        "Rate limit exceeded: 60 messages per hour. Please wait before sending more messages.",
      );
    }
  }

  getRandomDelay(min, max) {
    return Math.random() * (max - min) + min;
  }

  async detectBanPattern(error) {
    const banSignals = [];

    if (error.response?.status === 429) {
      banSignals.push("RATE_LIMITED");
    }

    if (error.message?.includes("You are blocked")) {
      banSignals.push("BLOCKED");
    }

    if (error.response?.status === 403) {
      banSignals.push("FORBIDDEN");
    }

    if (error.message?.includes("ERR_UNKNOWN")) {
      banSignals.push("UNKNOWN_ERROR");
    }

    if (error.code === "ECONNREFUSED") {
      banSignals.push("CONNECTION_REFUSED");
    }

    if (banSignals.length > 0) {
      this.errorPatterns.push({
        timestamp: Date.now(),
        signals: banSignals,
      });

      // Clean up old error patterns
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      this.errorPatterns = this.errorPatterns.filter((p) => p.timestamp > oneHourAgo);

      // If more than 5 signals in 1 hour, mark as high risk
      const recentSignals = this.errorPatterns.reduce(
        (acc, p) => acc + p.signals.length,
        0,
      );

      if (recentSignals > 5) {
        this.connectionStatus = "banned";
        console.warn("⚠️ High ban risk detected, marking connection as banned");
      }
    }

    return banSignals;
  }

  async updateHealthMetrics() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const messagesLastHour = this.messageTimestamps.filter(
      (ts) => ts > oneHourAgo,
    ).length;

    const recentErrors = this.errorPatterns.filter(
      (p) => p.timestamp > oneHourAgo,
    );
    const errorCount = recentErrors.reduce((acc, p) => acc + p.signals.length, 0);

    const riskScore = Math.min(errorCount / 10, 1); // 0-1 scale

    await this.updateSettingsInDb({
      health: {
        messagesLastHour,
        lastMessageAt: new Date().toISOString(),
        totalMessagesThisMonth: this.messageTimestamps.length,
        riskScore,
        lastError: this.errorPatterns[this.errorPatterns.length - 1]?.signals[0] || null,
        errorCount,
      },
    });
  }

  async updateSettingsInDb(additionalData = {}) {
    try {
      const settings = await Settings.findOne({
        where: { usersId: this.userId },
      });

      if (settings) {
        const baileysConfig = settings.whatsappConnection?.baileys || {};

        settings.whatsappConnection = {
          ...settings.whatsappConnection,
          baileys: {
            ...baileysConfig,
            connectionStatus: this.connectionStatus,
            qrCode: this.qrCode,
            lastQrGeneratedAt: this.qrCode ? new Date().toISOString() : baileysConfig.lastQrGeneratedAt,
            ...additionalData,
          },
        };

        await settings.save();
      }
    } catch (error) {
      console.error("Error updating settings:", error);
    }
  }

  async updateSettings(settings) {
    const baileysConfig = settings.whatsappConnection?.baileys || {};
    settings.whatsappConnection = {
      ...settings.whatsappConnection,
      baileys: {
        ...baileysConfig,
        connectionStatus: this.connectionStatus,
        qrCode: this.qrCode,
        lastQrGeneratedAt: new Date().toISOString(),
        health: baileysConfig.health || {
          messagesLastHour: 0,
          totalMessagesThisMonth: 0,
          riskScore: 0,
          errorCount: 0,
        },
      },
    };
    await settings.save();
  }

  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout();
        this.sock = null;
      }
      this.connectionStatus = "disconnected";
      this.qrCode = null;
      await this.updateSettingsInDb();
      return { success: true };
    } catch (error) {
      console.error("Error disconnecting:", error);
      throw error;
    }
  }

  async isConnected() {
    return this.connectionStatus === "connected";
  }

  async getStatus() {
    return {
      status: this.connectionStatus,
      qrCode: this.qrCode,
      connectedPhone: this.sock?.user?.id?.replace(":s.whatsapp.net", ""),
      health: {
        messagesLastHour: (this.messageTimestamps || []).filter(
          (ts) => ts > Date.now() - 60 * 60 * 1000,
        ).length,
        riskScore: this.errorPatterns.reduce((acc, p) => acc + p.signals.length, 0) / 10,
        totalMessages: this.messageTimestamps.length,
      },
    };
  }

  static instances = new Map();

  static getInstance(userId, establishment) {
    const key = `${userId}:${establishment}`;
    if (!this.instances.has(key)) {
      this.instances.set(key, new BaileysService(userId, establishment));
    }
    return this.instances.get(key);
  }
}

export default BaileysService;
