import net from "node:net";
import ActivityLog from "../models/ActivityLog.js";
import Users from "../models/Users.js";

// Chaves que NUNCA devem ser persistidas no metadata, mesmo se vierem por engano.
const SENSITIVE_KEY_PATTERNS = [
  /pass(word)?/i,
  /senha/i,
  /token/i,
  /authorization/i,
  /secret/i,
  /api[_-]?key/i,
  /card/i,
  /cartao/i,
  /cartão/i,
  /cvv/i,
  /cvc/i,
  /ccv/i,
  /pin\b/i,
  /\bcvc\b/i,
  /\bcc\b/i,
  /pix[_-]?key/i,
  /chave[_-]?pix/i,
  /private[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
];

function isSensitiveKey(key) {
  if (typeof key !== "string") return false;
  return SENSITIVE_KEY_PATTERNS.some((rx) => rx.test(key));
}

function maskEmail(value) {
  if (typeof value !== "string" || !value.includes("@")) return value;
  const [local, domain] = value.split("@");
  if (local.length <= 2) return `${local[0] || "*"}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(value) {
  if (typeof value !== "string") return value;
  const digits = value.replace(/\D+/g, "");
  if (digits.length < 6) return value;
  const last4 = digits.slice(-4);
  return `***${last4}`;
}

// Trunca strings longas para evitar que mensagens de WhatsApp / corpos privados
// sejam armazenados na íntegra.
function truncateString(value, max = 200) {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function sanitizeMetadata(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return "[depth-limit]";

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = "[redacted]";
        continue;
      }
      if (key === "email" || /\bemail\b/i.test(key)) {
        out[key] = typeof raw === "string" ? maskEmail(raw) : raw;
        continue;
      }
      if (/phone|telefone|celular|whatsapp/i.test(key)) {
        out[key] = typeof raw === "string" ? maskPhone(raw) : raw;
        continue;
      }
      if (/message|mensagem|body|conteudo|conteúdo|texto/i.test(key)) {
        out[key] = typeof raw === "string" ? truncateString(raw, 120) : sanitizeMetadata(raw, depth + 1);
        continue;
      }
      out[key] = sanitizeMetadata(raw, depth + 1);
    }
    return out;
  }

  if (typeof value === "string") {
    return truncateString(value, 500);
  }

  return value;
}

function normalizeIpCandidate(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "undefined" || trimmed.toLowerCase() === "null") {
    return null;
  }
  const normalized = trimmed.startsWith("::ffff:")
    ? trimmed.replace("::ffff:", "")
    : trimmed;
  return net.isIP(normalized) ? normalized : null;
}

function resolveClientIp(req) {
  if (!req) return null;
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const parsed = normalizeIpCandidate(xff.split(",")[0]);
    if (parsed) return parsed;
  }
  return (
    normalizeIpCandidate(req.socket?.remoteAddress) ||
    normalizeIpCandidate(req.connection?.remoteAddress) ||
    null
  );
}

function resolveUserAgent(req) {
  const ua = req?.headers?.["user-agent"];
  if (typeof ua !== "string") return null;
  return ua.slice(0, 255);
}

const userCache = new Map();
async function fetchUserSnapshot(userId) {
  if (!userId) return null;
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const user = await Users.findByPk(userId, {
      attributes: ["id", "name", "email", "establishment", "role"],
    });
    if (!user) {
      userCache.set(userId, { data: null, expiresAt: Date.now() + 60_000 });
      return null;
    }
    const snapshot = {
      id: user.id,
      name: user.name,
      email: user.email,
      establishment: user.establishment,
      role: user.role,
    };
    userCache.set(userId, { data: snapshot, expiresAt: Date.now() + 60_000 });
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Registra um evento na tabela activity_logs.
 *
 * Fire-and-forget: nunca rejeita ou estoura — falhas de log NÃO devem
 * derrubar a request original.
 *
 * Campos esperados em `params`:
 *   - req: express request (opcional, usado para extrair ip/ua/usuário)
 *   - userId, tenantId, nomeUsuario: sobrescrevem o que viria do req
 *   - modulo: string curta (ex.: "agenda", "clientes", "auth")
 *   - acao: string curta (ex.: "appointment_created", "login_success")
 *   - descricao: texto humano (será truncado em 500 chars)
 *   - entidadeTipo, entidadeId: identificação do recurso afetado
 *   - metadata: objeto livre (será sanitizado)
 */
export async function logActivity(params = {}) {
  try {
    const {
      req,
      userId: explicitUserId,
      tenantId: explicitTenantId,
      nomeUsuario: explicitNomeUsuario,
      modulo,
      acao,
      descricao,
      entidadeTipo,
      entidadeId,
      metadata,
    } = params;

    if (!modulo || !acao) {
      return null;
    }

    let userId = explicitUserId ?? req?.user?.id ?? null;
    let tenantId = explicitTenantId ?? req?.user?.establishment ?? null;
    let nomeUsuario = explicitNomeUsuario ?? null;

    if (userId && (!nomeUsuario || !tenantId)) {
      const snapshot = await fetchUserSnapshot(userId);
      if (snapshot) {
        if (!nomeUsuario) nomeUsuario = snapshot.name;
        if (!tenantId) tenantId = snapshot.establishment || snapshot.id;
      }
    }

    const ip = resolveClientIp(req);
    const navegador = resolveUserAgent(req);

    const safeMetadata = metadata != null ? sanitizeMetadata(metadata) : null;
    const safeDescricao =
      typeof descricao === "string" ? truncateString(descricao, 500) : null;

    const safeEntidadeId =
      entidadeId != null ? String(entidadeId).slice(0, 60) : null;

    return await ActivityLog.create({
      tenant_id: tenantId || null,
      user_id: userId || null,
      nome_usuario: nomeUsuario ? String(nomeUsuario).slice(0, 180) : null,
      modulo: String(modulo).slice(0, 60),
      acao: String(acao).slice(0, 80),
      descricao: safeDescricao,
      entidade_tipo: entidadeTipo ? String(entidadeTipo).slice(0, 60) : null,
      entidade_id: safeEntidadeId,
      metadata_json: safeMetadata,
      ip,
      navegador,
      created_at: new Date(),
    });
  } catch (error) {
    console.warn("[activityLogger] falha ao gravar:", error?.message);
    return null;
  }
}

export const _internals = {
  sanitizeMetadata,
  maskEmail,
  maskPhone,
  truncateString,
  isSensitiveKey,
  resolveClientIp,
  resolveUserAgent,
};

export default { logActivity };
