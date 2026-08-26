import crypto from "node:crypto";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Seller from "../models/Seller.js";
import Referral from "../models/Referral.js";
import SellerCustomer from "../models/SellerCustomer.js";
import CommissionRule from "../models/CommissionRule.js";
import Commission from "../models/Commission.js";

export const SELLER_SYSTEM_ID = "VIAPET";

export function normalizeSellerCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 64);
}

export function hashReferralIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(`${process.env.REFERRAL_HASH_SALT || "viapet"}:${ip}`).digest("hex");
}

export async function registerReferralVisit(payload = {}) {
  const code = normalizeSellerCode(payload.code);
  const sessionId = String(payload.sessionId || "").trim().slice(0, 128);
  if (!code || !sessionId) throw Object.assign(new Error("Código e sessão são obrigatórios."), { status: 400 });
  const seller = await Seller.findOne({ where: { systemId: SELLER_SYSTEM_ID, code, status: "active" } });
  if (!seller) throw Object.assign(new Error("Link de vendedor inválido ou inativo."), { status: 404 });
  const existing = await Referral.findOne({ where: { systemId: SELLER_SYSTEM_ID, sessionId } });
  if (existing) return existing; // first valid attribution wins
  const now = new Date(); const expiresAt = new Date(now.getTime() + 30 * 86400000);
  return Referral.create({ sellerId: seller.id, systemId: SELLER_SYSTEM_ID, sessionId,
    ipHash: hashReferralIp(payload.ip), utmSource: payload.utmSource || null,
    utmMedium: payload.utmMedium || null, utmCampaign: payload.utmCampaign || null,
    landingPage: payload.landingPage || null, firstAccessAt: now, expiresAt });
}

export async function attributeRegisteredUser({ userId, sessionId, code, transaction } = {}) {
  const current = await SellerCustomer.findOne({ where: { systemId: SELLER_SYSTEM_ID, userId }, transaction });
  if (current) return current;
  const where = { systemId: SELLER_SYSTEM_ID, expiresAt: { [Op.gte]: new Date() } };
  if (sessionId) where.sessionId = String(sessionId).slice(0, 128);
  const referral = sessionId ? await Referral.findOne({ where, transaction }) : null;
  const seller = referral
    ? await Seller.findByPk(referral.sellerId, { transaction })
    : code ? await Seller.findOne({ where: { systemId: SELLER_SYSTEM_ID, code: normalizeSellerCode(code), status: "active" }, transaction }) : null;
  if (!seller) return null;
  const [link] = await SellerCustomer.findOrCreate({
    where: { systemId: SELLER_SYSTEM_ID, userId }, transaction,
    defaults: { sellerId: seller.id, source: "seller", sellerCodeSnapshot: seller.code,
      attributedAt: new Date(), referralId: referral?.id || null },
  });
  if (referral && !referral.registeredUserId) await referral.update({ registeredUserId: userId, registeredAt: new Date() }, { transaction });
  return link;
}

export async function createCommissionForApprovedPayment({ userId, paymentId, paymentHistoryId, amount, planId } = {}) {
  if (!userId || !paymentId || Number(amount) <= 0) return null;
  try {
    return await sequelize.transaction(async (transaction) => {
    const attribution = await SellerCustomer.findOne({ where: { systemId: SELLER_SYSTEM_ID, userId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!attribution) return null;
    const existing = await Commission.findOne({ where: { systemId: SELLER_SYSTEM_ID, externalPaymentId: String(paymentId) }, transaction });
    if (existing) return existing;
    const today = new Date().toISOString().slice(0, 10);
    const rules = await CommissionRule.findAll({ where: { sellerId: attribution.sellerId, systemId: SELLER_SYSTEM_ID, active: true,
      [Op.and]: [{ [Op.or]: [{ startsAt: null }, { startsAt: { [Op.lte]: today } }] }, { [Op.or]: [{ endsAt: null }, { endsAt: { [Op.gte]: today } }] }] }, transaction });
    const rule = rules.find((item) => item.planId && item.planId === planId) || rules.find((item) => !item.planId);
    if (!rule) return null;
    const priorCount = await Commission.count({ where: { sellerId: attribution.sellerId, userId, systemId: SELLER_SYSTEM_ID, status: { [Op.notIn]: ["cancelled", "refunded"] } }, transaction });
    if (rule.recurrenceType === "first_payment" && priorCount > 0) return null;
    if (rule.maxMonths && priorCount >= rule.maxMonths) return null;
    const base = Number(amount); const ruleValue = Number(rule.value);
    const commissionAmount = rule.calculationType === "fixed" ? ruleValue : Math.round(base * ruleValue) / 100;
    return Commission.create({ sellerId: attribution.sellerId, userId, paymentHistoryId: paymentHistoryId || null,
      systemId: SELLER_SYSTEM_ID, externalPaymentId: String(paymentId), planId: planId || null,
      paymentAmount: base, calculationTypeSnapshot: rule.calculationType, ruleValueSnapshot: ruleValue,
      recurrenceTypeSnapshot: rule.recurrenceType, commissionAmount, status: "pending" }, { transaction });
    });
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError") {
      return Commission.findOne({ where: { systemId: SELLER_SYSTEM_ID, externalPaymentId: String(paymentId) } });
    }
    throw error;
  }
}

export async function cancelCommissionForPayment(paymentId, reason = "Pagamento estornado") {
  return Commission.update({ status: "refunded", cancelledAt: new Date(), cancellationReason: reason },
    { where: { systemId: SELLER_SYSTEM_ID, externalPaymentId: String(paymentId), status: { [Op.notIn]: ["cancelled", "refunded"] } } });
}
