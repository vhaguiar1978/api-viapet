import AdminAuditLog from "../models/AdminAuditLog.js";
import Users from "../models/Users.js";

/**
 * Middleware que registra ações de admin que MODIFICAM dados (POST/PUT/PATCH/DELETE).
 * Aplica-se às rotas /admin/* exceto leituras.
 *
 * Fire-and-forget: nunca afeta o fluxo da request.
 */

const SKIP_ACTIONS = new Set([
  // não vale a pena logar leituras
]);

export function adminAuditMiddleware(req, res, next) {
  const method = String(req.method || "").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }
  if (!String(req.path || "").startsWith("/admin")) {
    return next();
  }

  // Captura o status final via response interceptor
  const startedAt = Date.now();
  const adminUserId = req.user?.id || null;

  res.on("finish", async () => {
    try {
      // Apenas se a ação foi bem-sucedida (2xx) — falhas ficam no error log
      if (res.statusCode < 200 || res.statusCode >= 400) return;
      // Resolve nome do admin (cache simples)
      let adminName = null;
      if (adminUserId) {
        const user = await Users.findByPk(adminUserId, { attributes: ["name"] });
        adminName = user?.name || null;
      }
      // Inferir action e target a partir do path
      const path = req.originalUrl || req.path || "";
      const segments = path.split("?")[0].split("/").filter(Boolean);
      // /admin/clients/:id/renew-plan → action="renew-plan"; /admin/addons → action="addon-create" etc
      let action = `${method}_${segments.slice(1).join(".")}`.toLowerCase();
      let targetType = null;
      let targetId = null;
      if (segments[1] === "clients" && segments[2]) {
        targetType = "client";
        targetId = segments[2];
        if (segments[3]) action = `client_${segments[3]}`.toLowerCase();
        else if (method === "PUT" || method === "PATCH") action = "client_update";
        else if (method === "DELETE") action = "client_delete";
      } else if (segments[1] === "addons") {
        targetType = "addon";
        if (segments[2]) targetId = segments[2];
        if (method === "POST" && segments.length === 2) action = "addon_create";
        else if (method === "PUT") action = "addon_update";
        else if (method === "DELETE") action = "addon_delete";
        else if (segments[3] === "assign") {
          action = method === "DELETE" ? "addon_unassign" : "addon_assign";
          targetType = "client_addon";
          targetId = segments[4] || segments[2];
        }
      }
      if (SKIP_ACTIONS.has(action)) return;

      const safeBody = sanitizeBody(req.body);

      await AdminAuditLog.create({
        admin_user_id: adminUserId,
        admin_name: adminName,
        action: String(action).slice(0, 60),
        target_type: targetType,
        target_id: targetId ? String(targetId).slice(0, 80) : null,
        target_label: null,
        method,
        path: path.slice(0, 255),
        status_code: res.statusCode,
        metadata_json: safeBody,
        ip: getIp(req),
        user_agent: String(req.headers["user-agent"] || "").slice(0, 255) || null,
        created_at: new Date(),
      });
    } catch (err) {
      console.warn("[adminAudit] falha ao registrar:", err?.message);
    }
  });

  res.on("close", () => {
    // sem ação — só evita warnings
    void startedAt;
  });

  next();
}

function sanitizeBody(body) {
  if (!body || typeof body !== "object") return null;
  const SENSITIVE = /pass|senha|token|secret|cvv|cvc|card|cartao|cartão|pin\b/i;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (v == null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v;
    } else if (Array.isArray(v)) {
      out[k] = `[array(${v.length})]`;
    } else {
      out[k] = "[object]";
    }
  }
  return out;
}

function getIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

export default adminAuditMiddleware;
