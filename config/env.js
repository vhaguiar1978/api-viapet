import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import dns from "dns";

function firstValidEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (Boolean(value) && value !== "undefined" && value !== "null") {
      return value;
    }
  }
  return undefined;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

const envFile =
  process.env.NODE_ENV === "development" ? ".env.development" : ".env";

config({ path: path.resolve(__dirname, "..", envFile) });

// Força DNS IPv4 para evitar ENETUNREACH no Render + Supabase
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_error) {
  // noop — Node < 17
}

const resolvedDatabaseUrl = firstValidEnv(
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_DB_URL",
);

console.log(`[env] Ambiente: ${process.env.NODE_ENV}`);
console.log(`[env] Arquivo: ${envFile}`);
console.log(`[env] DATABASE_URL configurada: ${resolvedDatabaseUrl ? "sim" : "não"}`);
