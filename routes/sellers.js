import express from "express";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import sequelize from "../database/config.js";
import authenticate from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import Seller from "../models/Seller.js";
import CommissionRule from "../models/CommissionRule.js";
import SellerCustomer from "../models/SellerCustomer.js";
import Referral from "../models/Referral.js";
import Commission from "../models/Commission.js";
import Users from "../models/Users.js";
import Subscription from "../models/Subscription.js";
import CommissionPayment from "../models/CommissionPayment.js";
import SellerAuditLog from "../models/SellerAuditLog.js";
import Addon from "../models/Addon.js";
import ClientAddon from "../models/ClientAddon.js";
import { normalizeSellerCode, registerReferralVisit, SELLER_SYSTEM_ID } from "../service/sellerCommissions.js";

const router = express.Router();
const admin = [authenticate, adminMiddleware];
const jwtSecret = () => process.env.JWT_SECRET || process.env.JWTSECRET || process.env.JWT_SECRET_KEY || "viapet_jwt_fallback_change_me";
const sellerDto = (seller) => ({ id: seller.id, name: seller.name, email: seller.email, phone: seller.phone, whatsapp: seller.whatsapp,
  document: seller.document, joinedAt: seller.joinedAt, status: seller.status, code: seller.code, notes: seller.notes,
  approvedAt: seller.approvedAt, lastAccessAt: seller.lastAccessAt, createdAt: seller.createdAt, updatedAt: seller.updatedAt });
const sellerAuth = async (req, res, next) => { try { const token = req.headers.authorization?.split(" ")[1]; const decoded = jwt.verify(token, jwtSecret());
  if (decoded.role !== "seller") return res.status(403).json({ message: "Acesso restrito a vendedores." });
  const seller = await Seller.findOne({ where: { id: decoded.id, status: "active" } }); if (!seller) return res.status(403).json({ message: "Vendedor inativo ou bloqueado." });
  req.seller = seller; next(); } catch { return res.status(401).json({ message: "Sessão inválida." }); } };

router.post("/seller-register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").replace(/\D/g, "").slice(0, 20);
    const password = String(req.body.password || "");
    if (!name || !email || !phone || password.length < 8) return res.status(400).json({ message: "Informe nome, e-mail, WhatsApp e uma senha com pelo menos 8 caracteres." });
    const [existing, existingUser] = await Promise.all([Seller.findOne({ where: { systemId: SELLER_SYSTEM_ID, email } }), Users.findOne({ where: { email } })]);
    if (existing || existingUser) return res.status(409).json({ message: "Este e-mail já possui um acesso no ViaPet." });
    const baseCode = normalizeSellerCode(name).slice(0, 48) || "VENDEDOR";
    let code = `${baseCode}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    while (await Seller.count({ where: { systemId: SELLER_SYSTEM_ID, code } })) code = `${baseCode}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const seller = await Seller.create({ systemId: SELLER_SYSTEM_ID, name, email, phone, whatsapp: phone, document: req.body.document || null,
      joinedAt: new Date().toISOString().slice(0, 10), status: "pending", code, notes: req.body.notes || null, passwordHash: await bcrypt.hash(password, 12) });
    await SellerAuditLog.create({ systemId: SELLER_SYSTEM_ID, action: "seller_registration_requested", newSellerId: seller.id, metadata: { email, phone } });
    return res.status(201).json({ ok: true, message: "Cadastro enviado. Você poderá entrar após a liberação do administrador." });
  } catch (error) { return res.status(500).json({ message: "Não foi possível concluir o cadastro.", error: error.message }); }
});

router.post("/seller-referrals/visit", async (req, res) => {
  try {
    const referral = await registerReferralVisit({ ...req.body, ip: req.ip });
    return res.status(201).json({ ok: true, data: { id: referral.id, expiresAt: referral.expiresAt } });
  } catch (error) { return res.status(error.status || 500).json({ message: error.message }); }
});

router.post("/seller-auth/login", async (req, res) => { const seller = await Seller.findOne({ where: { systemId: SELLER_SYSTEM_ID, email: String(req.body.email || "").trim().toLowerCase() } });
  if (!seller?.passwordHash || seller.status !== "active" || !(await bcrypt.compare(String(req.body.password || ""), seller.passwordHash))) return res.status(401).json({ message: "E-mail ou senha inválidos." });
  const token = jwt.sign({ id: seller.id, role: "seller", systemId: SELLER_SYSTEM_ID }, jwtSecret(), { expiresIn: "7d" });
  return res.json({ token, seller: { id: seller.id, name: seller.name, email: seller.email, code: seller.code } }); });

router.get("/seller-dashboard", sellerAuth, async (req, res) => { const sellerId = req.seller.id;
  const [links, commissions] = await Promise.all([SellerCustomer.findAll({ where: { sellerId } }), Commission.findAll({ where: { sellerId } })]);
  const userIds = links.map((x) => x.userId); const users = userIds.length ? await Users.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ["id", "name", "companyName", "email", "createdAt", "plan", "expirationDate"] }) : [];
  const [subs, addons, clientAddons] = await Promise.all([
    userIds.length ? Subscription.findAll({ where: { user_id: { [Op.in]: userIds } }, order: [["created_at", "DESC"]] }) : [],
    Addon.findAll({ where: { active: true }, order: [["sort_order", "ASC"], ["name", "ASC"]] }),
    userIds.length ? ClientAddon.findAll({ where: { client_user_id: { [Op.in]: userIds } } }) : [],
  ]);
  const subMap = new Map(); for (const sub of subs) if (!subMap.has(sub.user_id)) subMap.set(sub.user_id, sub);
  const clientAddonMap = new Map(); for (const item of clientAddons) { const list = clientAddonMap.get(item.client_user_id) || []; list.push(item); clientAddonMap.set(item.client_user_id, list); }
  const amountBy = (status) => commissions.filter((x) => status.includes(x.status)).reduce((sum, x) => sum + Number(x.commissionAmount), 0);
  return res.json({ ok: true, data: { seller: sellerDto(req.seller), link: `${process.env.FRONTEND_URL || "https://viapet.app"}/cadastro?ref=${req.seller.code}`,
    metrics: { customers: links.length, active: users.filter((x) => x.plan).length, trial: subs.filter((x) => x.plan_type === "trial" && x.status === "active").length,
      pending: amountBy(["pending"]), approved: amountBy(["approved"]), paid: amountBy(["paid"]) },
    catalog: addons,
    customers: users.map((x) => ({ ...x.toJSON(), subscription: subMap.get(x.id) || null,
      products: addons.map((addon) => { const owned = (clientAddonMap.get(x.id) || []).find((item) => item.addon_id === addon.id); return { id: addon.id, key: addon.key, name: addon.name, description: addon.description,
        catalogPrice: addon.default_amount, contracted: owned?.status === "active" || owned?.status === "trial", status: owned?.status || "available", price: owned?.amount_override ?? addon.default_amount }; }) })), commissions } }); });
router.get("/seller-dashboard/qr", sellerAuth, async (req, res) => { const link = `${process.env.FRONTEND_URL || "https://viapet.app"}/cadastro?ref=${req.seller.code}`;
  return res.json({ ok: true, data: { link, qrCode: await QRCode.toDataURL(link, { width: 420, margin: 2, color: { dark: "#332b38", light: "#ffffff" } }) } }); });

router.get("/admin/sellers", ...admin, async (_req, res) => {
  const rows = await Seller.findAll({ where: { systemId: SELLER_SYSTEM_ID }, order: [["name", "ASC"]] });
  const data = await Promise.all(rows.map(async (seller) => ({ ...sellerDto(seller),
    link: `${process.env.FRONTEND_URL || "https://viapet.app"}/cadastro?ref=${seller.code}`,
    customers: await SellerCustomer.count({ where: { sellerId: seller.id } }),
    clicks: await Referral.count({ where: { sellerId: seller.id } }),
  })));
  return res.json({ ok: true, data });
});

router.post("/admin/sellers", ...admin, async (req, res) => {
  try {
    const code = normalizeSellerCode(req.body.code || req.body.name);
    if (!code) return res.status(400).json({ message: "Informe um código válido." });
    const seller = await Seller.create({ systemId: SELLER_SYSTEM_ID, name: req.body.name, email: String(req.body.email || "").toLowerCase(),
      phone: req.body.phone || null, whatsapp: req.body.whatsapp || req.body.phone || null, document: req.body.document || null,
      joinedAt: req.body.joinedAt || new Date().toISOString().slice(0, 10), status: req.body.status || "active", code, notes: req.body.notes || null,
      passwordHash: req.body.password ? await bcrypt.hash(String(req.body.password), 12) : null });
    await CommissionRule.create({ sellerId: seller.id, systemId: SELLER_SYSTEM_ID, planId: null,
      calculationType: req.body.calculationType || "percentage", value: Number(req.body.commissionValue || 0),
      recurrenceType: req.body.recurrenceType || "recurring", maxMonths: req.body.maxMonths || null, active: true });
    return res.status(201).json({ ok: true, data: seller });
  } catch (error) { return res.status(error.name === "SequelizeUniqueConstraintError" ? 409 : 500).json({ message: error.name === "SequelizeUniqueConstraintError" ? "Código ou e-mail já utilizado." : error.message }); }
});

router.get("/admin/sellers/:id/rules", ...admin, async (req, res) => res.json({ ok: true, data: await CommissionRule.findAll({ where: { sellerId: req.params.id, systemId: SELLER_SYSTEM_ID }, order: [["planId", "ASC NULLS FIRST"]] }) }));
router.post("/admin/sellers/:id/rules", ...admin, async (req, res) => { const rule = await CommissionRule.create({ sellerId: req.params.id, systemId: SELLER_SYSTEM_ID,
  planId: req.body.planId || null, calculationType: req.body.calculationType || "percentage", value: Number(req.body.value || 0),
  recurrenceType: req.body.recurrenceType || "recurring", maxMonths: req.body.maxMonths || null, startsAt: req.body.startsAt || null, endsAt: req.body.endsAt || null, active: req.body.active !== false }); return res.status(201).json({ ok: true, data: rule }); });

router.put("/admin/seller-customers/:userId", ...admin, async (req, res) => { if (!String(req.body.reason || "").trim()) return res.status(400).json({ message: "Informe o motivo da alteração." });
  const seller = await Seller.findOne({ where: { id: req.body.sellerId, systemId: SELLER_SYSTEM_ID } }); if (!seller) return res.status(404).json({ message: "Vendedor não encontrado." });
  const result = await sequelize.transaction(async (transaction) => { const current = await SellerCustomer.findOne({ where: { systemId: SELLER_SYSTEM_ID, userId: req.params.userId }, transaction, lock: transaction.LOCK.UPDATE });
    const previousSellerId = current?.sellerId || null; const row = current ? await current.update({ sellerId: seller.id, sellerCodeSnapshot: seller.code, attributedAt: new Date() }, { transaction })
      : await SellerCustomer.create({ sellerId: seller.id, userId: req.params.userId, systemId: SELLER_SYSTEM_ID, source: "seller", sellerCodeSnapshot: seller.code, attributedAt: new Date() }, { transaction });
    await SellerAuditLog.create({ systemId: SELLER_SYSTEM_ID, action: "customer_seller_changed", userId: req.params.userId, previousSellerId, newSellerId: seller.id, actorUserId: req.user.id, reason: req.body.reason }, { transaction }); return row; });
  return res.json({ ok: true, data: result }); });

router.patch("/admin/sellers/:id", ...admin, async (req, res) => {
  const seller = await Seller.findOne({ where: { id: req.params.id, systemId: SELLER_SYSTEM_ID } });
  if (!seller) return res.status(404).json({ message: "Vendedor não encontrado." });
  await seller.update({ name: req.body.name ?? seller.name, phone: req.body.phone ?? seller.phone,
    whatsapp: req.body.whatsapp ?? seller.whatsapp, email: req.body.email ?? seller.email,
    document: req.body.document ?? seller.document, status: req.body.status ?? seller.status, notes: req.body.notes ?? seller.notes });
  return res.json({ ok: true, data: seller });
});

router.patch("/admin/sellers/:id/approval", ...admin, async (req, res) => {
  const seller = await Seller.findOne({ where: { id: req.params.id, systemId: SELLER_SYSTEM_ID } });
  if (!seller) return res.status(404).json({ message: "Vendedor não encontrado." });
  const approved = req.body.approved === true;
  await seller.update({ status: approved ? "active" : "blocked", approvedAt: approved ? new Date() : null, approvedBy: approved ? req.user.id : null });
  if (approved) await CommissionRule.findOrCreate({ where: { sellerId: seller.id, systemId: SELLER_SYSTEM_ID, planId: null }, defaults: {
    calculationType: "percentage", value: Math.max(0, Number(req.body.commissionValue || 0)), recurrenceType: "recurring", active: true,
  } });
  await SellerAuditLog.create({ systemId: SELLER_SYSTEM_ID, action: approved ? "seller_access_approved" : "seller_access_blocked", newSellerId: seller.id, actorUserId: req.user.id, reason: req.body.reason || null });
  return res.json({ ok: true, data: seller });
});

router.get("/admin/seller-commissions", ...admin, async (req, res) => {
  const where = { systemId: SELLER_SYSTEM_ID };
  if (req.query.sellerId) where.sellerId = req.query.sellerId;
  if (req.query.status) where.status = req.query.status;
  const rows = await Commission.findAll({ where, order: [["createdAt", "DESC"]], limit: 500 });
  const sellerIds = [...new Set(rows.map((row) => row.sellerId))]; const userIds = [...new Set(rows.map((row) => row.userId))];
  const sellers = await Seller.findAll({ where: { id: { [Op.in]: sellerIds } } });
  const users = await Users.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ["id", "name", "companyName"] });
  const sellerMap = new Map(sellers.map((x) => [x.id, x])); const userMap = new Map(users.map((x) => [x.id, x]));
  return res.json({ ok: true, data: rows.map((row) => ({ ...row.toJSON(), sellerName: sellerMap.get(row.sellerId)?.name,
    customerName: userMap.get(row.userId)?.companyName || userMap.get(row.userId)?.name })) });
});

router.patch("/admin/seller-commissions/:id/status", ...admin, async (req, res) => {
  const allowed = ["pending", "approved", "cancelled", "refunded"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ message: "Status inválido." });
  const row = await Commission.findByPk(req.params.id); if (!row) return res.status(404).json({ message: "Comissão não encontrada." });
  const patch = { status: req.body.status };
  if (req.body.status === "approved") patch.approvedAt = new Date();
  await row.update(patch); return res.json({ ok: true, data: row });
});

router.post("/admin/seller-commissions/pay", ...admin, async (req, res) => { const ids = Array.isArray(req.body.commissionIds) ? req.body.commissionIds : [];
  if (!ids.length || !req.body.paymentMethod) return res.status(400).json({ message: "Selecione comissões e informe a forma de pagamento." });
  const result = await sequelize.transaction(async (transaction) => { const rows = await Commission.findAll({ where: { id: { [Op.in]: ids }, status: "approved" }, transaction, lock: transaction.LOCK.UPDATE });
    if (!rows.length || new Set(rows.map((x) => x.sellerId)).size !== 1) throw Object.assign(new Error("Selecione comissões aprovadas do mesmo vendedor."), { status: 400 });
    const amount = rows.reduce((sum, x) => sum + Number(x.commissionAmount), 0); const payment = await CommissionPayment.create({ sellerId: rows[0].sellerId, systemId: SELLER_SYSTEM_ID, amount,
      paidAt: req.body.paidAt || new Date(), paymentMethod: req.body.paymentMethod, notes: req.body.notes || null, proofUrl: req.body.proofUrl || null, createdBy: req.user.id }, { transaction });
    await Commission.update({ status: "paid", paidAt: payment.paidAt, commissionPaymentId: payment.id }, { where: { id: { [Op.in]: rows.map((x) => x.id) }, status: "approved" }, transaction }); return payment; });
  return res.status(201).json({ ok: true, data: result }); });

export default router;
