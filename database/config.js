import { Sequelize } from "sequelize";
import dns from "dns";
import "../config/env.js";

function firstValidEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (Boolean(value) && value !== "undefined" && value !== "null") {
      return value;
    }
  }
  return undefined;
}

// Força IPv4 para evitar ENETUNREACH em ambientes como Render + Supabase.
// Usamos APENAS setDefaultResultOrder — sem override global de dns.lookup
// pois o override causava "Invalid IP address: undefined" quando o pg/sequelize
// chamava dns.lookup internamente com hostname undefined em situações de erro.
if (typeof dns.setDefaultResultOrder === "function") {
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch (_error) {
    // noop — Node < 17 não tem essa função
  }
}

const isDevelopment = process.env.NODE_ENV === "development";

function isValidEnvString(val) {
  return Boolean(val) && val !== "undefined" && val !== "null";
}

const resolvedEnvDatabaseUrl = firstValidEnv(
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_DB_URL",
);

const hasDatabaseUrl = isValidEnvString(resolvedEnvDatabaseUrl);

/**
 * Normaliza a DATABASE_URL para o pooler do Supabase.
 *
 * Corrige dois problemas comuns de configuração no Render/produção:
 *
 * 1. Senha com @@ não encodada:
 *    Quando o usuário digita postgres:Ale202320@@db.xxx.supabase.co no painel,
 *    o URL parser trata o último @ como separador, perdendo um @ da senha.
 *    Detectamos o padrão @@<host-supabase> e reescrevemos com encode correto.
 *
 * 2. Host direto (db.*.supabase.co) → pooler:
 *    O host direto falha frequentemente por IPv6/DNS no Render.
 *    Convertemos para aws-1-us-east-1.pooler.supabase.com.
 */
function normalizeDatabaseUrl(rawUrl) {
  if (!rawUrl) return rawUrl;

  let urlToProcess = rawUrl;

  // ── Passo 1: detecta e corrige @@ não encodado para host direto Supabase ──
  // Ex.: postgresql://postgres:Ale202320@@db.PROJECT.supabase.co:5432/postgres
  // O regex captura tudo antes de @@ como a senha (sem o @ final que foi perdido).
  const supabaseDoubleAt = rawUrl.match(
    /^(postgresql|postgres):\/\/([^:@]+):(.+?)@@(db\.[^/?#]+\.supabase\.co(?::\d+)?)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i,
  );

  if (supabaseDoubleAt) {
    const [, proto, user, passRaw, host, path = "/postgres", search = "", hash = ""] =
      supabaseDoubleAt;
    // passRaw não contém o @ final que foi "consumido" como separador de URL.
    // A senha real era passRaw + '@' (um @ — o segundo @ estava como separador).
    const realPass = passRaw + "@";
    const encodedPass = encodeURIComponent(realPass);
    urlToProcess = `${proto}://${user}:${encodedPass}@${host}${path}${search}${hash}`;
    console.log("[db] URL com @@ detectado — password recodificado corretamente");
  }

  // ── Passo 2: converte host direto → pooler ────────────────────────────────
  try {
    const parsed = new URL(urlToProcess);
    const hostname = (parsed.hostname || "").toLowerCase();

    if (hostname.startsWith("db.") && hostname.endsWith(".supabase.co")) {
      const projectRef = hostname
        .replace(/^db\./, "")
        .replace(/\.supabase\.co$/, "");

      const envPoolerHost = process.env.SUPABASE_POOLER_HOST;
      const poolerHost = isValidEnvString(envPoolerHost)
        ? envPoolerHost
        : "aws-1-us-east-1.pooler.supabase.com";

      parsed.hostname = poolerHost;

      // Pooler exige username no formato postgres.PROJECT_REF
      if (parsed.username === "postgres" && projectRef) {
        parsed.username = `postgres.${projectRef}`;
      }

      console.log(`[db] Host direto convertido para pooler: ${poolerHost}`);
    }

    return parsed.toString();
  } catch (err) {
    console.error("[db] Falha ao normalizar DATABASE_URL:", err.message);
    return rawUrl;
  }
}

const dbConfig = {
  database: firstValidEnv("DB_NAME", "PGDATABASE", "POSTGRES_DATABASE"),
  username: firstValidEnv("DB_USER", "PGUSER", "POSTGRES_USER"),
  password: firstValidEnv("DB_PASS", "PGPASSWORD", "POSTGRES_PASSWORD"),
  host: isDevelopment
    ? (firstValidEnv("DB_HOST", "PGHOST", "POSTGRES_HOST") || "localhost")
    : firstValidEnv("DB_HOST", "PGHOST", "POSTGRES_HOST"),
  port: firstValidEnv("DB_PORT", "PGPORT", "POSTGRES_PORT") || 5432,
  dialect: process.env.DB_DIALECT || (hasDatabaseUrl ? "postgres" : "mysql"),
  logging: isDevelopment ? console.log : false,
  timezone: "-03:00",
};

const sharedOptions = {
  dialect: dbConfig.dialect,
  logging: dbConfig.logging,
  retry: {
    max: 5,
    match: [
      /ETIMEDOUT/i,
      /ECONNRESET/i,
      /ENETUNREACH/i,
      /ENOTFOUND/i,
      /SequelizeConnectionError/i,
    ],
  },
  ...(dbConfig.dialect === "mysql" ? { timezone: dbConfig.timezone } : {}),
  ...(dbConfig.dialect === "postgres"
    ? {
        dialectOptions: {
          keepAlive: true,
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        },
        pool: {
          max: 10,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
      }
    : {}),
};

const resolvedDatabaseUrl = hasDatabaseUrl
  ? normalizeDatabaseUrl(resolvedEnvDatabaseUrl)
  : null;

if (resolvedDatabaseUrl) {
  try {
    const { hostname, port } = new URL(resolvedDatabaseUrl);
    console.log(`[db] Conectando via DATABASE_URL → ${hostname}:${port || 5432}`);
  } catch {
    console.log("[db] Conectando via DATABASE_URL");
  }
} else {
  console.log(`[db] Conectando via host: ${dbConfig.host}:${dbConfig.port}`);
}

const sequelize = resolvedDatabaseUrl
  ? new Sequelize(resolvedDatabaseUrl, sharedOptions)
  : new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
      host: dbConfig.host,
      port: dbConfig.port,
      ...sharedOptions,
    });

export default sequelize;
