import { Op, fn, col, literal } from "sequelize";
import sequelize from "../database/config.js";
import Subscription from "../models/Subscription.js";
import PaymentHistory from "../models/PaymentHistory.js";
import ClientAddon from "../models/ClientAddon.js";
import Addon from "../models/Addon.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";
import Users from "../models/Users.js";

/**
 * Camada de agregação financeira.
 *
 * Fontes consideradas:
 *   - Subscription          → ViaPet base (mensalidade do sistema)
 *   - ClientAddon (status active) → addons genéricos (IA CRM e futuros)
 *   - CrmAiSubscription     → fallback de IA CRM enquanto não migrarmos os
 *                             registros antigos para client_addons
 *   - PaymentHistory        → receita realizada (status approved)
 */

const ACTIVE_STATUSES = ["active", "trial"];

function startOfMonth(reference = new Date()) {
  const dt = new Date(reference);
  dt.setUTCDate(1);
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}

function endOfMonth(reference = new Date()) {
  const dt = startOfMonth(reference);
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCMilliseconds(-1);
  return dt;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * MRR (Monthly Recurring Revenue) decomposto em base + addons.
 * Conta apenas assinaturas com status "active" (ignora trial, cancelled).
 */
export async function computeMRR() {
  const baseRows = await Subscription.findAll({
    attributes: [[fn("SUM", col("amount")), "total"]],
    where: { status: "active", plan_type: { [Op.in]: ["monthly", "promotional"] } },
    raw: true,
  });
  const baseMRR = asNumber(baseRows?.[0]?.total);

  // Addons via tabela genérica
  const addonRows = await ClientAddon.findAll({
    attributes: [
      "addon_key",
      [fn("COUNT", col("ClientAddon.id")), "count"],
      [fn("SUM", literal('COALESCE("ClientAddon"."amount_override", "addon"."default_amount")')), "total"],
    ],
    where: { status: "active" },
    include: [{ model: Addon, as: "addon", attributes: [] }],
    group: ["addon_key"],
    raw: true,
  });

  // Fallback: IA CRM legado (CrmAiSubscription) — só conta o que não tem
  // contrapartida em client_addons para o mesmo user.
  // IMPORTANTE: exclui cortesias (manual_free, manual_trial, free) — esses nao
  // geram receita recorrente, mesmo que tenham amount > 0 por historico.
  const legacyIaActive = await CrmAiSubscription.findAll({
    where: {
      status: "active",
      payment_status: { [Op.notIn]: ["manual_free", "manual_trial", "free"] },
      amount: { [Op.gt]: 0 },
    },
    attributes: ["user_id", "amount"],
    raw: true,
  });
  const legacyOverlapUserIds = await ClientAddon.findAll({
    where: { addon_key: "ia_crm", status: "active" },
    attributes: ["client_user_id"],
    raw: true,
  });
  const overlapSet = new Set(legacyOverlapUserIds.map((r) => r.client_user_id));
  const legacyIaUnique = legacyIaActive.filter((r) => !overlapSet.has(r.user_id));
  const legacyIaTotal = legacyIaUnique.reduce((sum, r) => sum + asNumber(r.amount), 0);

  const breakdown = addonRows.map((row) => ({
    addon_key: row.addon_key,
    count: Number(row.count) || 0,
    mrr: asNumber(row.total),
  }));

  // Mescla legado de IA CRM
  if (legacyIaUnique.length > 0) {
    const existing = breakdown.find((b) => b.addon_key === "ia_crm");
    if (existing) {
      existing.count += legacyIaUnique.length;
      existing.mrr += legacyIaTotal;
    } else {
      breakdown.push({
        addon_key: "ia_crm",
        count: legacyIaUnique.length,
        mrr: legacyIaTotal,
      });
    }
  }

  const addonsTotal = breakdown.reduce((sum, b) => sum + b.mrr, 0);

  return {
    base: baseMRR,
    addons: addonsTotal,
    total: baseMRR + addonsTotal,
    breakdown,
  };
}

/**
 * Receita realizada (paga) no período.
 * Usa PaymentHistory.status='approved' e date_approved no range.
 */
export async function revenueForPeriod({ from, to } = {}) {
  const startDt = from ? new Date(from) : startOfMonth();
  const endDt = to ? new Date(to) : endOfMonth();

  const rows = await PaymentHistory.findAll({
    attributes: [
      [fn("COUNT", col("id")), "count"],
      [fn("SUM", col("amount")), "total"],
    ],
    where: {
      status: "approved",
      date_approved: { [Op.gte]: startDt, [Op.lte]: endDt },
    },
    raw: true,
  });

  return {
    from: startDt,
    to: endDt,
    count: Number(rows?.[0]?.count) || 0,
    total: asNumber(rows?.[0]?.total),
  };
}

/**
 * Série temporal de receita realizada nos últimos N meses (default 12).
 * Retorna [{ year, month, label, total, count }].
 */
export async function revenueMonthlySeries(months = 12) {
  const series = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const start = startOfMonth(ref);
    const end = endOfMonth(ref);
    const row = await PaymentHistory.findOne({
      attributes: [
        [fn("COUNT", col("id")), "count"],
        [fn("SUM", col("amount")), "total"],
      ],
      where: {
        status: "approved",
        date_approved: { [Op.gte]: start, [Op.lte]: end },
      },
      raw: true,
    });
    series.push({
      year: start.getUTCFullYear(),
      month: start.getUTCMonth() + 1,
      label: `${String(start.getUTCMonth() + 1).padStart(2, "0")}/${start.getUTCFullYear()}`,
      total: asNumber(row?.total),
      count: Number(row?.count) || 0,
    });
  }
  return series;
}

/**
 * Lista de inadimplência: clientes com Subscription.next_billing_date < hoje
 * e status active (ainda devem pagar) — combinada com addons em status overdue
 * ou com next_billing_date < hoje.
 */
export async function inadimplenciaList() {
  const now = new Date();

  const overdueSubs = await Subscription.findAll({
    where: {
      status: "active",
      next_billing_date: { [Op.lt]: now },
    },
    raw: true,
  });

  const overdueAddons = await ClientAddon.findAll({
    where: {
      [Op.or]: [
        { status: "overdue" },
        { status: "active", next_billing_date: { [Op.lt]: now } },
      ],
    },
    include: [{ model: Addon, as: "addon", attributes: ["key", "name", "default_amount"] }],
    raw: false,
  });

  const userIds = [
    ...new Set([
      ...overdueSubs.map((s) => s.user_id),
      ...overdueAddons.map((a) => a.client_user_id),
    ]),
  ];

  const usersById = new Map();
  if (userIds.length > 0) {
    const users = await Users.findAll({
      where: { id: { [Op.in]: userIds } },
      attributes: ["id", "name", "email", "phone"],
      raw: true,
    });
    users.forEach((u) => usersById.set(u.id, u));
  }

  const items = userIds.map((userId) => {
    const user = usersById.get(userId);
    const subs = overdueSubs.filter((s) => s.user_id === userId);
    const addons = overdueAddons.filter((a) => a.client_user_id === userId);
    const baseAmount = subs.reduce((sum, s) => sum + asNumber(s.amount), 0);
    const addonsAmount = addons.reduce(
      (sum, a) => sum + asNumber(a.amount_override ?? a.addon?.default_amount),
      0,
    );
    const dueDates = [
      ...subs.map((s) => s.next_billing_date),
      ...addons.map((a) => a.next_billing_date),
    ].filter(Boolean);
    const oldestDue = dueDates.length
      ? new Date(Math.min(...dueDates.map((d) => new Date(d).getTime())))
      : null;
    return {
      user_id: userId,
      name: user?.name || null,
      email: user?.email || null,
      phone: user?.phone || null,
      baseAmount,
      addonsAmount,
      total: baseAmount + addonsAmount,
      oldestDue,
      itemCount: subs.length + addons.length,
    };
  });

  // Ordena por mais antigo vencido primeiro
  items.sort((a, b) => {
    if (!a.oldestDue) return 1;
    if (!b.oldestDue) return -1;
    return a.oldestDue.getTime() - b.oldestDue.getTime();
  });

  const total = items.reduce((sum, i) => sum + i.total, 0);
  return { items, total, count: items.length };
}

/**
 * Forecast 90 dias: separa "garantido" (assinatura active com next_billing_date
 * dentro do período) de "em risco" (status pending, suspended ou
 * overdue, etc.).
 */
export async function forecast90Days() {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 90);

  const activeSubs = await Subscription.findAll({
    where: {
      status: "active",
      next_billing_date: { [Op.between]: [now, horizon] },
    },
    raw: true,
  });
  const riskSubs = await Subscription.findAll({
    where: {
      status: { [Op.in]: ["pending", "suspended", "expired"] },
      next_billing_date: { [Op.between]: [now, horizon] },
    },
    raw: true,
  });

  const activeAddons = await ClientAddon.findAll({
    where: {
      status: "active",
      next_billing_date: { [Op.between]: [now, horizon] },
    },
    include: [{ model: Addon, as: "addon", attributes: ["default_amount"] }],
  });
  const riskAddons = await ClientAddon.findAll({
    where: {
      status: { [Op.in]: ["suspended", "overdue"] },
      next_billing_date: { [Op.between]: [now, horizon] },
    },
    include: [{ model: Addon, as: "addon", attributes: ["default_amount"] }],
  });

  const sumSubs = (rows) => rows.reduce((s, r) => s + asNumber(r.amount), 0);
  const sumAddons = (rows) =>
    rows.reduce((s, r) => s + asNumber(r.amount_override ?? r.addon?.default_amount), 0);

  return {
    horizonDays: 90,
    guaranteed: {
      base: sumSubs(activeSubs),
      addons: sumAddons(activeAddons),
      total: sumSubs(activeSubs) + sumAddons(activeAddons),
      count: activeSubs.length + activeAddons.length,
    },
    atRisk: {
      base: sumSubs(riskSubs),
      addons: sumAddons(riskAddons),
      total: sumSubs(riskSubs) + sumAddons(riskAddons),
      count: riskSubs.length + riskAddons.length,
    },
  };
}

/**
 * Lifetime Value (LTV) médio: soma total dos pagamentos approved por usuário
 * ÷ número de usuários que algum dia pagaram. Aproximação simples e estável.
 */
export async function ltvAverage() {
  const rows = await PaymentHistory.findAll({
    attributes: [
      "user_id",
      [fn("SUM", col("amount")), "total"],
    ],
    where: { status: "approved" },
    group: ["user_id"],
    raw: true,
  });
  if (!rows.length) return { ltv: 0, payingUsers: 0 };
  const totals = rows.map((r) => asNumber(r.total));
  const sum = totals.reduce((a, b) => a + b, 0);
  return {
    ltv: sum / totals.length,
    payingUsers: totals.length,
  };
}

/**
 * Cohort: usuários por mês de cadastro × quantos ainda pagam ativamente hoje.
 */
export async function cohortByMonth(months = 6) {
  const now = new Date();
  const cohorts = [];
  for (let i = months - 1; i >= 0; i--) {
    const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const start = startOfMonth(ref);
    const end = endOfMonth(ref);

    const usersInCohort = await Users.findAll({
      where: { createdAt: { [Op.gte]: start, [Op.lte]: end } },
      attributes: ["id"],
      raw: true,
    });
    const userIds = usersInCohort.map((u) => u.id);
    let stillActive = 0;
    if (userIds.length > 0) {
      stillActive = await Subscription.count({
        where: {
          user_id: { [Op.in]: userIds },
          status: "active",
          plan_type: { [Op.in]: ["monthly", "promotional"] },
        },
      });
    }
    cohorts.push({
      label: `${String(start.getUTCMonth() + 1).padStart(2, "0")}/${start.getUTCFullYear()}`,
      year: start.getUTCFullYear(),
      month: start.getUTCMonth() + 1,
      total: userIds.length,
      stillActive,
      retention: userIds.length ? stillActive / userIds.length : 0,
    });
  }
  return cohorts;
}

/**
 * Resumo financeiro consolidado para a tela /admin/financeiro.
 */
export async function financialSnapshot({ month } = {}) {
  const reference = month ? new Date(`${month}-01T00:00:00Z`) : new Date();
  const periodFrom = startOfMonth(reference);
  const periodTo = endOfMonth(reference);

  const [mrr, received, inadimplencia, forecast, series, ltv, cohorts] = await Promise.all([
    computeMRR(),
    revenueForPeriod({ from: periodFrom, to: periodTo }),
    inadimplenciaList(),
    forecast90Days(),
    revenueMonthlySeries(12),
    ltvAverage(),
    cohortByMonth(6),
  ]);

  // Contagem de usuários ativos (pagantes vs trial)
  const activePaying = await Subscription.count({
    where: { status: "active", plan_type: { [Op.in]: ["monthly", "promotional"] } },
  });
  const activeTrial = await Subscription.count({
    where: { status: "active", plan_type: "trial" },
  });

  return {
    period: {
      label: `${String(periodFrom.getUTCMonth() + 1).padStart(2, "0")}/${periodFrom.getUTCFullYear()}`,
      from: periodFrom,
      to: periodTo,
    },
    activeUsers: { paying: activePaying, trial: activeTrial, total: activePaying + activeTrial },
    mrr,
    received,
    inadimplencia: { total: inadimplencia.total, count: inadimplencia.count },
    forecast,
    series,
    ltv,
    cohorts,
  };
}

export default {
  computeMRR,
  revenueForPeriod,
  revenueMonthlySeries,
  inadimplenciaList,
  forecast90Days,
  ltvAverage,
  cohortByMonth,
  financialSnapshot,
};
