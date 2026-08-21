import crypto from "node:crypto";
import { Op } from "sequelize";
import RegistrationSecurityEvent from "../models/RegistrationSecurityEvent.js";
import RegistrationVerification from "../models/RegistrationVerification.js";
import RegistrationIpBlock from "../models/RegistrationIpBlock.js";
import emailService from "./email.js";

export const REGISTRATION_STATUS = Object.freeze({
  EMAIL_PENDING: "aguardando_confirmacao_email", EMAIL_CONFIRMED: "email_confirmado",
  PHONE_PENDING: "aguardando_confirmacao_telefone", ACTIVE: "cadastro_ativo",
  BLOCKED: "cadastro_bloqueado", SUSPICIOUS: "cadastro_suspeito",
});

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com", "guerrillamail.com", "mailinator.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "throwawaymail.com", "getnada.com", "sharklasers.com", "dispostable.com",
]);
const CODE_TTL_MS = 10 * 60 * 1000;

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function isDisposableEmail(email) {
  const domain = String(email || "").toLowerCase().split("@")[1] || "";
  const configured = String(process.env.DISPOSABLE_EMAIL_DOMAINS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return DISPOSABLE_DOMAINS.has(domain) || configured.includes(domain);
}

export function resolveRegistrationContext(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || "unknown";
  const ua = String(req.headers["user-agent"] || "Unknown").slice(0, 500);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Outro";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Outro";
  const device = /Mobile|Android|iPhone/.test(ua) ? "Celular" : /iPad|Tablet/.test(ua) ? "Tablet" : "Computador";
  return { ip, browser, os, device, country: String(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || ""), city: decodeURIComponent(String(req.headers["x-vercel-ip-city"] || "")) };
}

export async function auditRegistration(req, eventType, data = {}) {
  const context = resolveRegistrationContext(req);
  return RegistrationSecurityEvent.create({ ...context, eventType, deviceFingerprint: String(req.headers["x-device-fingerprint"] || data.deviceFingerprint || "").slice(0, 128), ...data });
}

export async function verifyCaptcha(token, ip) {
  if (process.env.NODE_ENV !== "production" && !process.env.TURNSTILE_SECRET_KEY) return true;
  if (!token || !process.env.TURNSTILE_SECRET_KEY) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json();
  return result.success === true;
}

export async function enforceRegistrationLimits(req) {
  const { ip } = resolveRegistrationContext(req);
  const fingerprint = String(req.headers["x-device-fingerprint"] || "").slice(0, 128);
  if (await RegistrationIpBlock.findOne({ where: { ip } })) return { allowed: false, reason: "Este endereço de rede está bloqueado." };
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const ipCount = await RegistrationSecurityEvent.count({ where: { ip, eventType: "registration_created", createdAt: { [Op.gte]: since } } });
  const fingerprintCount = fingerprint ? await RegistrationSecurityEvent.count({ where: { deviceFingerprint: fingerprint, eventType: "registration_created", createdAt: { [Op.gte]: since } } }) : 0;
  if (ipCount >= Number(process.env.REGISTRATION_LIMIT_PER_IP || 3) || fingerprintCount >= Number(process.env.REGISTRATION_LIMIT_PER_DEVICE || 2)) return { allowed: false, reason: "Limite de cadastros atingido. Tente novamente mais tarde." };
  return { allowed: true };
}

function hashCode(userId, channel, code) {
  const secret = process.env.VERIFICATION_CODE_SECRET || process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("VERIFICATION_CODE_SECRET não configurado");
  return crypto.createHmac("sha256", secret || "local-only-secret").update(`${userId}:${channel}:${code}`).digest("hex");
}

export async function issueVerification(user, channel) {
  const latest = await RegistrationVerification.findOne({ where: { userId: user.id, channel }, order: [["createdAt", "DESC"]] });
  if (latest && Date.now() - new Date(latest.sentAt).getTime() < 60000) {
    const retryAfter = Math.ceil((60000 - (Date.now() - new Date(latest.sentAt).getTime())) / 1000);
    const error = new Error(`Aguarde ${retryAfter} segundos para reenviar.`); error.status = 429; error.retryAfter = retryAfter; throw error;
  }
  await RegistrationVerification.update({ consumedAt: new Date() }, { where: { userId: user.id, channel, consumedAt: null } });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await RegistrationVerification.create({ userId: user.id, channel, codeHash: hashCode(user.id, channel, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  if (channel === "email") await sendEmailCode(user, code); else await sendPhoneCode(user, code);
  return process.env.NODE_ENV !== "production" && process.env.EXPOSE_DEV_VERIFICATION_CODE === "true" ? code : undefined;
}

export async function consumeVerification(user, channel, code) {
  const record = await RegistrationVerification.findOne({ where: { userId: user.id, channel, consumedAt: null }, order: [["createdAt", "DESC"]] });
  if (!record || new Date(record.expiresAt) < new Date()) return { ok: false, reason: "Código expirado. Solicite um novo envio." };
  if (record.attempts >= 5) return { ok: false, blocked: true, reason: "Limite de 5 tentativas atingido." };
  const expected = Buffer.from(record.codeHash, "hex"); const actual = Buffer.from(hashCode(user.id, channel, String(code || "")), "hex");
  const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!valid) { await record.increment("attempts"); return { ok: false, blocked: record.attempts + 1 >= 5, reason: "Código inválido." }; }
  await record.update({ consumedAt: new Date() }); return { ok: true };
}

async function sendEmailCode(user, code) {
  const settings = await emailService.ensurePasswordResetTransporter();
  await emailService.transporter.sendMail({ from: settings.smtpEmail, to: user.email, subject: `${code} é seu código de confirmação ViaPet`, html: `<div style="font-family:Arial;max-width:560px;margin:auto"><h2>Confirme seu e-mail</h2><p>Olá, ${user.name}. Use o código abaixo para continuar:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#e4572e">${code}</div><p>Ele expira em 10 minutos e pode ser usado uma única vez.</p><p>Se você não criou esta conta, ignore esta mensagem.</p></div>` });
}

async function sendPhoneCode(user, code) {
  const message = `ViaPet: seu código de confirmação é ${code}. Expira em 10 minutos. Não compartilhe.`;
  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    const response = await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: user.phone, type: "text", text: { body: message } }) });
    if (!response.ok) throw new Error("Falha ao enviar confirmação pelo WhatsApp"); return;
  }
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    const body = new URLSearchParams({ To: `+${user.phone}`, From: process.env.TWILIO_FROM_NUMBER, Body: message });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}` }, body });
    if (!response.ok) throw new Error("Falha ao enviar confirmação por SMS"); return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Provedor de WhatsApp/SMS não configurado");
}
