#!/usr/bin/env node

/**
 * cleanup-orphan-sale-finances.js
 *
 * Limpa Finance rows ÓRFÃOS de vendas — registros com category="Vendas" e
 * status pendente/atrasado cuja Sales referenciada já não existe mais.
 *
 * Origem do problema: até o commit que introduziu este script, o
 * `Finance.destroy` no DELETE de venda (routes/sales.js) procurava por
 * `reference: \`sale_${sale.id}\`` mas o create gravava `reference: sale.id`
 * (cru). Resultado: vendas deletadas deixavam Finance pendente no banco,
 * fazendo o cliente aparecer eternamente como devedor na tela
 * "Pesquisar Devedores" do Financeiro.
 *
 * USO:
 *   node scripts/cleanup-orphan-sale-finances.js              # dry-run (só lista)
 *   node scripts/cleanup-orphan-sale-finances.js --apply      # apaga de fato
 *
 * SEGURANÇA:
 * - Só toca Finance com category="Vendas" (marcador exclusivo de venda).
 * - Só apaga se NÃO existir Sales com aquele id em nenhum tenant.
 * - Sempre escreve um relatório em ./reports/orphan-sale-finances-<timestamp>.json
 *   antes de tocar em qualquer coisa.
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Finance from "../models/Finance.js";
import Sales from "../models/Sales.js";
import { setupAssociations } from "../models/associations.js";

dotenv.config();
setupAssociations();

const APPLY = process.argv.includes("--apply");

function stripSalePrefix(reference) {
  const raw = String(reference || "").trim();
  return raw.startsWith("sale_") ? raw.slice("sale_".length) : raw;
}

async function main() {
  console.log(`\n=== cleanup-orphan-sale-finances (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

  // 1) Carrega todos os Finance candidatos: vendas em aberto.
  const candidates = await Finance.findAll({
    where: {
      category: "Vendas",
      status: { [Op.in]: ["pendente", "atrasado"] },
      reference: { [Op.ne]: null },
    },
    attributes: [
      "id",
      "reference",
      "description",
      "status",
      "amount",
      "grossAmount",
      "dueDate",
      "date",
      "createdAt",
      "usersId",
    ],
  });

  console.log(`Candidatos (Finance category=Vendas, status pendente/atrasado): ${candidates.length}`);

  if (!candidates.length) {
    console.log("Nada a verificar. Saindo.");
    await sequelize.close();
    return;
  }

  // 2) Resolve qual Sales.id cada Finance aponta (cru ou prefixado).
  const referencedIds = new Set();
  for (const fin of candidates) {
    const resolved = stripSalePrefix(fin.reference);
    if (resolved) referencedIds.add(resolved);
  }

  // 3) Busca quais desses Sales.id existem (em qualquer tenant — checagem
  //    global por id é o mais defensivo possível: só apagamos se realmente
  //    não há venda nenhuma com aquele id).
  const existingSales = await Sales.findAll({
    where: { id: { [Op.in]: [...referencedIds] } },
    attributes: ["id"],
  });
  const existingIds = new Set(existingSales.map((s) => String(s.id)));

  // 4) Separa órfãos.
  const orphans = candidates.filter((fin) => {
    const resolved = stripSalePrefix(fin.reference);
    return resolved && !existingIds.has(resolved);
  });

  console.log(`Sales referenciados existentes: ${existingIds.size}`);
  console.log(`ÓRFÃOS encontrados: ${orphans.length}`);

  // 5) Sempre grava relatório.
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `orphan-sale-finances-${stamp}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: APPLY ? "APPLY" : "DRY-RUN",
        totals: {
          candidates: candidates.length,
          referencedIds: referencedIds.size,
          existingSales: existingIds.size,
          orphans: orphans.length,
        },
        orphans: orphans.map((fin) => ({
          financeId: fin.id,
          reference: fin.reference,
          resolvedSaleId: stripSalePrefix(fin.reference),
          description: fin.description,
          status: fin.status,
          amount: fin.amount,
          grossAmount: fin.grossAmount,
          dueDate: fin.dueDate,
          date: fin.date,
          createdAt: fin.createdAt,
          usersId: fin.usersId,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`Relatório: ${reportPath}`);

  // 6) Soma de dívida fantasma por tenant (resumo no stdout).
  if (orphans.length) {
    const byTenant = new Map();
    for (const fin of orphans) {
      const t = String(fin.usersId || "?");
      const v = byTenant.get(t) || { count: 0, sum: 0 };
      v.count += 1;
      v.sum += Number(fin.grossAmount || fin.amount || 0);
      byTenant.set(t, v);
    }
    console.log("\nResumo de dívida-fantasma por tenant (usersId → count, soma R$):");
    for (const [t, v] of byTenant.entries()) {
      console.log(`  ${t}  ${v.count}  R$ ${v.sum.toFixed(2)}`);
    }
  }

  // 7) APPLY: apaga em batch.
  if (APPLY && orphans.length) {
    const ids = orphans.map((f) => f.id);
    const deleted = await Finance.destroy({ where: { id: { [Op.in]: ids } } });
    console.log(`\n[APPLY] Finance.destroy removeu ${deleted} linhas.`);
  } else if (orphans.length) {
    console.log("\n[DRY-RUN] Nenhuma linha removida. Rode com --apply para apagar.");
  }

  await sequelize.close();
  console.log("\n=== concluído ===\n");
}

main().catch(async (err) => {
  console.error("ERRO:", err);
  try {
    await sequelize.close();
  } catch (_) {}
  process.exit(1);
});
