"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("bank_statements")) {
      await queryInterface.createTable("bank_statements", {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
        usersId: { type: Sequelize.UUID, allowNull: false },
        bankAccountId: { type: Sequelize.UUID, allowNull: true, comment: "Conta destino do extrato (opcional)" },
        sourceType: {
          type: Sequelize.STRING(20),
          allowNull: false,
          comment: "csv, xlsx, ofx, api",
        },
        fileName: { type: Sequelize.STRING(255), allowNull: true },
        startDate: { type: Sequelize.DATE, allowNull: true },
        endDate: { type: Sequelize.DATE, allowNull: true },
        totalEntries: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        totalCredits: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        totalDebits: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: "imported",
          comment: "imported, processing, reviewed, archived",
        },
        notes: { type: Sequelize.TEXT, allowNull: true },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
    }

    if (!normalized.includes("bank_statement_entries")) {
      await queryInterface.createTable("bank_statement_entries", {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
        statementId: { type: Sequelize.UUID, allowNull: false },
        usersId: { type: Sequelize.UUID, allowNull: false },
        bankAccountId: { type: Sequelize.UUID, allowNull: true },
        entryDate: { type: Sequelize.DATEONLY, allowNull: false },
        direction: {
          type: Sequelize.STRING(10),
          allowNull: false,
          comment: "credit (entrada) ou debit (saida)",
        },
        amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
        description: { type: Sequelize.STRING(500), allowNull: true },
        payerName: { type: Sequelize.STRING(180), allowNull: true, comment: "Nome do remetente / contraparte" },
        payerDocument: { type: Sequelize.STRING(20), allowNull: true, comment: "CPF/CNPJ se disponivel" },
        externalId: { type: Sequelize.STRING(120), allowNull: true, comment: "ID nativo do extrato (FITID em OFX)" },
        paymentMethodHint: {
          type: Sequelize.STRING(40),
          allowNull: true,
          comment: "pix, ted, doc, debito_automatico, etc. derivado da descricao",
        },
        rawJson: { type: Sequelize.JSON, allowNull: true, comment: "Linha original do arquivo (debug)" },
        matchStatus: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: "pending",
          comment: "pending, suggested, matched, ignored",
        },
        matchedFinanceId: { type: Sequelize.INTEGER, allowNull: true },
        matchedPaymentId: { type: Sequelize.UUID, allowNull: true },
        matchConfidence: { type: Sequelize.DECIMAL(4, 3), allowNull: true, comment: "0.000-1.000" },
        matchedAt: { type: Sequelize.DATE, allowNull: true },
        matchedBy: { type: Sequelize.UUID, allowNull: true },
        matchSource: {
          type: Sequelize.STRING(20),
          allowNull: true,
          comment: "auto, suggestion_accepted, manual, api",
        },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
    }

    try {
      const idx = await queryInterface.showIndex("bank_statement_entries");
      const has = (name) => idx.some((i) => i.name === name);
      if (!has("idx_bse_user_status")) {
        await queryInterface.addIndex("bank_statement_entries", ["usersId", "matchStatus"], { name: "idx_bse_user_status" });
      }
      if (!has("idx_bse_statement")) {
        await queryInterface.addIndex("bank_statement_entries", ["statementId"], { name: "idx_bse_statement" });
      }
      if (!has("idx_bse_amount_date")) {
        await queryInterface.addIndex("bank_statement_entries", ["amount", "entryDate"], { name: "idx_bse_amount_date" });
      }
      if (!has("uq_bse_external_id")) {
        await queryInterface.addIndex("bank_statement_entries", ["usersId", "externalId"], {
          name: "uq_bse_external_id",
          unique: false,
        });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indices em bank_statement_entries:", idxErr.message);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("bank_statement_entries");
    await queryInterface.dropTable("bank_statements");
  },
};
