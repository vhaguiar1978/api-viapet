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

try {
  dns.setDefaultResultOrder("ipv4first");
  console.log("DNS padrao ajustado para ipv4first");
} catch (error) {
  console.warn("Nao foi possivel ajustar DNS para ipv4first:", error.message);
}

const resolvedDatabaseUrl = firstValidEnv(
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_DB_URL",
);

console.log(`Ambiente: ${process.env.NODE_ENV || "production"}`);
console.log(`Arquivo de configuracao: ${envFile}`);

if (resolvedDatabaseUrl) {
  console.log("Banco de dados configurado via DATABASE_URL");
} else {
  console.log(
    `Banco de dados: ${firstValidEnv("DB_HOST", "PGHOST", "POSTGRES_HOST")}:${firstValidEnv("DB_PORT", "PGPORT", "POSTGRES_PORT")}/${firstValidEnv("DB_NAME", "PGDATABASE", "POSTGRES_DATABASE")}`
  );
}

console.log(`NODE_ENV detectado: "${process.env.NODE_ENV}"`);
console.log(`Tipo da variavel NODE_ENV: ${typeof process.env.NODE_ENV}`);
