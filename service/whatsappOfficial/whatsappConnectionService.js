import { Op } from "sequelize";
import Settings from "../../models/Settings.js";
import WhatsappConnection from "../../models/WhatsappConnection.js";
import { decryptToken, encryptToken, maskToken } from "./tokenCryptoService.js";

export function getCompanyIdFromRequest(req = {}) {
  return req?.user?.establishment || req?.user?.id || null;
}

function defaultVerifyToken() {
  return String(process.env.WHATSAPP_VERIFY_TOKEN || "genius").trim();
}

function getGlobalFallback() {
  return {
    token:
      process.env.WHATSAPP_ACCESS_TOKEN ||
      process.env.WHATSAPP_TOKEN ||
      "",
    businessId: process.env.META_BUSINESS_ID || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    verifyToken: defaultVerifyToken(),
  };
}

export async function getOrCreateConnection(companyId) {
  if (!companyId) throw new Error("company_id ausente");

  let connection = await WhatsappConnection.findOne({
    where: { companyId },
  });

  if (!connection) {
    const settings = await Settings.findOne({ where: { usersId: companyId } });
    const legacy = settings?.whatsappConnection || {};
    const fallback = getGlobalFallback();
    const token = String(legacy.accessToken || fallback.token || "");
    connection = await WhatsappConnection.create({
      companyId,
      usersId: companyId,
      integrationMode: String(legacy.integrationMode || "simple").trim() || "simple",
      businessId: legacy.businessId || fallback.businessId || "",
      phoneNumberId: legacy.phoneNumberId || fallback.phoneNumberId || "",
      wabaId: legacy.businessAccountId || fallback.wabaId || "",
      businessName: legacy.businessName || "",
      verifyToken: legacy.verifyToken || fallback.verifyToken,
      businessPhone:
        legacy.businessPhone ||
        legacy.accountSettings?.crmAccessWhatsapp ||
        legacy.accountSettings?.supportWhatsapp ||
        "",
      webhookVerified: Boolean(legacy.webhookVerified),
      status: legacy.phoneNumberId ? "connected" : "ready",
      connectedAt: legacy.oauthConnectedAt || null,
      accessTokenEncrypted: token ? encryptToken(token) : "",
      accessTokenLast4: maskToken(token),
      metadata: {},
    });
  }

  return connection;
}

export async function getConnectionByCompany(companyId) {
  const connection = await getOrCreateConnection(companyId);
  return {
    connection,
    accessToken:
      decryptToken(connection.accessTokenEncrypted) ||
      process.env.WHATSAPP_ACCESS_TOKEN ||
      process.env.WHATSAPP_TOKEN ||
      "",
  };
}

export async function getConnectionByPhoneNumberId(phoneNumberId = "") {
  const normalized = String(phoneNumberId || "").trim();
  if (!normalized) return null;

  let connection = await WhatsappConnection.findOne({
    where: { phoneNumberId: normalized },
  });

  if (connection) {
    return {
      connection,
      accessToken:
        decryptToken(connection.accessTokenEncrypted) ||
        process.env.WHATSAPP_ACCESS_TOKEN ||
        process.env.WHATSAPP_TOKEN ||
        "",
    };
  }

  const settingsRows = await Settings.findAll({
    where: {
      whatsappConnection: {
        [Op.ne]: null,
      },
    },
  });

  for (const settings of settingsRows) {
    const cfg = settings?.whatsappConnection || {};
    if (String(cfg.phoneNumberId || "").trim() !== normalized) continue;

    connection = await getOrCreateConnection(settings.usersId);
    if (!connection.phoneNumberId) {
      await upsertConnectionForCompany(settings.usersId, {
        phoneNumberId: normalized,
        wabaId: cfg.businessAccountId || "",
        verifyToken: cfg.verifyToken || defaultVerifyToken(),
        accessToken: cfg.accessToken || "",
        status: "connected",
      });
      const refreshed = await getConnectionByCompany(settings.usersId);
      return refreshed;
    }

    return getConnectionByCompany(settings.usersId);
  }

  return null;
}

export async function upsertConnectionForCompany(companyId, payload = {}) {
  const current = await getOrCreateConnection(companyId);
  const nextToken = String(payload.accessToken || "");
  const verifyToken = String(payload.verifyToken || current.verifyToken || defaultVerifyToken()).trim();
  await current.update({
    usersId: companyId,
    integrationMode:
      payload.integrationMode !== undefined
        ? String(payload.integrationMode || "simple").trim() || "simple"
        : current.integrationMode,
    businessId:
      payload.businessId !== undefined
        ? String(payload.businessId || "").trim()
        : current.businessId,
    wabaId:
      payload.wabaId !== undefined ? String(payload.wabaId || "").trim() : current.wabaId,
    businessName:
      payload.businessName !== undefined
        ? String(payload.businessName || "").trim()
        : current.businessName,
    phoneNumberId:
      payload.phoneNumberId !== undefined
        ? String(payload.phoneNumberId || "").trim()
        : current.phoneNumberId,
    businessPhone:
      payload.businessPhone !== undefined
        ? String(payload.businessPhone || "").trim()
        : current.businessPhone,
    verifyToken,
    accessTokenEncrypted:
      payload.accessToken !== undefined
        ? (nextToken ? encryptToken(nextToken) : "")
        : current.accessTokenEncrypted,
    accessTokenLast4:
      payload.accessToken !== undefined
        ? maskToken(nextToken)
        : current.accessTokenLast4,
    webhookVerified:
      payload.webhookVerified !== undefined
        ? Boolean(payload.webhookVerified)
        : current.webhookVerified,
    status:
      payload.status !== undefined
        ? String(payload.status || "ready")
        : current.status,
    connectedAt:
      payload.connectedAt !== undefined ? payload.connectedAt : current.connectedAt,
    lastEventAt:
      payload.lastEventAt !== undefined ? payload.lastEventAt : current.lastEventAt,
    lastError:
      payload.lastError !== undefined ? payload.lastError : current.lastError,
    metadata:
      payload.metadata !== undefined
        ? payload.metadata || {}
        : current.metadata || {},
  });

  const settings = await Settings.findOne({ where: { usersId: companyId } });
  if (settings) {
    settings.whatsappConnection = {
      ...(settings.whatsappConnection || {}),
      provider: "WhatsApp Cloud API",
      integrationMode: current.integrationMode || payload.integrationMode || "simple",
      businessId: current.businessId || payload.businessId || "",
      businessName: current.businessName || payload.businessName || "",
      phoneNumberId: current.phoneNumberId,
      businessAccountId: current.wabaId,
      verifyToken,
      accessTokenConfigured: Boolean(
        payload.accessToken !== undefined
          ? nextToken
          : decryptToken(current.accessTokenEncrypted),
      ),
      ...(payload.accessToken !== undefined && nextToken
        ? { accessToken: nextToken }
        : {}),
      webhookVerified: Boolean(current.webhookVerified),
      status: current.status,
      oauthConnectedAt: current.connectedAt || payload.connectedAt || null,
      lastWebhookAt: payload.lastEventAt || current.lastEventAt || null,
      tokenInvalid: false,
      tokenErrorMessage: "",
    };
    await settings.save();
  }

  return getConnectionByCompany(companyId);
}

export async function disconnectConnection(companyId) {
  return upsertConnectionForCompany(companyId, {
    phoneNumberId: "",
    wabaId: "",
    businessPhone: "",
    accessToken: "",
    status: "disconnected",
    webhookVerified: false,
    connectedAt: null,
    lastError: null,
    metadata: {},
  });
}

export function resolveVerifyToken(connection = null) {
  return String(
    connection?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || "genius",
  ).trim();
}
