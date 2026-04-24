import { Sequelize } from "sequelize";
import dns from "dns";
import "../config/env.js";

// Render + Supabase podem retornar IPv6 primeiro; forçamos IPv4 para evitar ENETUNREACH.
if (typeof dns.setDefaultResultOrder === "function") {
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch (_error) {
    // noop
  }
}

const originalLookup = dns.lookup.bind(dns);
dns.lookup = function forceIpv4Lookup(hostname, options, callback) {
  let resolvedOptions = options;
  let resolvedCallback = callback;

  if (typeof resolvedOptions === "function") {
    resolvedCallback = resolvedOptions;
    resolvedOptions = {};
  }

  if (typeof resolvedOptions === "number") {
    resolvedOptions = { family: resolvedOptions };
  }

  // Guard against invalid hostnames (e.g. "undefined" string when env var is missing)
  if (!hostname || hostname === "undefined" || hostname === "null") {
    const err = Object.assign(new Error(`Invalid IP address: ${hostname}`), {
      code: "ERR_INVALID_IP_ADDRESS",
    });
    if (typeof resolvedCallback === "function") {
      return process.nextTick(() => resolvedCallback(err));
    }
    throw err;
  }

  const normalizedOptions = { ...(resolvedOptions || {}) };
  if (!normalizedOptions.family || normalizedOptions.family === 6) {
    normalizedOptions.family = 4;
  }
  normalizedOptions.all = false;

  return originalLookup(hostname, normalizedOptions, resolvedCallback);
};

const isDevelopment = process.env.NODE_ENV === "development";
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

function normalizeDatabaseUrl(rawUrl) {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const hostname = (parsed.hostname || "").toLowerCase();

    // Fallback robusto para Supabase em produção (Render + host db.* costuma falhar por DNS/IPv6).
    if (hostname.startsWith("db.") && hostname.endsWith(".supabase.co")) {
      const projectRef = hostname.replace(/^db\./, "").replace(/\.supabase\.co$/, "");
      const envPoolerHost = process.env.SUPABASE_POOLER_HOST;
      const poolerHost =
        (envPoolerHost && envPoolerHost !== "undefined" && envPoolerHost !== "null")
          ? envPoolerHost
          : "aws-1-us-east-1.pooler.supabase.com";

      parsed.hostname = poolerHost;
      if (parsed.username === "postgres" && projectRef) {
        parsed.username = `postgres.${projectRef}`;
      }
    }

    return parsed.toString();
  } catch (_error) {
    return rawUrl;
  }
}

const dbConfig = {
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: isDevelopment ? process.env.DB_HOST || "localhost" : process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  dialect: process.env.DB_DIALECT || (hasDatabaseUrl ? "postgres" : "mysql"),
  logging: isDevelopment ? console.log : false,
  timezone: "-03:00",
};

const sharedOptions = {
  dialect: dbConfig.dialect,
  logging: dbConfig.logging,
  retry: {
    max: 5,
    match: [/ETIMEDOUT/i, /ECONNRESET/i, /ENETUNREACH/i, /SequelizeConnectionError/i],
  },
  ...(dbConfig.dialect === "mysql" ? { timezone: dbConfig.timezone } : {}),
  ...(dbConfig.dialect === "postgres"
    ? {
        dialectOptions: {
          lookup: (hostname, _options, callback) =>
            dns.lookup(hostname, { family: 4, all: false }, callback),
          family: 4,
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

const resolvedDatabaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

const sequelize = hasDatabaseUrl
  ? new Sequelize(resolvedDatabaseUrl, sharedOptions)
  : new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
      host: dbConfig.host,
      port: dbConfig.port,
      ...sharedOptions,
    });

export default sequelize;
