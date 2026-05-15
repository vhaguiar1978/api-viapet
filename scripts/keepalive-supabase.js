// Script de keepalive do Supabase.
//
// Faz uma query trivial (SELECT NOW()) no banco para registrar atividade.
// O Supabase free pausa projetos sem atividade no dashboard por ~7 dias,
// mas atividade de conexao TCP/query no banco tambem reinicia o contador.
//
// Executado pelo workflow .github/workflows/supabase-keepalive.yml a cada 3 dias.
// Pode ser executado manualmente: DATABASE_URL=... node scripts/keepalive-supabase.js

import pg from "pg";

const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[keepalive] ERRO: variavel DATABASE_URL nao foi definida.");
    process.exit(1);
  }

  const safeUrl = connectionString.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
  console.log(`[keepalive] Conectando em ${safeUrl}`);

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const startedAt = Date.now();
  try {
    await client.connect();
    const { rows } = await client.query(
      "SELECT NOW() AS now, current_database() AS db, version() AS version",
    );
    const elapsed = Date.now() - startedAt;
    console.log(`[keepalive] OK em ${elapsed}ms`);
    console.log(`[keepalive] db=${rows[0].db}`);
    console.log(`[keepalive] now=${rows[0].now.toISOString()}`);
    console.log(`[keepalive] version=${String(rows[0].version).slice(0, 80)}`);
  } catch (error) {
    console.error(`[keepalive] FALHA: ${error.message}`);
    if (error.code) console.error(`[keepalive] code=${error.code}`);
    process.exit(2);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
