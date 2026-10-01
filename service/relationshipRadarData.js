import { Op } from "sequelize";
import ActivityLog from "../models/ActivityLog.js";
import Subscription from "../models/Subscription.js";
import PaymentHistory from "../models/PaymentHistory.js";
import WhatsappConsent from "../models/WhatsappConsent.js";
import WhatsappIaConversation from "../models/WhatsappIaConversation.js";
import SellerCustomer from "../models/SellerCustomer.js";
import { evaluateRelationship, scopeRelationshipRecords } from "./relationshipRadarRules.js";

export async function assessRelationshipUsers(users, settings, now = new Date()) {
  if (!users.length) return [];
  const ids = users.map((user) => user.id);
  const since = new Date(now.getTime() - 7 * 86400000);
  const [activities, subscriptions, payments, consents, conversations, sellers] = await Promise.all([
    ActivityLog.findAll({ where: { user_id: { [Op.in]: ids }, created_at: { [Op.gte]: since } }, attributes: ["user_id", "modulo", "acao", "descricao", "metadata_json", "created_at"], order: [["created_at", "DESC"]], limit: 2000 }),
    Subscription.findAll({ where: { user_id: { [Op.in]: ids } }, order: [["created_at", "DESC"]] }),
    PaymentHistory.findAll({ where: { user_id: { [Op.in]: ids }, status: "approved" }, order: [["date_approved", "DESC"]], limit: 200 }),
    WhatsappConsent.findAll({ where: { userId: { [Op.in]: ids } }, order: [["updatedAt", "DESC"]] }),
    WhatsappIaConversation.findAll({ where: { userId: { [Op.in]: ids } }, order: [["updatedAt", "DESC"]] }),
    SellerCustomer.findAll({ where: { systemId: "VIAPET", userId: { [Op.in]: ids } }, attributes: ["userId", "sellerId"] }),
  ]);
  const latestBy = (rows, key) => new Map(rows.slice().reverse().map((row) => [String(row[key]), row]));
  const activityBy = new Map();
  for (const activity of activities) { const key = String(activity.user_id); const list = activityBy.get(key) || []; list.push(activity); activityBy.set(key, list); }
  const subscriptionsBy = latestBy(subscriptions, "user_id");
  const paymentsBy = latestBy(payments, "user_id");
  const consentsBy = latestBy(scopeRelationshipRecords(consents, users), "userId");
  const conversationsBy = latestBy(scopeRelationshipRecords(conversations, users), "userId");
  const sellersBy = latestBy(sellers, "userId");
  return users.map((user) => {
    const id = String(user.id);
    const decision = evaluateRelationship({ user, activities: activityBy.get(id) || [], subscription: subscriptionsBy.get(id), payment: paymentsBy.get(id), consent: consentsBy.get(id), conversation: conversationsBy.get(id), sellerId: sellersBy.get(id)?.sellerId, settings, now });
    return { id: user.id, name: user.companyName || user.name, createdAt: user.createdAt, lastAccess: user.lastAccess, sellerId: sellersBy.get(id)?.sellerId || null, ...decision };
  });
}
