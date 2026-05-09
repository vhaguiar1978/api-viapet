import express from "express";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import Addon from "../models/Addon.js";
import ClientAddon from "../models/ClientAddon.js";
import Users from "../models/Users.js";

const router = express.Router();

function slugifyKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// =====================================================================
// GET /admin/addons
// Catálogo de addons com contagem de assinaturas ativas
// =====================================================================
router.get("/admin/addons", authenticate, adminMiddleware, async (req, res) => {
  try {
    const addons = await Addon.findAll({ order: [["sort_order", "ASC"], ["name", "ASC"]] });
    const subs = await ClientAddon.findAll({
      attributes: ["addon_id", "status"],
      raw: true,
    });
    const counts = new Map();
    for (const s of subs) {
      const map = counts.get(s.addon_id) || { active: 0, suspended: 0, cancelled: 0, total: 0 };
      map.total += 1;
      if (s.status === "active") map.active += 1;
      else if (s.status === "suspended") map.suspended += 1;
      else if (s.status === "cancelled") map.cancelled += 1;
      counts.set(s.addon_id, map);
    }
    return res.json({
      ok: true,
      data: addons.map((a) => ({
        ...a.toJSON(),
        stats: counts.get(a.id) || { active: 0, suspended: 0, cancelled: 0, total: 0 },
      })),
    });
  } catch (error) {
    console.error("[admin/addons GET]", error);
    return res.status(500).json({ message: "Erro ao listar addons", error: error.message });
  }
});

// =====================================================================
// POST /admin/addons
// =====================================================================
router.post("/admin/addons", authenticate, adminMiddleware, async (req, res) => {
  try {
    const { name, description, default_amount, billing_cycle, active, sort_order } = req.body || {};
    if (!name) return res.status(400).json({ message: "Nome é obrigatório" });

    const explicitKey = String(req.body?.key || "").trim();
    const finalKey = explicitKey ? slugifyKey(explicitKey) : slugifyKey(name);
    if (!finalKey) return res.status(400).json({ message: "Não foi possível gerar a chave do addon" });

    const exists = await Addon.findOne({ where: { key: finalKey } });
    if (exists) return res.status(400).json({ message: `Já existe addon com a chave '${finalKey}'` });

    const addon = await Addon.create({
      key: finalKey,
      name,
      description: description || null,
      default_amount: Number(default_amount) || 0,
      billing_cycle: billing_cycle || "monthly",
      active: active !== false,
      sort_order: Number(sort_order) || 0,
    });
    return res.status(201).json({ ok: true, data: addon });
  } catch (error) {
    console.error("[admin/addons POST]", error);
    return res.status(500).json({ message: "Erro ao criar addon", error: error.message });
  }
});

// =====================================================================
// PUT /admin/addons/:id
// =====================================================================
router.put("/admin/addons/:id", authenticate, adminMiddleware, async (req, res) => {
  try {
    const addon = await Addon.findByPk(req.params.id);
    if (!addon) return res.status(404).json({ message: "Addon não encontrado" });

    const fields = ["name", "description", "default_amount", "billing_cycle", "active", "sort_order"];
    const payload = {};
    for (const f of fields) if (req.body && f in req.body) payload[f] = req.body[f];
    if ("default_amount" in payload) payload.default_amount = Number(payload.default_amount) || 0;
    if ("sort_order" in payload) payload.sort_order = Number(payload.sort_order) || 0;
    await addon.update(payload);
    return res.json({ ok: true, data: addon });
  } catch (error) {
    console.error("[admin/addons PUT]", error);
    return res.status(500).json({ message: "Erro ao atualizar addon", error: error.message });
  }
});

// =====================================================================
// DELETE /admin/addons/:id (apenas se não houver assinaturas ativas)
// =====================================================================
router.delete("/admin/addons/:id", authenticate, adminMiddleware, async (req, res) => {
  try {
    const addon = await Addon.findByPk(req.params.id);
    if (!addon) return res.status(404).json({ message: "Addon não encontrado" });
    const activeCount = await ClientAddon.count({
      where: { addon_id: addon.id, status: "active" },
    });
    if (activeCount > 0) {
      return res.status(400).json({
        message: `Existem ${activeCount} assinaturas ativas para este addon. Desative-o em vez de apagar.`,
      });
    }
    await addon.destroy();
    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin/addons DELETE]", error);
    return res.status(500).json({ message: "Erro ao apagar addon", error: error.message });
  }
});

// =====================================================================
// POST /admin/addons/:id/assign  { client_user_id, amount_override?, status?, next_billing_date? }
// =====================================================================
router.post("/admin/addons/:id/assign", authenticate, adminMiddleware, async (req, res) => {
  try {
    const addon = await Addon.findByPk(req.params.id);
    if (!addon) return res.status(404).json({ message: "Addon não encontrado" });

    const { client_user_id, amount_override, status, next_billing_date, notes } = req.body || {};
    if (!client_user_id) return res.status(400).json({ message: "client_user_id é obrigatório" });

    const client = await Users.findByPk(client_user_id);
    if (!client) return res.status(404).json({ message: "Cliente não encontrado" });

    const [row, created] = await ClientAddon.findOrCreate({
      where: { client_user_id, addon_id: addon.id },
      defaults: {
        addon_key: addon.key,
        status: status || "active",
        amount_override: amount_override != null ? Number(amount_override) : null,
        activated_at: new Date(),
        next_billing_date: next_billing_date ? new Date(next_billing_date) : null,
        notes: notes || null,
      },
    });

    if (!created) {
      const updates = {};
      if (status) updates.status = status;
      if (amount_override !== undefined)
        updates.amount_override = amount_override === null ? null : Number(amount_override);
      if (next_billing_date !== undefined)
        updates.next_billing_date = next_billing_date ? new Date(next_billing_date) : null;
      if (notes !== undefined) updates.notes = notes || null;
      if (status === "active" && !row.activated_at) updates.activated_at = new Date();
      if (status === "cancelled" && !row.cancelled_at) updates.cancelled_at = new Date();
      await row.update(updates);
    }

    return res.status(201).json({ ok: true, data: row, created });
  } catch (error) {
    console.error("[admin/addons assign]", error);
    return res.status(500).json({ message: "Erro ao atribuir addon", error: error.message });
  }
});

// =====================================================================
// DELETE /admin/addons/:id/assign/:clientUserId  (cancela)
// =====================================================================
router.delete(
  "/admin/addons/:id/assign/:clientUserId",
  authenticate,
  adminMiddleware,
  async (req, res) => {
    try {
      const row = await ClientAddon.findOne({
        where: { addon_id: req.params.id, client_user_id: req.params.clientUserId },
      });
      if (!row) return res.status(404).json({ message: "Assinatura não encontrada" });
      await row.update({ status: "cancelled", cancelled_at: new Date() });
      return res.json({ ok: true, data: row });
    } catch (error) {
      console.error("[admin/addons unassign]", error);
      return res.status(500).json({ message: "Erro ao cancelar addon", error: error.message });
    }
  },
);

export default router;
