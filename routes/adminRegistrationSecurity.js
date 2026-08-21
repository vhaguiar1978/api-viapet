import express from "express";
import { Op } from "sequelize";
import adminMiddleware from "../middlewares/admin.js";
import Users from "../models/Users.js";
import LoginHistory from "../models/LoginHistory.js";
import RegistrationSecurityEvent from "../models/RegistrationSecurityEvent.js";
import RegistrationIpBlock from "../models/RegistrationIpBlock.js";
import RegistrationVerification from "../models/RegistrationVerification.js";
import Settings from "../models/Settings.js";
import Subscription from "../models/Subscription.js";
import { auditRegistration, issueVerification, REGISTRATION_STATUS } from "../service/registrationSecurity.js";

const router = express.Router();
router.use("/admin/registration-security", adminMiddleware);

router.get("/admin/registration-security", async (req, res) => {
  const { status = "", search = "", page = 1, limit = 25 } = req.query;
  const where = { role: "proprietario" };
  if (status) where.registrationStatus = status;
  if (search) where[Op.or] = [{ name: { [Op.iLike]: `%${search}%` } }, { email: { [Op.iLike]: `%${search}%` } }, { phone: { [Op.iLike]: `%${search}%` } }];
  const result = await Users.findAndCountAll({ where, attributes: ["id", "name", "companyName", "email", "phone", "registrationStatus", "emailConfirmedAt", "phoneConfirmedAt", "trustedAt", "createdAt", "lastAccess"], order: [["createdAt", "DESC"]], limit: Math.min(100, Number(limit)), offset: (Number(page) - 1) * Number(limit) });
  const ids = result.rows.map((item) => item.id);
  const events = ids.length ? await RegistrationSecurityEvent.findAll({ where: { userId: ids }, order: [["createdAt", "DESC"]] }) : [];
  const latestByUser = new Map(); for (const event of events) if (!latestByUser.has(event.userId)) latestByUser.set(event.userId, event);
  return res.json({ total: result.count, page: Number(page), items: result.rows.map((user) => ({ ...user.toJSON(), security: latestByUser.get(user.id)?.toJSON() || null })) });
});

router.get("/admin/registration-security/:id", async (req, res) => {
  const user = await Users.findByPk(req.params.id, { attributes: { exclude: ["password", "recoveryPassToken"] } });
  if (!user) return res.status(404).json({ message: "Cadastro não encontrado." });
  const [events, logins] = await Promise.all([RegistrationSecurityEvent.findAll({ where: { userId: user.id }, order: [["createdAt", "DESC"]], limit: 200 }), LoginHistory.findAll({ where: { userId: user.id }, order: [["createdAt", "DESC"]], limit: 100 })]);
  return res.json({ user, events, logins });
});

router.patch("/admin/registration-security/:id/status", async (req, res) => {
  const allowed = [REGISTRATION_STATUS.BLOCKED, REGISTRATION_STATUS.SUSPICIOUS, REGISTRATION_STATUS.ACTIVE];
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ message: "Status inválido." });
  const user = await Users.findByPk(req.params.id); if (!user) return res.status(404).json({ message: "Cadastro não encontrado." });
  user.registrationStatus = req.body.status; user.status = req.body.status === REGISTRATION_STATUS.ACTIVE;
  if (req.body.status === REGISTRATION_STATUS.ACTIVE) {
    user.trustedAt = new Date(); user.establishment = user.id;
    const [settings] = await Settings.findOrCreate({ where: { usersId: user.id }, defaults: { storeName: user.companyName || user.name, intervalClinic: 30, intervalAesthetics: 30, openingTime: "08:00", closingTime: "18:00", breakStartTime: "12:00", breakEndTime: "13:00", notifyClient: true, themeColor: "#e4572e", textColor: "#1F2937" } });
    const [subscription] = await Subscription.findOrCreate({ where: { user_id: user.id }, defaults: { plan_type: "trial", status: "active", amount: 0, currency: "BRL", trial_start: new Date(), trial_end: new Date(Date.now() + 30 * 86400000), billing_cycle_start: new Date(Date.now() + 30 * 86400000), next_billing_date: new Date(Date.now() + 30 * 86400000), notes: "Cadastro validado manualmente pela segurança." } });
    void settings; void subscription;
  }
  await user.save();
  await auditRegistration(req, "admin_status_changed", { userId: user.id, email: user.email, phone: user.phone, metadata: { status: req.body.status, adminId: req.user?.id } });
  return res.json({ message: "Status atualizado.", user });
});

router.post("/admin/registration-security/:id/resend", async (req, res) => {
  const user = await Users.findByPk(req.params.id); if (!user) return res.status(404).json({ message: "Cadastro não encontrado." });
  const channel = user.registrationStatus === REGISTRATION_STATUS.EMAIL_PENDING ? "email" : "phone";
  await issueVerification(user, channel); return res.json({ message: "Confirmação reenviada." });
});

router.post("/admin/registration-security/block-ip", async (req, res) => {
  const ip = String(req.body?.ip || "").trim(); if (!ip) return res.status(400).json({ message: "Informe o IP." });
  await RegistrationIpBlock.findOrCreate({ where: { ip }, defaults: { reason: req.body?.reason || "Bloqueado pelo administrador", blockedBy: req.user?.id } });
  return res.json({ message: "IP bloqueado." });
});

router.delete("/admin/registration-security/:id", async (req, res) => {
  const user = await Users.findByPk(req.params.id); if (!user) return res.status(404).json({ message: "Cadastro não encontrado." });
  if (user.registrationStatus === REGISTRATION_STATUS.ACTIVE) return res.status(409).json({ message: "Cadastros ativos não podem ser excluídos por esta tela." });
  await RegistrationVerification.destroy({ where: { userId: user.id } }); await user.destroy(); return res.json({ message: "Cadastro não confirmado excluído." });
});

export async function cleanupUnconfirmedRegistrations() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const users = await Users.findAll({ where: { registrationStatus: REGISTRATION_STATUS.EMAIL_PENDING, createdAt: { [Op.lt]: cutoff } } });
  for (const user of users) { await RegistrationSecurityEvent.create({ userId: null, eventType: "registration_expired_deleted", email: user.email, phone: user.phone, metadata: { originalUserId: user.id } }); await user.destroy(); }
  return users.length;
}

export default router;
