import express from "express";
import { Op, fn, col, literal } from "sequelize";
import authenticate from "../middlewares/auth.js";
import sequelize from "../database/config.js";
import ActivityLog from "../models/ActivityLog.js";
import Users from "../models/Users.js";

const router = express.Router();

/**
 * Acesso à área "Movimentação dos Usuários":
 *   - role==='admin'           → vê todas as empresas (pode filtrar por tenantId)
 *   - role==='proprietario'    → vê apenas o próprio establishment
 *   - role==='funcionario'     → bloqueado (não é gerencial)
 */
function activityAccess(req, res, next) {
  const role = req.user?.role;
  if (role !== "admin" && role !== "proprietario") {
    return res.status(403).json({ message: "Acesso restrito a administradores ou proprietários." });
  }
  next();
}

function resolveTenantScope(req) {
  const role = req.user?.role;
  if (role === "admin") {
    const explicit = req.query?.tenantId || req.query?.empresaId;
    return explicit ? { tenant_id: explicit } : null; // null = sem filtro de tenant
  }
  // proprietario só vê o próprio tenant
  return { tenant_id: req.user.establishment || req.user.id };
}

function parseDateRange(req) {
  const { startDate, endDate, days } = req.query || {};
  const where = {};
  if (startDate) {
    const dt = new Date(startDate);
    if (!isNaN(dt.getTime())) where[Op.gte] = dt;
  }
  if (endDate) {
    const dt = new Date(endDate);
    if (!isNaN(dt.getTime())) {
      // inclui o dia inteiro
      dt.setHours(23, 59, 59, 999);
      where[Op.lte] = dt;
    }
  }
  if (Object.keys(where).length === 0 && days) {
    const n = Number(days);
    if (Number.isFinite(n) && n > 0 && n <= 365) {
      const since = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
      where[Op.gte] = since;
    }
  }
  return Object.keys(where).length ? where : null;
}

function buildBaseWhere(req) {
  const where = {};
  const tenantScope = resolveTenantScope(req);
  if (tenantScope) Object.assign(where, tenantScope);

  const dateRange = parseDateRange(req);
  if (dateRange) where.created_at = dateRange;

  if (req.query?.userId) where.user_id = req.query.userId;
  if (req.query?.modulo) where.modulo = req.query.modulo;
  if (req.query?.acao) where.acao = req.query.acao;

  return where;
}

// =====================================================================
// GET /admin/user-activity/dashboard
// Cards principais — agregações de alta cardinalidade já filtradas por tenant
// =====================================================================
router.get("/admin/user-activity/dashboard", authenticate, activityAccess, async (req, res) => {
  try {
    const baseWhere = buildBaseWhere(req);
    const { tenant_id } = baseWhere;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day3 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const day7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const day15 = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

    // Usuários ativos hoje (distintos user_id)
    const activeTodayRows = await ActivityLog.findAll({
      attributes: [[fn("DISTINCT", col("user_id")), "user_id"]],
      where: {
        ...(tenant_id ? { tenant_id } : {}),
        created_at: { [Op.gte]: today },
        user_id: { [Op.not]: null },
      },
      raw: true,
    });
    const activeTodayCount = activeTodayRows.length;

    // Usuários do tenant (para calcular "sem acesso há X dias")
    const userScope = tenant_id
      ? { [Op.or]: [{ id: tenant_id }, { establishment: tenant_id }] }
      : {};
    const tenantUsers = await Users.findAll({
      where: userScope,
      attributes: ["id", "name", "email", "lastAccess", "establishment"],
    });

    const inactiveCounts = { d3: 0, d7: 0, d15: 0 };
    const inactiveLists = { d3: [], d7: [], d15: [] };
    for (const u of tenantUsers) {
      const last = u.lastAccess ? new Date(u.lastAccess) : null;
      if (!last) {
        inactiveCounts.d15 += 1;
        inactiveLists.d15.push({ id: u.id, name: u.name, email: u.email, lastAccess: null });
        continue;
      }
      if (last < day15) {
        inactiveCounts.d15 += 1;
        inactiveLists.d15.push({ id: u.id, name: u.name, email: u.email, lastAccess: last });
      } else if (last < day7) {
        inactiveCounts.d7 += 1;
        inactiveLists.d7.push({ id: u.id, name: u.name, email: u.email, lastAccess: last });
      } else if (last < day3) {
        inactiveCounts.d3 += 1;
        inactiveLists.d3.push({ id: u.id, name: u.name, email: u.email, lastAccess: last });
      }
    }

    // Telas mais acessadas (top 10)
    const topPages = await ActivityLog.findAll({
      attributes: [
        "entidade_id",
        [fn("COUNT", col("id")), "total"],
      ],
      where: {
        ...baseWhere,
        modulo: "navegacao",
        acao: "page_view",
        entidade_id: { [Op.not]: null },
      },
      group: ["entidade_id"],
      order: [[literal("total"), "DESC"]],
      limit: 10,
      raw: true,
    });

    // Ações mais usadas (top 10) — exclui page_view para não dominar
    const topActions = await ActivityLog.findAll({
      attributes: [
        "modulo",
        "acao",
        [fn("COUNT", col("id")), "total"],
      ],
      where: {
        ...baseWhere,
        acao: { [Op.notIn]: ["page_view"] },
      },
      group: ["modulo", "acao"],
      order: [[literal("total"), "DESC"]],
      limit: 10,
      raw: true,
    });

    // Erros recentes (últimos 20)
    const recentErrors = await ActivityLog.findAll({
      where: {
        ...baseWhere,
        acao: { [Op.in]: ["server_error", "client_error", "save_error"] },
      },
      order: [["created_at", "DESC"]],
      limit: 20,
    });

    return res.json({
      ok: true,
      data: {
        activeToday: activeTodayCount,
        inactive: inactiveCounts,
        inactiveLists,
        topPages,
        topActions,
        recentErrors,
      },
    });
  } catch (error) {
    console.error("[user-activity/dashboard]", error);
    return res.status(500).json({ message: "Erro ao montar dashboard", error: error.message });
  }
});

// =====================================================================
// GET /admin/user-activity/users
// Lista usuários do tenant com último acesso e contagem de eventos
// =====================================================================
router.get("/admin/user-activity/users", authenticate, activityAccess, async (req, res) => {
  try {
    const tenantScope = resolveTenantScope(req);
    const tenant_id = tenantScope?.tenant_id;

    const userScope = tenant_id
      ? { [Op.or]: [{ id: tenant_id }, { establishment: tenant_id }] }
      : {};

    const users = await Users.findAll({
      where: userScope,
      attributes: ["id", "name", "email", "role", "establishment", "lastAccess", "createdAt"],
      order: [[literal('"lastAccess" DESC NULLS LAST')]],
    });

    // Contagem de eventos por usuário no período
    const dateRange = parseDateRange(req) || { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    const userIds = users.map((u) => u.id);
    const counts = userIds.length
      ? await ActivityLog.findAll({
          attributes: ["user_id", [fn("COUNT", col("id")), "total"]],
          where: {
            user_id: { [Op.in]: userIds },
            created_at: dateRange,
          },
          group: ["user_id"],
          raw: true,
        })
      : [];
    const countMap = new Map(counts.map((c) => [c.user_id, Number(c.total)]));

    return res.json({
      ok: true,
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        establishment: u.establishment,
        lastAccess: u.lastAccess,
        createdAt: u.createdAt,
        eventsInPeriod: countMap.get(u.id) || 0,
      })),
    });
  } catch (error) {
    console.error("[user-activity/users]", error);
    return res.status(500).json({ message: "Erro ao listar usuários", error: error.message });
  }
});

// =====================================================================
// GET /admin/user-activity/users/:userId/timeline
// Linha do tempo de um usuário específico (paginada)
// =====================================================================
router.get(
  "/admin/user-activity/users/:userId/timeline",
  authenticate,
  activityAccess,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const tenantScope = resolveTenantScope(req);

      // Garante que o proprietario só veja usuarios do proprio tenant
      if (tenantScope?.tenant_id) {
        const target = await Users.findByPk(userId, { attributes: ["id", "establishment"] });
        if (!target) return res.status(404).json({ message: "Usuário não encontrado" });
        const targetTenant = target.establishment || target.id;
        if (targetTenant !== tenantScope.tenant_id) {
          return res.status(403).json({ message: "Sem permissão para acessar este usuário" });
        }
      }

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const where = { user_id: userId };
      const dateRange = parseDateRange(req);
      if (dateRange) where.created_at = dateRange;
      if (req.query?.modulo) where.modulo = req.query.modulo;

      const { rows, count } = await ActivityLog.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit,
        offset,
      });

      const user = await Users.findByPk(userId, {
        attributes: ["id", "name", "email", "role", "lastAccess", "createdAt"],
      });

      return res.json({
        ok: true,
        data: { user, total: count, items: rows, limit, offset },
      });
    } catch (error) {
      console.error("[user-activity/timeline]", error);
      return res.status(500).json({ message: "Erro ao montar timeline", error: error.message });
    }
  },
);

// =====================================================================
// GET /admin/user-activity/logs
// Lista paginada de logs com filtros (data, usuário, módulo, ação, empresa)
// =====================================================================
router.get("/admin/user-activity/logs", authenticate, activityAccess, async (req, res) => {
  try {
    const where = buildBaseWhere(req);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows, count } = await ActivityLog.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    return res.json({
      ok: true,
      data: { total: count, items: rows, limit, offset },
    });
  } catch (error) {
    console.error("[user-activity/logs]", error);
    return res.status(500).json({ message: "Erro ao listar logs", error: error.message });
  }
});

// =====================================================================
// GET /admin/user-activity/alerts
// Alertas automáticos do spec
// =====================================================================
router.get("/admin/user-activity/alerts", authenticate, activityAccess, async (req, res) => {
  try {
    const tenantScope = resolveTenantScope(req);
    const tenant_id = tenantScope?.tenant_id;
    const baseTenantWhere = tenant_id ? { tenant_id } : {};

    const day3 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const day7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1) Usuário novo que entrou e não cadastrou nada
    //    — criado nos últimos 7 dias, fez login, mas não tem customer_created/pet_created/appointment_created
    const userScope = tenant_id
      ? { [Op.or]: [{ id: tenant_id }, { establishment: tenant_id }] }
      : {};
    const recentUsers = await Users.findAll({
      where: { ...userScope, createdAt: { [Op.gte]: day7 } },
      attributes: ["id", "name", "email", "createdAt", "lastAccess"],
    });
    const newUsersWithoutData = [];
    for (const u of recentUsers) {
      const created = await ActivityLog.count({
        where: {
          user_id: u.id,
          acao: { [Op.in]: ["customer_created", "pet_created", "appointment_created"] },
        },
      });
      if (created === 0) {
        newUsersWithoutData.push({
          userId: u.id,
          name: u.name,
          email: u.email,
          createdAt: u.createdAt,
          lastAccess: u.lastAccess,
        });
      }
    }

    // 2) Usuário que tentou usar agenda e saiu
    //    — visitou tela de agenda nos últimos 24h mas NÃO criou agendamento
    const agendaViews = await ActivityLog.findAll({
      attributes: [[fn("DISTINCT", col("user_id")), "user_id"]],
      where: {
        ...baseTenantWhere,
        modulo: "navegacao",
        acao: "page_view",
        entidade_id: { [Op.like]: "%agenda%" },
        created_at: { [Op.gte]: last24h },
        user_id: { [Op.not]: null },
      },
      raw: true,
    });
    const stuckOnAgenda = [];
    for (const row of agendaViews) {
      const created = await ActivityLog.count({
        where: {
          user_id: row.user_id,
          acao: "appointment_created",
          created_at: { [Op.gte]: last24h },
        },
      });
      if (created === 0) {
        const u = await Users.findByPk(row.user_id, { attributes: ["id", "name", "email"] });
        if (u) stuckOnAgenda.push({ userId: u.id, name: u.name, email: u.email });
      }
    }

    // 3) Usuário que não acessa há vários dias (>7d)
    const inactiveUsers = await Users.findAll({
      where: {
        ...userScope,
        [Op.or]: [
          { lastAccess: { [Op.lt]: day7 } },
          { lastAccess: null },
        ],
      },
      attributes: ["id", "name", "email", "lastAccess"],
      limit: 50,
    });

    // 4) Erro repetido em alguma tela (>=3 erros de mesma tela em 24h)
    const repeatedErrors = await ActivityLog.findAll({
      attributes: [
        "entidade_id",
        "descricao",
        [fn("COUNT", col("id")), "total"],
      ],
      where: {
        ...baseTenantWhere,
        acao: { [Op.in]: ["save_error", "client_error", "server_error"] },
        created_at: { [Op.gte]: last24h },
      },
      group: ["entidade_id", "descricao"],
      having: literal("COUNT(id) >= 3"),
      order: [[literal("total"), "DESC"]],
      limit: 20,
      raw: true,
    });

    return res.json({
      ok: true,
      data: {
        newUsersWithoutData,
        stuckOnAgenda,
        inactiveUsers,
        repeatedErrors,
      },
    });
  } catch (error) {
    console.error("[user-activity/alerts]", error);
    return res.status(500).json({ message: "Erro ao montar alertas", error: error.message });
  }
});

// =====================================================================
// GET /admin/user-activity/filters
// Devolve listas auxiliares para popular os filtros do frontend (módulos, ações)
// =====================================================================
router.get("/admin/user-activity/filters", authenticate, activityAccess, async (req, res) => {
  try {
    const tenantScope = resolveTenantScope(req);
    const where = tenantScope || {};

    const modulos = await ActivityLog.findAll({
      attributes: [[fn("DISTINCT", col("modulo")), "modulo"]],
      where,
      raw: true,
    });
    const acoes = await ActivityLog.findAll({
      attributes: [[fn("DISTINCT", col("acao")), "acao"]],
      where,
      raw: true,
    });

    return res.json({
      ok: true,
      data: {
        modulos: modulos.map((r) => r.modulo).filter(Boolean).sort(),
        acoes: acoes.map((r) => r.acao).filter(Boolean).sort(),
      },
    });
  } catch (error) {
    console.error("[user-activity/filters]", error);
    return res.status(500).json({ message: "Erro ao listar filtros", error: error.message });
  }
});

export default router;
