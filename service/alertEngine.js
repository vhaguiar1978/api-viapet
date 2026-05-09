import { Op } from "sequelize";
import AlertRule from "../models/AlertRule.js";
import AlertEvent from "../models/AlertEvent.js";
import Subscription from "../models/Subscription.js";
import Users from "../models/Users.js";
import ActivityLog from "../models/ActivityLog.js";
import addonBilling from "./addonBilling.js";

/**
 * Engine simples de alertas. Cada `kind` tem um avaliador que recebe a regra
 * e devolve `{ triggered, severity, title, message, payload }`.
 *
 * Entrega: por enquanto grava em alert_events (canal in_app). Email/WhatsApp
 * podem ser plugados depois lendo `alert_events.delivery_status='pending'`.
 */

const evaluators = {
  // Cliente em atraso com mensalidade acima de X
  async high_value_overdue(rule) {
    const threshold = Number(rule.config_json?.threshold || 100);
    const list = await addonBilling.inadimplenciaList();
    const offenders = list.items.filter((i) => i.total >= threshold);
    if (!offenders.length) return { triggered: false };
    const total = offenders.reduce((s, o) => s + o.total, 0);
    return {
      triggered: true,
      severity: "warn",
      title: `${offenders.length} cliente(s) em atraso (acima de R$ ${threshold})`,
      message: `Total inadimplente: R$ ${total.toFixed(2)}. Maior: ${offenders[0]?.name || "—"} (R$ ${offenders[0]?.total?.toFixed(2)})`,
      payload: { count: offenders.length, total, sample: offenders.slice(0, 5) },
    };
  },

  // Queda no MRR maior que X% comparado a 30 dias atrás (aproximação)
  async mrr_drop_pct(rule) {
    const pct = Number(rule.config_json?.threshold_pct || 10);
    const series = await addonBilling.revenueMonthlySeries(2);
    if (series.length < 2) return { triggered: false };
    const [previous, current] = series;
    if (previous.total === 0) return { triggered: false };
    const drop = ((previous.total - current.total) / previous.total) * 100;
    if (drop < pct) return { triggered: false };
    return {
      triggered: true,
      severity: "danger",
      title: `Receita caiu ${drop.toFixed(1)}% vs mês anterior`,
      message: `Mês anterior: R$ ${previous.total.toFixed(2)} → atual: R$ ${current.total.toFixed(2)}`,
      payload: { previous, current, dropPct: drop },
    };
  },

  // Cliente cancelou recentemente
  async client_cancelled(rule) {
    const hours = Number(rule.config_json?.windowHours || 48);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const subs = await Subscription.findAll({
      where: { status: "cancelled", updated_at: { [Op.gte]: since } },
      raw: true,
    });
    if (!subs.length) return { triggered: false };
    const userIds = subs.map((s) => s.user_id);
    const users = await Users.findAll({
      where: { id: { [Op.in]: userIds } },
      attributes: ["id", "name", "email"],
      raw: true,
    });
    return {
      triggered: true,
      severity: "warn",
      title: `${subs.length} cancelamento(s) nas últimas ${hours}h`,
      message: users.map((u) => u.name || u.email).join(", "),
      payload: { count: subs.length, users },
    };
  },

  // Nenhum login há N dias
  async no_login_days(rule) {
    const days = Number(rule.config_json?.days || 14);
    const limit = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cold = await Users.findAll({
      where: {
        role: "proprietario",
        [Op.or]: [{ lastAccess: { [Op.lt]: limit } }, { lastAccess: null }],
      },
      attributes: ["id", "name", "email", "lastAccess"],
      raw: true,
      limit: 50,
    });
    if (!cold.length) return { triggered: false };
    return {
      triggered: true,
      severity: "warn",
      title: `${cold.length} cliente(s) sem login há ${days}+ dias`,
      message: cold
        .slice(0, 3)
        .map((u) => u.name || u.email)
        .join(", ") + (cold.length > 3 ? "…" : ""),
      payload: { count: cold.length, sample: cold.slice(0, 10) },
    };
  },

  // Cliente novo (últimos 7 dias) não fez nenhum cadastro
  async new_client_no_data(rule) {
    const recentLimit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newUsers = await Users.findAll({
      where: { role: "proprietario", createdAt: { [Op.gte]: recentLimit } },
      attributes: ["id", "name", "email", "createdAt"],
      raw: true,
    });
    const stale = [];
    for (const u of newUsers) {
      const created = await ActivityLog.count({
        where: {
          user_id: u.id,
          acao: { [Op.in]: ["customer_created", "pet_created", "appointment_created"] },
        },
      });
      if (created === 0) stale.push(u);
    }
    if (!stale.length) return { triggered: false };
    return {
      triggered: true,
      severity: "info",
      title: `${stale.length} cliente(s) novo(s) ainda sem cadastros`,
      message: stale
        .slice(0, 3)
        .map((u) => u.name || u.email)
        .join(", "),
      payload: { count: stale.length, sample: stale.slice(0, 10) },
    };
  },
};

export async function runAlerts() {
  const rules = await AlertRule.findAll({ where: { active: true } });
  const results = [];
  for (const rule of rules) {
    const evaluator = evaluators[rule.kind];
    if (!evaluator) continue;

    let outcome;
    try {
      outcome = await evaluator(rule);
    } catch (err) {
      console.warn(`[alertEngine] erro ao avaliar regra ${rule.id} (${rule.kind}):`, err.message);
      continue;
    }
    await rule.update({ last_check_at: new Date() });
    if (!outcome?.triggered) continue;

    // Cooldown: não dispara o mesmo alerta antes do tempo
    if (rule.last_triggered_at) {
      const since = Date.now() - new Date(rule.last_triggered_at).getTime();
      if (since < (rule.cooldown_hours || 24) * 60 * 60 * 1000) continue;
    }

    const event = await AlertEvent.create({
      rule_id: rule.id,
      rule_name: rule.name,
      kind: rule.kind,
      severity: outcome.severity || "info",
      title: outcome.title,
      message: outcome.message,
      payload_json: outcome.payload || null,
      delivery_status: rule.channel === "in_app" ? "delivered" : "pending",
      delivered_via: rule.channel === "in_app" ? "in_app" : null,
    });
    await rule.update({
      last_triggered_at: new Date(),
      last_payload_json: outcome.payload || null,
    });
    results.push(event);
  }
  return { processed: rules.length, fired: results.length };
}

export const alertKinds = [
  { id: "high_value_overdue", label: "Cliente em atraso (valor alto)" },
  { id: "mrr_drop_pct", label: "Queda de receita mensal" },
  { id: "client_cancelled", label: "Cliente cancelou" },
  { id: "no_login_days", label: "Sem login há X dias" },
  { id: "new_client_no_data", label: "Novo cliente sem cadastros" },
];

export default { runAlerts, alertKinds };
