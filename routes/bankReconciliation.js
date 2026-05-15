import express from "express";
import multer from "multer";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import BankStatement from "../models/BankStatement.js";
import BankStatementEntry from "../models/BankStatementEntry.js";
import ReconciliationMatch from "../models/ReconciliationMatch.js";
import BankAccount from "../models/BankAccount.js";
import { parseStatementBuffer } from "../service/bankStatementParser.js";
import {
  reconcileStatement,
  findBestMatch,
  applyBaixa,
  RECONCILIATION_CONSTANTS,
} from "../service/bankReconciliation.js";
import { logActivity } from "../service/activityLogger.js";

const router = express.Router();

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|xlsx?|ofx)$/i.test(file.originalname) ||
      /(csv|excel|spreadsheet|ofx|x-ofx|plain)/i.test(file.mimetype);
    if (!ok) {
      return cb(new Error("Formato inválido. Envie CSV, XLSX, XLS ou OFX."), false);
    }
    cb(null, true);
  },
});

// POST /bank-reconciliation/import — sobe arquivo, faz parse e cria entries
router.post(
  "/bank-reconciliation/import",
  authenticate,
  statementUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Arquivo não enviado (campo 'file')" });
      }
      const usersId = req.user.establishment;
      const bankAccountId = req.body.bankAccountId || null;
      const autoReconcile = String(req.body.autoReconcile || "true").toLowerCase() !== "false";

      if (bankAccountId) {
        const acc = await BankAccount.findOne({ where: { id: bankAccountId, usersId } });
        if (!acc) return res.status(400).json({ message: "Conta bancária inválida" });
      }

      const { sourceType, entries } = await parseStatementBuffer({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
      });

      if (entries.length === 0) {
        return res.status(400).json({
          message: "Nenhum lançamento reconhecido no arquivo. Verifique o formato.",
          sourceType,
        });
      }

      const dates = entries.map((e) => new Date(e.entryDate)).filter((d) => Number.isFinite(d.getTime()));
      const startDate = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
      const endDate = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
      const totalCredits = entries
        .filter((e) => e.direction === "credit")
        .reduce((acc, e) => acc + Number(e.amount), 0);
      const totalDebits = entries
        .filter((e) => e.direction === "debit")
        .reduce((acc, e) => acc + Number(e.amount), 0);

      const statement = await BankStatement.create({
        usersId,
        bankAccountId,
        sourceType,
        fileName: req.file.originalname,
        startDate,
        endDate,
        totalEntries: entries.length,
        totalCredits,
        totalDebits,
        status: "imported",
        createdBy: req.user.id,
      });

      // Dedup: se já existir entry com mesmo externalId para esse user, pulamos
      const existingExternalIds = new Set();
      if (entries.some((e) => e.externalId)) {
        const ids = entries.map((e) => e.externalId).filter(Boolean);
        const existing = await BankStatementEntry.findAll({
          where: { usersId, externalId: { [Op.in]: ids } },
          attributes: ["externalId"],
        });
        existing.forEach((e) => existingExternalIds.add(e.externalId));
      }

      const rowsToCreate = entries
        .filter((e) => !e.externalId || !existingExternalIds.has(e.externalId))
        .map((e) => ({
          statementId: statement.id,
          usersId,
          bankAccountId,
          entryDate: e.entryDate,
          direction: e.direction,
          amount: e.amount,
          description: e.description ? String(e.description).slice(0, 500) : null,
          payerName: e.payerName,
          payerDocument: e.payerDocument,
          externalId: e.externalId,
          paymentMethodHint: e.paymentMethodHint,
          rawJson: e.rawJson,
          matchStatus: "pending",
        }));

      const createdEntries = await BankStatementEntry.bulkCreate(rowsToCreate, { returning: true });

      logActivity({
        req,
        modulo: "financeiro",
        acao: "bank_statement_imported",
        descricao: `Extrato importado: ${req.file.originalname} (${createdEntries.length} lançamentos)`,
        entidadeTipo: "bank_statement",
        entidadeId: statement.id,
        metadata: { sourceType, totalEntries: createdEntries.length, totalCredits, totalDebits },
      });

      let reconcileResults = null;
      if (autoReconcile && createdEntries.length > 0) {
        reconcileResults = await reconcileStatement({
          usersId,
          statementId: statement.id,
          entries: createdEntries,
          autoBaixa: true,
        });
      }

      res.status(201).json({
        message: "Extrato importado com sucesso",
        data: {
          statement,
          imported: createdEntries.length,
          skippedDuplicates: entries.length - createdEntries.length,
          reconcileResults,
        },
      });
    } catch (error) {
      console.error("Erro ao importar extrato:", error);
      res.status(500).json({ message: "Erro ao importar extrato", error: error.message });
    }
  },
);

// GET /bank-reconciliation/statements — lista extratos importados
router.get("/bank-reconciliation/statements", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const rows = await BankStatement.findAll({
      where: { usersId },
      order: [["createdAt", "DESC"]],
      limit: 100,
    });
    res.json({ message: "Extratos listados", data: rows });
  } catch (error) {
    res.status(500).json({ message: "Erro ao listar extratos", error: error.message });
  }
});

// GET /bank-reconciliation/entries — lista entries com filtros
router.get("/bank-reconciliation/entries", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const { statementId, status, direction, startDate, endDate, limit = 100, offset = 0 } = req.query;

    const where = { usersId };
    if (statementId) where.statementId = statementId;
    if (status) where.matchStatus = status;
    if (direction) where.direction = direction;
    if (startDate || endDate) {
      where.entryDate = {};
      if (startDate) where.entryDate[Op.gte] = startDate;
      if (endDate) where.entryDate[Op.lte] = endDate;
    }

    const { rows, count } = await BankStatementEntry.findAndCountAll({
      where,
      order: [["entryDate", "DESC"], ["createdAt", "DESC"]],
      limit: Math.min(500, Number(limit) || 100),
      offset: Number(offset) || 0,
    });

    res.json({ message: "Entries listadas", data: rows, total: count });
  } catch (error) {
    res.status(500).json({ message: "Erro ao listar entries", error: error.message });
  }
});

// POST /bank-reconciliation/entries/:id/match — força recalculo do match para uma entry
router.post("/bank-reconciliation/entries/:id/match", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const entry = await BankStatementEntry.findOne({ where: { id: req.params.id, usersId } });
    if (!entry) return res.status(404).json({ message: "Entry não encontrada" });

    const best = await findBestMatch({ usersId, entry });
    if (!best) {
      await entry.update({ matchStatus: "pending", matchConfidence: null });
      return res.json({ message: "Nenhum candidato encontrado", data: { entry } });
    }
    const isAuto = best.score >= RECONCILIATION_CONSTANTS.AUTO_THRESHOLD;
    await entry.update({
      matchConfidence: best.score,
      matchStatus: isAuto ? "matched" : "suggested",
      matchedFinanceId: best.candidate.kind === "finance" ? best.candidate.id : null,
      matchedPaymentId: best.candidate.kind === "payment" ? best.candidate.id : null,
    });

    if (isAuto) {
      await applyBaixa({
        usersId,
        candidate: best.candidate,
        entry,
        confidence: best.score,
        source: "auto",
        createdBy: req.user.id,
      });
      await entry.update({ matchSource: "auto", matchedAt: new Date(), matchedBy: req.user.id });
    }

    res.json({
      message: isAuto ? "Conciliado automaticamente" : "Sugestão criada",
      data: { entry, best },
    });
  } catch (error) {
    console.error("Erro ao re-conciliar entry:", error);
    res.status(500).json({ message: "Erro ao re-conciliar entry", error: error.message });
  }
});

// POST /bank-reconciliation/entries/:id/confirm — aceita sugestão e dá baixa
router.post("/bank-reconciliation/entries/:id/confirm", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const entry = await BankStatementEntry.findOne({ where: { id: req.params.id, usersId } });
    if (!entry) return res.status(404).json({ message: "Entry não encontrada" });

    // Aceita override do candidato no body (financeId | paymentId)
    const overrideFinanceId = req.body.financeId || null;
    const overridePaymentId = req.body.paymentId || null;

    let candidate;
    if (overrideFinanceId) {
      const { default: Finance } = await import("../models/Finance.js");
      const f = await Finance.findOne({ where: { id: overrideFinanceId, usersId } });
      if (!f) return res.status(400).json({ message: "Lançamento financeiro inválido" });
      candidate = {
        kind: "finance",
        id: f.id,
        amount: f.amount,
        grossAmount: f.grossAmount,
        dueDate: f.dueDate,
        date: f.date,
      };
    } else if (overridePaymentId) {
      const { default: AppointmentPayment } = await import("../models/AppointmentPayment.js");
      const p = await AppointmentPayment.findOne({ where: { id: overridePaymentId, usersId } });
      if (!p) return res.status(400).json({ message: "Pagamento inválido" });
      candidate = {
        kind: "payment",
        id: p.id,
        amount: p.amount,
        grossAmount: p.grossAmount,
        dueDate: p.dueDate,
      };
    } else if (entry.matchedFinanceId) {
      const { default: Finance } = await import("../models/Finance.js");
      const f = await Finance.findOne({ where: { id: entry.matchedFinanceId, usersId } });
      if (!f) return res.status(400).json({ message: "Lançamento financeiro sugerido não existe mais" });
      candidate = { kind: "finance", id: f.id, amount: f.amount, dueDate: f.dueDate, date: f.date };
    } else if (entry.matchedPaymentId) {
      const { default: AppointmentPayment } = await import("../models/AppointmentPayment.js");
      const p = await AppointmentPayment.findOne({ where: { id: entry.matchedPaymentId, usersId } });
      if (!p) return res.status(400).json({ message: "Pagamento sugerido não existe mais" });
      candidate = { kind: "payment", id: p.id, amount: p.amount, dueDate: p.dueDate };
    } else {
      return res.status(400).json({
        message: "Nenhum candidato definido. Informe financeId ou paymentId no body.",
      });
    }

    const result = await applyBaixa({
      usersId,
      candidate,
      entry,
      confidence: entry.matchConfidence,
      source: "suggestion_accepted",
      createdBy: req.user.id,
    });

    await entry.update({
      matchStatus: "matched",
      matchSource: "suggestion_accepted",
      matchedAt: new Date(),
      matchedBy: req.user.id,
      matchedFinanceId: candidate.kind === "finance" ? candidate.id : null,
      matchedPaymentId: candidate.kind === "payment" ? candidate.id : null,
    });

    logActivity({
      req,
      modulo: "financeiro",
      acao: "reconciliation_match_confirmed",
      descricao: `Conciliação confirmada: entry ${entry.id} → ${candidate.kind} ${candidate.id}`,
      entidadeTipo: "bank_statement_entry",
      entidadeId: entry.id,
      metadata: { confidence: entry.matchConfidence, candidate },
    });

    res.json({ message: "Baixa confirmada", data: { entry, baixa: result } });
  } catch (error) {
    console.error("Erro ao confirmar conciliação:", error);
    res.status(500).json({ message: "Erro ao confirmar conciliação", error: error.message });
  }
});

// POST /bank-reconciliation/entries/:id/ignore — marca como ignorada
router.post("/bank-reconciliation/entries/:id/ignore", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const entry = await BankStatementEntry.findOne({ where: { id: req.params.id, usersId } });
    if (!entry) return res.status(404).json({ message: "Entry não encontrada" });
    await entry.update({ matchStatus: "ignored", matchedAt: new Date(), matchedBy: req.user.id });
    res.json({ message: "Entry ignorada", data: entry });
  } catch (error) {
    res.status(500).json({ message: "Erro ao ignorar entry", error: error.message });
  }
});

// POST /bank-reconciliation/statements/:id/match-all — re-roda matching para todo o statement
router.post("/bank-reconciliation/statements/:id/match-all", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const statement = await BankStatement.findOne({ where: { id: req.params.id, usersId } });
    if (!statement) return res.status(404).json({ message: "Extrato não encontrado" });

    const entries = await BankStatementEntry.findAll({
      where: { usersId, statementId: statement.id, matchStatus: "pending" },
    });

    const results = await reconcileStatement({
      usersId,
      statementId: statement.id,
      entries,
      autoBaixa: true,
    });

    res.json({ message: "Re-conciliação concluída", data: results });
  } catch (error) {
    console.error("Erro ao re-conciliar statement:", error);
    res.status(500).json({ message: "Erro ao re-conciliar statement", error: error.message });
  }
});

// GET /bank-reconciliation/matches/:entryId — histórico de matches dessa entry
router.get("/bank-reconciliation/matches/:entryId", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const rows = await ReconciliationMatch.findAll({
      where: { usersId, entryId: req.params.entryId },
      order: [["createdAt", "DESC"]],
    });
    res.json({ message: "Histórico de matches", data: rows });
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar histórico", error: error.message });
  }
});

// Open Finance / API bancária — placeholder (Fase 2)
// Endpoint preparado para receber webhooks/polling. Por ora apenas registra payload.
router.post("/bank-reconciliation/api-webhook", authenticate, async (req, res) => {
  try {
    const usersId = req.user.establishment;
    const provider = String(req.body.provider || "unknown");
    const payloadEntries = Array.isArray(req.body.entries) ? req.body.entries : [];

    if (payloadEntries.length === 0) {
      return res.json({ message: "Webhook recebido (sem entries)", data: { provider } });
    }

    const statement = await BankStatement.create({
      usersId,
      bankAccountId: req.body.bankAccountId || null,
      sourceType: "api",
      fileName: `${provider}-${new Date().toISOString()}`,
      totalEntries: payloadEntries.length,
      status: "imported",
      createdBy: req.user.id,
    });

    const rows = payloadEntries.map((e) => ({
      statementId: statement.id,
      usersId,
      bankAccountId: req.body.bankAccountId || null,
      entryDate: e.entryDate,
      direction: e.direction,
      amount: e.amount,
      description: e.description,
      payerName: e.payerName,
      payerDocument: e.payerDocument,
      externalId: e.externalId,
      paymentMethodHint: e.paymentMethodHint,
      rawJson: e,
      matchStatus: "pending",
    }));
    const created = await BankStatementEntry.bulkCreate(rows, { returning: true });
    await reconcileStatement({ usersId, statementId: statement.id, entries: created, autoBaixa: true });

    res.status(201).json({ message: "Webhook processado", data: { statement, imported: created.length } });
  } catch (error) {
    res.status(500).json({ message: "Erro ao processar webhook", error: error.message });
  }
});

export default router;
