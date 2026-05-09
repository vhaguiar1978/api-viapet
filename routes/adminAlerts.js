import express from "express";
import authenticate from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import AlertRule from "../models/AlertRule.js";
import AlertEvent from "../models/AlertEvent.js";
import alertEngine from "../service/alertEngine.js";

const router = express.Router();

// CRUD de regras
router.get("/admin/alert-rules", authenticate, adminMiddleware, async (req, res) => {
  try {
    const rules = await AlertRule.findAll({ order: [["created_at", "ASC"]] });
    return res.json({ ok: true, data: rules, kinds: alertEngine.alertKinds });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao listar regras", error: error.message });
  }
});

router.post("/admin/alert-rules", authenticate, adminMiddleware, async (req, res) => {
  try {
    const { name, kind, config_json, channel, recipient, active, cooldown_hours } = req.body || {};
    if (!name || !kind) return res.status(400).json({ message: "Nome e tipo são obrigatórios" });
    const rule = await AlertRule.create({
      name,
      kind,
      config_json: config_json || null,
      channel: channel || "in_app",
      recipient: recipient || null,
      active: active !== false,
      cooldown_hours: Number(cooldown_hours) || 24,
    });
    return res.status(201).json({ ok: true, data: rule });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao criar regra", error: error.message });
  }
});

router.put("/admin/alert-rules/:id", authenticate, adminMiddleware, async (req, res) => {
  try {
    const rule = await AlertRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ message: "Regra não encontrada" });
    const fields = ["name", "kind", "config_json", "channel", "recipient", "active", "cooldown_hours"];
    const payload = {};
    for (const f of fields) if (f in (req.body || {})) payload[f] = req.body[f];
    await rule.update(payload);
    return res.json({ ok: true, data: rule });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao atualizar regra", error: error.message });
  }
});

router.delete("/admin/alert-rules/:id", authenticate, adminMiddleware, async (req, res) => {
  try {
    const rule = await AlertRule.findByPk(req.params.id);
    if (!rule) return res.status(404).json({ message: "Regra não encontrada" });
    await rule.destroy();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao apagar regra", error: error.message });
  }
});

// Eventos disparados
router.get("/admin/alert-events", authenticate, adminMiddleware, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const events = await AlertEvent.findAll({
      order: [["created_at", "DESC"]],
      limit,
    });
    return res.json({ ok: true, data: events });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao listar eventos", error: error.message });
  }
});

router.post("/admin/alert-events/:id/ack", authenticate, adminMiddleware, async (req, res) => {
  try {
    const event = await AlertEvent.findByPk(req.params.id);
    if (!event) return res.status(404).json({ message: "Evento não encontrado" });
    await event.update({ acknowledged_at: new Date() });
    return res.json({ ok: true, data: event });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao confirmar evento", error: error.message });
  }
});

// Roda manualmente o engine (botão "Verificar agora" no admin)
router.post("/admin/alert-rules/run", authenticate, adminMiddleware, async (_req, res) => {
  try {
    const result = await alertEngine.runAlerts();
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao rodar engine", error: error.message });
  }
});

export default router;
