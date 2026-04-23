import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  isJidBroadcast,
  initAuthCreds,
  BufferJSON,
  Browsers,
} from "baileys";
import qrcode from "qrcode";
import Settings from "../models/Settings.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import Custumers from "../models/Custumers.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Database-backed auth state for Baileys.
 * Stores credentials and signal keys inside settings.whatsappConnection.baileys.authState
 * so they survive Render restarts and re-deploys.
 */
async function useDatabaseAuthState(userId) {
  let settings = await Settings.findOne({ where: { usersId: userId } });
  if (!settings) {
    settings = await Settings.create({
      usersId: userId,
      whatsappConnection: {},
    });
  }

  const saved = settings.whatsappConnection?.baileys?.authState || {};

  // Restore or initialize credentials
  let creds;
  try {
    creds = saved.creds
      ? JSON.parse(JSON.stringify(saved.creds), BufferJSON.reviver)
      : initAuthCreds();
  } catch (_) {
    creds = initAuthCreds();
  }

  // Restore or initialize signal keys
  let keys = {};
  try {
    if (saved.keys) {
      for (const [type, typeKeys] of Object.entries(saved.keys)) {
        keys[type] = {};
        for (const [id, value] of Object.entries(typeKeys)) {
          keys[type][id] = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
        }
      }
    }
  } catch (_) {
    keys = {};
  }

  const persistState = async () => {
    try {
      const fresh = await Settings.findOne({ where: { usersId: userId } });
      if (!fresh) return;
      fresh.whatsappConnection = {
        ...fresh.whatsappConnection,
        baileys: {
          ...fresh.whatsappConnection?.baileys,
          authState: {
            creds: JSON.parse(JSON.stringify(creds), BufferJSON.replacer),
            keys: JSON.parse(JSON.stringify(keys), BufferJSON.replacer),
          },
        },
      };
      await fresh.save();
    } catch (err) {
      console.error("[Baileys] Error persisting auth state:", err.message);
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          for (const id of ids) {
            const val = keys[type]?.[id];
            result[id] = val !== undefined ? val : null;
          }
          return result;
        },
        set: async (data) => {
          for (const [type, typeData] of Object.entries(data)) {
            if (!keys[type]) keys[type] = {};
            for (const [id, value] of Object.entries(typeData)) {
              if (value != null) {
                keys[type][id] = value;
              } else {
                delete keys[type][id];
              }
            }
          }
          await persistState();
        },
      },
    },
    saveCreds: persistState,
  };
}

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
    this.maxRetries = 4;
    this.lastError = null;
    this.connectionAttempts = 0;
    this._connectTimeout = null;
    this.browserPreset = String(process.env.BAILEYS_BROWSER || "windows").toLowerCase();
  }

  resolveBrowserProfile() {
    if (this.browserPreset === "macos" || this.browserPreset === "mac") {
      return Browsers.macOS("Desktop");
    }
    if (this.browserPreset === "ubuntu" || this.browserPreset === "linux") {
      return Browsers.ubuntu("Chrome");
    }
    if (this.browserPreset === "baileys") {
      return Browsers.baileys("Chrome");
    }
    if (this.browserPreset === "appropriate") {
      return Browsers.appropriate("Desktop");
    }
    return Browsers.windows("Desktop");
  }

  async initialize() {
    // Prevent concurrent initializations
    if (this.isInitializing) {
      console.log(`[Baileys] Already initializing for user ${this.userId}, skipping`);
      return { success: true };
    }
    // If already connected or actively scanning, skip
    if (this.connectionStatus === "connected" || this.connectionStatus === "scanning") {
      console.log(`[Baileys] Already ${this.connectionStatus} for user ${this.userId}, skipping`);
      return { success: true };
    }
    // Stop if max retries exceeded (requires manual reset)
    if (this.retryCount >= this.maxRetries) {
      console.log(`[Baileys] Max retries (${this.maxRetries}) reached for user ${this.userId}`);
      this.connectionStatus = "error";
      await this.updateSettingsInDb();
      return { success: false, error: "max_retries" };
    }

    this.isInitializing = true;
    try {
      // Close existing socket cleanly
      if (this.sock) {
        try { this.sock.end(); } catch (_) {}
        this.sock = null;
      }

      const previousError = String(this.lastError?.message || "").toLowerCase();
      if (
        this.lastError?.code === 405 ||
        previousError.includes("connection failure") ||
        previousError.includes("stream errored out")
      ) {
        await this.clearAuthStateInDb();
      }

      // Load auth state from database (survives restarts)
      const { state, saveCreds } = await useDatabaseAuthState(this.userId);
      this.authState = state;
      this.saveCreds = saveCreds;

      this.connectionAttempts += 1;
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: this.resolveBrowserProfile(),
        connectTimeoutMs: 20000,
        keepAliveIntervalMs: 10000,
        defaultQueryTimeoutMs: 0,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
      });

      this.sock.ev.on("connection.update", this.handleConnectionUpdate.bind(this));
      this.sock.ev.on("messages.upsert", this.handleMessagesUpsert.bind(this));
      this.sock.ev.on("message.reaction", this.handleMessageReaction.bind(this));
      this.sock.ev.on("creds.update", saveCreds);

      this.connectionStatus = "connecting";
      console.log(`[Baileys] Initializing socket for user ${this.userId} (attempt ${this.connectionAttempts})`);

      // Hard timeout: if no QR or connection in 25s, mark error with clear reason
      if (this._connectTimeout) clearTimeout(this._connectTimeout);
      this._connectTimeout = setTimeout(async () => {
        if (this.connectionStatus === "connecting") {
          const msg = "WhatsApp não respondeu em 25s. O servidor pode estar bloqueado pelo WhatsApp (IP do Render).";
          console.warn(`[Baileys] Connect timeout for user ${this.userId}: ${msg}`);
          this.lastError = { code: "CONNECT_TIMEOUT", message: msg, at: new Date().toISOString() };
          this.connectionStatus = "error";
          this.isInitializing = false;
          try { this.sock?.end(); } catch (_) {}
          await this.updateSettingsInDb();
        }
      }, 25000);
      return { success: true };
    } catch (error) {
      console.error("[Baileys] Error initializing:", error);
      this.connectionStatus = "error";
      return { success: false, error: error.message };
    } finally {
      this.isInitializing = false;
    }
  }

  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (this._connectTimeout) { clearTimeout(this._connectTimeout); this._connectTimeout = null; }
      this.qrCode = await qrcode.toDataURL(qr);
      this.connectionStatus = "scanning";
      this.retryCount = 0;
      console.log(`[Baileys] QR code generated for user ${this.userId}`);
      await this.updateSettingsInDb();
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const errorMsg = lastDisconnect?.error?.message || lastDisconnect?.error?.toString() || "Connection closed";
      const normalizedError = String(errorMsg || "").toLowerCase();
      const shouldClearSessionAndRetry =
        statusCode === 405 ||
        normalizedError.includes("connection failure") ||
        normalizedError.includes("stream errored out") ||
        normalizedError.includes("bad session");

      this.lastError = { code: statusCode, message: errorMsg, at: new Date().toISOString() };
      console.log(`[Baileys] Connection closed for user ${this.userId}, code=${statusCode}, error=${errorMsg}`);

      if (isLoggedOut) {
        // User logged out — clear auth state from DB too
        this.connectionStatus = "disconnected";
        this.qrCode = null;
        this.retryCount = 0;
        await this.clearAuthStateInDb();
        await this.updateSettingsInDb();
      } else if (shouldClearSessionAndRetry) {
        this.retryCount += 1;
        if (this.retryCount <= this.maxRetries) {
          const delay = Math.min(this.retryCount * 2500, 10000);
          console.log(
            `[Baileys] Recovering session for user ${this.userId} (${this.retryCount}/${this.maxRetries}) in ${delay}ms`,
          );
          this.connectionStatus = "connecting";
          this.qrCode = null;
          this.isInitializing = false;
          await this.clearAuthStateInDb();
          await this.updateSettingsInDb();
          setTimeout(() => this.initialize(), delay);
        } else {
          console.log(`[Baileys] Recovery max retries reached for user ${this.userId}`);
          this.connectionStatus = "error";
          await this.updateSettingsInDb();
        }
      } else if (statusCode === DisconnectReason.restartRequired) {
        // WA asked for restart, do it immediately
        console.log(`[Baileys] Restart required for user ${this.userId}`);
        this.connectionStatus = "connecting";
        this.isInitializing = false;
        setTimeout(() => this.initialize(), 1000);
      } else {
        this.retryCount += 1;
        if (this.retryCount < this.maxRetries) {
          const delay = this.retryCount * 5000;
          console.log(`[Baileys] Retry ${this.retryCount}/${this.maxRetries} in ${delay}ms for user ${this.userId}`);
          this.connectionStatus = "connecting";
          this.isInitializing = false;
          setTimeout(() => this.initialize(), delay);
        } else {
          console.log(`[Baileys] Max retries reached for user ${this.userId}`);
          this.connectionStatus = "error";
          await this.updateSettingsInDb();
        }
      }
    } else if (connection === "open") {
      if (this._connectTimeout) { clearTimeout(this._connectTimeout); this._connectTimeout = null; }
      this.connectionStatus = "connected";
      this.qrCode = null;
      this.retryCount = 0;
      const phoneNumber = this.sock.user?.id?.replace(/:.*@.*/, "");
      console.log(`[Baileys] Connected! User ${this.userId}, phone: ${phoneNumber}`);
      await this.updateSettingsInDb({ connectedPhone: phoneNumber });
    }

    // Always sync status to DB
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
    console.log("[Baileys] Message reaction received:", reaction);
  }

  async processInboundMessage(msg) {
    try {
      const fromJid = msg.key.remoteJid;
      const phone = fromJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
      const messageBody =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      if (!messageBody) return;

      // Find or create customer
      let customer = await Custumers.findOne({
        where: { phone, usersId: this.userId },
        attributes: ["id", "name"],
      });

      if (!customer) {
        customer = await Custumers.create({
          id: uuidv4(),
          usersId: this.userId,
          phone,
          name: phone,
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
        conversation.lastMessagePreview = messageBody.substring(0, 100);
        conversation.lastMessageAt = new Date();
        conversation.lastInboundAt = new Date();
        conversation.unreadCount = (conversation.unreadCount || 0) + 1;
        await conversation.save();
      }

      // Save message
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

      console.log(`[Baileys] Inbound from ${phone}: ${messageBody.substring(0, 50)}`);
    } catch (error) {
      console.error("[Baileys] Error processing inbound message:", error);
    }
  }

  async sendMessage(phone, text, options = {}) {
    if (this.connectionStatus !== "connected") {
      throw new Error(
        `Não conectado ao WhatsApp (status: ${this.connectionStatus})`
      );
    }

    try {
      this.enforceRateLimit();

      const delay = this.getRandomDelay(1500, 4000);
      await new Promise((resolve) => setTimeout(resolve, delay));

      const formattedPhone = this.formatPhoneNumber(phone);
      const result = await this.sock.sendMessage(formattedPhone, {
        text,
        ...options,
      });

      this.messageTimestamps.push(Date.now());
      await this.updateHealthMetrics();

      return result;
    } catch (error) {
      await this.detectBanPattern(error);
      throw error;
    }
  }

  async sendImage(phone, imageBuffer, caption = "") {
    if (this.connectionStatus !== "connected") {
      throw new Error("Baileys não conectado");
    }

    try {
      this.enforceRateLimit();
      const delay = this.getRandomDelay(1500, 4000);
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
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.messageTimestamps = this.messageTimestamps.filter(
      (ts) => ts > oneHourAgo
    );
    // Limit is configurable via settings (baileys.hourlyLimit), default 200/hour
    const limit = this._hourlyLimit || 200;
    if (this.messageTimestamps.length >= limit) {
      throw new Error(
        `Limite de ${limit} mensagens por hora atingido. Aguarde antes de enviar mais.`
      );
    }
  }

  /**
   * Set the hourly send limit for this instance.
   * Called after loading from settings.
   */
  setHourlyLimit(limit) {
    this._hourlyLimit = Number(limit) || 200;
  }

  getRandomDelay(min, max) {
    return Math.random() * (max - min) + min;
  }

  async detectBanPattern(error) {
    const banSignals = [];
    if (error.response?.status === 429) banSignals.push("RATE_LIMITED");
    if (error.message?.includes("You are blocked")) banSignals.push("BLOCKED");
    if (error.response?.status === 403) banSignals.push("FORBIDDEN");
    if (error.message?.includes("ERR_UNKNOWN")) banSignals.push("UNKNOWN_ERROR");
    if (error.code === "ECONNREFUSED") banSignals.push("CONNECTION_REFUSED");

    if (banSignals.length > 0) {
      this.errorPatterns.push({ timestamp: Date.now(), signals: banSignals });
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      this.errorPatterns = this.errorPatterns.filter(
        (p) => p.timestamp > oneHourAgo
      );
      const recentSignals = this.errorPatterns.reduce(
        (acc, p) => acc + p.signals.length,
        0
      );
      if (recentSignals > 5) {
        this.connectionStatus = "banned";
        console.warn("[Baileys] ⚠️ High ban risk detected");
      }
    }
    return banSignals;
  }

  async updateHealthMetrics() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const messagesLastHour = this.messageTimestamps.filter(
      (ts) => ts > oneHourAgo
    ).length;
    const recentErrors = this.errorPatterns.filter(
      (p) => p.timestamp > oneHourAgo
    );
    const errorCount = recentErrors.reduce(
      (acc, p) => acc + p.signals.length,
      0
    );
    const riskScore = Math.min(errorCount / 10, 1);

    await this.updateSettingsInDb({
      health: {
        messagesLastHour,
        lastMessageAt: new Date().toISOString(),
        totalMessagesThisMonth: this.messageTimestamps.length,
        riskScore,
        lastError:
          this.errorPatterns[this.errorPatterns.length - 1]?.signals[0] || null,
        errorCount,
      },
    });
  }

  async clearAuthStateInDb() {
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
            authState: null,
          },
        };
        await settings.save();
      }
    } catch (error) {
      console.error("[Baileys] Error clearing auth state:", error);
    }
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
            lastQrGeneratedAt: this.qrCode
              ? new Date().toISOString()
              : baileysConfig.lastQrGeneratedAt,
            lastError: this.lastError || baileysConfig.lastError || null,
            connectionAttempts: this.connectionAttempts,
            ...additionalData,
          },
        };
        await settings.save();
      }
    } catch (error) {
      console.error("[Baileys] Error updating settings:", error);
    }
  }

  async disconnect() {
    try {
      if (this.sock) {
        try { await this.sock.logout(); } catch (_) {}
        try { this.sock.end(); } catch (_) {}
        this.sock = null;
      }
      this.connectionStatus = "disconnected";
      this.qrCode = null;
      this.retryCount = 0;
      this.isInitializing = false;
      await this.clearAuthStateInDb();
      await this.updateSettingsInDb();
      return { success: true };
    } catch (error) {
      console.error("[Baileys] Error disconnecting:", error);
      throw error;
    }
  }

  /**
   * Force-reset: clears all state and auth, lets the user scan a fresh QR.
   */
  async reset() {
    try {
      if (this.sock) {
        try { this.sock.end(); } catch (_) {}
        this.sock = null;
      }
      this.connectionStatus = "disconnected";
      this.qrCode = null;
      this.retryCount = 0;
      this.isInitializing = false;
      this.messageTimestamps = [];
      this.errorPatterns = [];
      await this.clearAuthStateInDb();
      await this.updateSettingsInDb();
      return { success: true };
    } catch (error) {
      console.error("[Baileys] Error resetting:", error);
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
      connectedPhone: this.sock?.user?.id?.replace(/:.*@.*/, ""),
      lastError: this.lastError,
      connectionAttempts: this.connectionAttempts,
      health: {
        messagesLastHour: (this.messageTimestamps || []).filter(
          (ts) => ts > Date.now() - 60 * 60 * 1000
        ).length,
        riskScore:
          this.errorPatterns.reduce((acc, p) => acc + p.signals.length, 0) / 10,
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

  static resetInstance(userId, establishment) {
    const key = `${userId}:${establishment}`;
    this.instances.delete(key);
    return new BaileysService(userId, establishment);
  }
}

export default BaileysService;
