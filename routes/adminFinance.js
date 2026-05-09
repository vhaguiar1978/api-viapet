import express from "express";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import addonBilling from "../service/addonBilling.js";
import Subscription from "../models/Subscription.js";
import Users from "../models/Users.js";
import ClientAddon from "../models/ClientAddon.js";
import Addon from "../models/Addon.js";
import PaymentHistory from "../models/PaymentHistory.js";

const router = express.Router();

/**
 * GET /admin/finance/snapshot?month=YYYY-MM
 * Tudo o que a página /admin/financeiro precisa numa única chamada.
 */
router.get("/admin/finance/snapshot", authenticate, adminMiddleware, async (req, res) => {
  try {
    const month = req.query?.month ? String(req.query.month).slice(0, 7) : null;
    const data = await addonBilling.financialSnapshot({ month });
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("[finance/snapshot]", error);
    return res.status(500).json({ message: "Erro ao montar snapshot", error: error.message });
  }
});

/**
 * GET /admin/finance/clients?month=YYYY-MM
 * Tabela cliente x plano x cada addon x próximo vencimento x status.
 */
router.get("/admin/finance/clients", authenticate, adminMiddleware, async (req, res) => {
  try {
    const users = await Users.findAll({
      where: { role: "proprietario" },
      attributes: ["id", "name", "email", "phone", "lastAccess", "createdAt"],
      order: [["name", "ASC"]],
    });
    const userIds = users.map((u) => u.id);

    const subs = await Subscription.findAll({
      where: { user_id: { [Op.in]: userIds } },
      raw: true,
    });
    const subsByUser = new Map();
    for (const s of subs) subsByUser.set(s.user_id, s);

    const addons = await ClientAddon.findAll({
      where: { client_user_id: { [Op.in]: userIds } },
      include: [{ model: Addon, as: "addon", attributes: ["key", "name", "default_amount"] }],
    });
    const addonsByUser = new Map();
    for (const a of addons) {
      const arr = addonsByUser.get(a.client_user_id) || [];
      arr.push({
        id: a.id,
        addon_key: a.addon_key,
        addon_name: a.addon?.name || a.addon_key,
        status: a.status,
        amount: Number(a.amount_override ?? a.addon?.default_amount ?? 0),
        next_billing_date: a.next_billing_date,
      });
      addonsByUser.set(a.client_user_id, arr);
    }

    const now = new Date();
    const items = users.map((u) => {
      const sub = subsByUser.get(u.id) || null;
      const userAddons = addonsByUser.get(u.id) || [];
      let derivedStatus = "sem_plano";
      if (sub) {
        if (sub.status === "active") {
          if (sub.next_billing_date && new Date(sub.next_billing_date) < now) {
            derivedStatus = "atrasado";
          } else if (sub.plan_type === "trial") {
            derivedStatus = "trial";
          } else {
            derivedStatus = "em_dia";
          }
        } else {
          derivedStatus = sub.status;
        }
      }
      const addonsTotal = userAddons
        .filter((a) => a.status === "active")
        .reduce((s, a) => s + a.amount, 0);
      return {
        user_id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        lastAccess: u.lastAccess,
        createdAt: u.createdAt,
        subscription: sub
          ? {
              status: sub.status,
              plan_type: sub.plan_type,
              amount: Number(sub.amount),
              next_billing_date: sub.next_billing_date,
              trial_end: sub.trial_end,
            }
          : null,
        addons: userAddons,
        derivedStatus,
        monthlyTotal: (sub?.status === "active" ? Number(sub.amount) : 0) + addonsTotal,
      };
    });

    return res.json({ ok: true, data: items });
  } catch (error) {
    console.error("[finance/clients]", error);
    return res.status(500).json({ message: "Erro ao listar clientes", error: error.message });
  }
});

/**
 * GET /admin/finance/payments?month=YYYY-MM&limit=200
 * Histórico de pagamentos do período (últimos 200).
 */
router.get("/admin/finance/payments", authenticate, adminMiddleware, async (req, res) => {
  try {
    const where = {};
    if (req.query?.month) {
      const ref = new Date(`${req.query.month}-01T00:00:00Z`);
      const start = new Date(ref);
      const end = new Date(ref);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCMilliseconds(-1);
      where.date_approved = { [Op.gte]: start, [Op.lte]: end };
    }
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const rows = await PaymentHistory.findAll({
      where,
      order: [["date_approved", "DESC"]],
      limit,
    });
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[finance/payments]", error);
    return res.status(500).json({ message: "Erro ao listar pagamentos", error: error.message });
  }
});

/**
 * GET /admin/finance/inadimplencia
 */
router.get("/admin/finance/inadimplencia", authenticate, adminMiddleware, async (req, res) => {
  try {
    const data = await addonBilling.inadimplenciaList();
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("[finance/inadimplencia]", error);
    return res.status(500).json({ message: "Erro ao listar inadimplencia", error: error.message });
  }
});

export default router;
