import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import dns from "dns";

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

console.log(`Ambiente: ${process.env.NODE_ENV || "production"}`);
console.log(`Arquivo de configuracao: ${envFile}`);

if (process.env.DATABASE_URL) {
  console.log("Banco de dados configurado via DATABASE_URL");
} else {
  console.log(
    `Banco de dados: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
  );
}

console.log(`NODE_ENV detectado: "${process.env.NODE_ENV}"`);
console.log(`Tipo da variavel NODE_ENV: ${typeof process.env.NODE_ENV}`);
