import express from "express";
import { Op, fn, col, literal } from "sequelize";
import authenticate from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import AdminAuditLog from "../models/AdminAuditLog.js";

const router = express.Router();

router.get("/admin/audit", authenticate, adminMiddleware, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where = {};
    if (req.query.action) where.action = req.query.action;
    if (req.query.adminUserId) where.admin_user_id = req.query.adminUserId;

    if (req.query.days) {
      const n = Number(req.query.days);
      if (Number.isFinite(n) && n > 0 && n <= 365) {
        const since = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
        where.created_at = { [Op.gte]: since };
      }
    } else if (req.query.startDate || req.query.endDate) {
      where.created_at = {};
      if (req.query.startDate) where.created_at[Op.gte] = new Date(req.query.startDate);
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        where.created_at[Op.lte] = end;
      }
    }

    const { rows, count } = await AdminAuditLog.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    return res.json({ ok: true, data: { items: rows, total: count, limit, offset } });
  } catch (error) {
    console.error("[admin/audit]", error);
    return res.status(500).json({ message: "Erro ao listar audit logs", error: error.message });
  }
});

router.get("/admin/audit/summary", authenticate, adminMiddleware, async (req, res) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const byAction = await AdminAuditLog.findAll({
      attributes: ["action", [fn("COUNT", col("id")), "count"]],
      where: { created_at: { [Op.gte]: since } },
      group: ["action"],
      order: [[literal("count"), "DESC"]],
      limit: 20,
      raw: true,
    });
    const byAdmin = await AdminAuditLog.findAll({
      attributes: ["admin_user_id", "admin_name", [fn("COUNT", col("id")), "count"]],
      where: { created_at: { [Op.gte]: since } },
      group: ["admin_user_id", "admin_name"],
      order: [[literal("count"), "DESC"]],
      raw: true,
    });

    return res.json({ ok: true, data: { byAction, byAdmin, since } });
  } catch (error) {
    console.error("[admin/audit/summary]", error);
    return res.status(500).json({ message: "Erro ao montar resumo", error: error.message });
  }
});

export default router;
