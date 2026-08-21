import express from "express";
import validator from "validator";
import bcrypt from "bcryptjs";
import { Op } from "sequelize";
import Users from "../../models/Users.js";
import Settings from "../../models/Settings.js";
import Subscription from "../../models/Subscription.js";
import { ensureDefaultMedicalCatalog } from "../../service/defaultMedicalCatalog.js";
import { getOrCreateBillingSettings } from "../../service/billingAccess.js";
import {
  REGISTRATION_STATUS, auditRegistration, consumeVerification, enforceRegistrationLimits,
  isDisposableEmail, issueVerification, normalizePhone, resolveRegistrationContext, verifyCaptcha,
} from "../../service/registrationSecurity.js";

const router = express.Router();

function publicRegistrationAllowed(req) {
  const flag = String(process.env.ENABLE_PUBLIC_REGISTER || "true").toLowerCase();
  if (["0", "false", "no", "off"].includes(flag)) return false;
  const secret = String(process.env.PUBLIC_REGISTER_SECRET || "").trim();
  return !secret || String(req.headers["x-register-secret"] || "").trim() === secret;
}

async function provisionActiveAccount(user, requestedPlan = "essential") {
  const existingSettings = await Settings.findOne({ where: { usersId: user.id } });
  if (!existingSettings) await Settings.create({ usersId: user.id, storeName: user.companyName || user.name, intervalClinic: 30, intervalAesthetics: 30, openingTime: "08:00", closingTime: "18:00", breakStartTime: "12:00", breakEndTime: "13:00", notifyClient: true, themeColor: "#e4572e", textColor: "#1F2937" });
  const existingSubscription = await Subscription.findOne({ where: { user_id: user.id } });
  if (!existingSubscription) {
    const billing = await getOrCreateBillingSettings(); const trialDays = Math.max(1, Number(billing?.trialDays || 30));
    const start = new Date(); const end = new Date(Date.now() + trialDays * 86400000);
    await Subscription.create({ user_id: user.id, plan_type: "trial", status: "active", amount: 0, currency: "BRL", trial_start: start, trial_end: end, billing_cycle_start: end, next_billing_date: end, notes: `Trial criado após identidade confirmada. Plano escolhido: ${requestedPlan}.` });
    user.expirationDate = end;
  }
  user.establishment = user.id; user.status = true; user.registrationStatus = REGISTRATION_STATUS.ACTIVE; await user.save();
  await ensureDefaultMedicalCatalog(user.id);
}

router.post("/register", async (req, res) => {
  const { name, companyName, email, password, phone, requestedPlan, acceptedTerms, acceptedPrivacy, captchaToken, deviceFingerprint } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase(); const normalizedPhone = normalizePhone(phone);
  let createdUser = null;
  try {
    if (!publicRegistrationAllowed(req)) return res.status(403).json({ message: "Novos cadastros públicos estão temporariamente indisponíveis." });
    const context = resolveRegistrationContext(req);
    if (!(await verifyCaptcha(captchaToken, context.ip))) return res.status(400).json({ message: "Não foi possível validar o CAPTCHA. Tente novamente." });
    const limit = await enforceRegistrationLimits(req); if (!limit.allowed) return res.status(429).json({ message: limit.reason });
    if (!name?.trim() || !companyName?.trim() || !normalizedEmail || !password || !normalizedPhone) return res.status(400).json({ message: "Preencha todos os campos obrigatórios." });
    if (!acceptedTerms || !acceptedPrivacy) return res.status(400).json({ message: "Aceite os Termos de Uso e a Política de Privacidade." });
    if (!validator.isEmail(normalizedEmail)) return res.status(400).json({ message: "Informe um e-mail válido." });
    if (isDisposableEmail(normalizedEmail)) return res.status(400).json({ message: "E-mails temporários ou descartáveis não são permitidos." });
    if (!/^55\d{10,11}$/.test(normalizedPhone)) return res.status(400).json({ message: "Informe um telefone brasileiro válido com DDD." });
    if (String(password).length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ message: "A senha deve ter ao menos 8 caracteres, com maiúscula, minúscula e número." });
    const duplicate = await Users.findOne({ where: { [Op.or]: [{ email: normalizedEmail }, { phone: normalizedPhone }] } });
    if (duplicate) return res.status(409).json({ message: "Já existe um cadastro com este e-mail ou telefone." });
    const selectedPlan = ["essential", "professional", "premium"].includes(String(requestedPlan).toLowerCase()) ? String(requestedPlan).toLowerCase() : "essential";
    const user = await Users.create({ name: name.trim(), companyName: companyName.trim(), email: normalizedEmail, phone: normalizedPhone, password: await bcrypt.hash(password, 12), status: false, registrationStatus: REGISTRATION_STATUS.EMAIL_PENDING, observation: JSON.stringify({ requestedPlan: selectedPlan }) });
    createdUser = user;
    await auditRegistration(req, "registration_created", { userId: user.id, email: normalizedEmail, phone: normalizedPhone, deviceFingerprint, metadata: { acceptedTermsAt: new Date().toISOString(), selectedPlan } });
    const devCode = await issueVerification(user, "email");
    return res.status(201).json({ message: "Cadastro recebido. Confirme o código enviado ao seu e-mail.", registrationId: user.id, status: user.registrationStatus, resendAfter: 60, ...(devCode ? { devCode } : {}) });
  } catch (error) {
    console.error("Erro no cadastro seguro:", error); await auditRegistration(req, "registration_failed", { email: normalizedEmail, phone: normalizedPhone, success: false, metadata: { reason: error.name || "error" } }).catch(() => {});
    if (createdUser) await createdUser.destroy().catch(() => {});
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Não foi possível concluir o cadastro agora." });
  }
});

router.post("/register/verify-email", async (req, res) => verifyChannel(req, res, "email"));
router.post("/register/verify-phone", async (req, res) => verifyChannel(req, res, "phone"));

async function verifyChannel(req, res, channel) {
  try {
    const user = await Users.findByPk(req.body?.registrationId); if (!user) return res.status(404).json({ message: "Cadastro não encontrado." });
    const validStatus = channel === "email" ? [REGISTRATION_STATUS.EMAIL_PENDING, REGISTRATION_STATUS.EMAIL_CONFIRMED] : [REGISTRATION_STATUS.PHONE_PENDING];
    if (!validStatus.includes(user.registrationStatus)) return res.status(409).json({ message: user.registrationStatus === REGISTRATION_STATUS.ACTIVE ? "Cadastro já confirmado." : "Etapa de confirmação inválida." });
    const result = await consumeVerification(user, channel, req.body?.code);
    await auditRegistration(req, `${channel}_verification_attempt`, { userId: user.id, email: user.email, phone: user.phone, success: result.ok, metadata: { blocked: Boolean(result.blocked) } });
    if (!result.ok) { if (result.blocked) { user.registrationStatus = REGISTRATION_STATUS.SUSPICIOUS; await user.save(); } return res.status(result.blocked ? 423 : 400).json({ message: result.reason, attemptsRemaining: result.blocked ? 0 : undefined }); }
    if (channel === "email") {
      user.emailConfirmedAt = new Date(); user.registrationStatus = REGISTRATION_STATUS.PHONE_PENDING; await user.save();
      const devCode = await issueVerification(user, "phone");
      return res.json({ message: "E-mail confirmado. Enviamos agora um código ao seu WhatsApp ou SMS.", status: user.registrationStatus, resendAfter: 60, ...(devCode ? { devCode } : {}) });
    }
    user.phoneConfirmedAt = new Date(); const plan = JSON.parse(user.observation || "{}").requestedPlan || "essential"; await provisionActiveAccount(user, plan);
    return res.json({ message: "Identidade confirmada. Seu cadastro está ativo e você já pode entrar.", status: user.registrationStatus });
  } catch (error) { console.error("Erro ao confirmar cadastro:", error); return res.status(error.status || 500).json({ message: error.status ? error.message : "Não foi possível validar o código." }); }
}

router.post("/register/resend", async (req, res) => {
  try {
    const user = await Users.findByPk(req.body?.registrationId); if (!user) return res.status(404).json({ message: "Cadastro não encontrado." });
    const channel = user.registrationStatus === REGISTRATION_STATUS.EMAIL_PENDING ? "email" : user.registrationStatus === REGISTRATION_STATUS.PHONE_PENDING ? "phone" : null;
    if (!channel) return res.status(409).json({ message: "Este cadastro não possui confirmação pendente." });
    const devCode = await issueVerification(user, channel); await auditRegistration(req, `${channel}_verification_resent`, { userId: user.id, email: user.email, phone: user.phone });
    return res.json({ message: `Novo código enviado por ${channel === "email" ? "e-mail" : "WhatsApp/SMS"}.`, resendAfter: 60, ...(devCode ? { devCode } : {}) });
  } catch (error) { return res.status(error.status || 500).json({ message: error.message || "Não foi possível reenviar." , retryAfter: error.retryAfter }); }
});

router.get("/register/status/:registrationId", async (req, res) => {
  const user = await Users.findByPk(req.params.registrationId, { attributes: ["id", "registrationStatus", "email", "phone"] });
  if (!user) return res.status(404).json({ message: "Cadastro não encontrado." });
  return res.json({ registrationId: user.id, status: user.registrationStatus, email: user.email.replace(/(^.).*(@.*$)/, "$1***$2"), phone: `•••• ${user.phone.slice(-4)}` });
});

export default router;
