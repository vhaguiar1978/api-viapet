"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("reconciliation_matches")) {
      await queryInterface.createTable("reconciliation_matches", {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
        usersId: { type: Sequelize.UUID, allowNull: false },
        entryId: { type: Sequelize.UUID, allowNull: false, comment: "bank_statement_entries.id" },
        bankAccountId: { type: Sequelize.UUID, allowNull: true },
        financeId: { type: Sequelize.INTEGER, allowNull: true },
        paymentId: { type: Sequelize.UUID, allowNull: true, comment: "appointment_payments.id" },
        confidence: { type: Sequelize.DECIMAL(4, 3), allowNull: true },
        source: {
          type: Sequelize.STRING(20),
          allowNull: false,
          comment: "auto, suggestion_accepted, manual, api",
        },
        grossAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
        feeAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
        netAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
    }

    try {
      const idx = await queryInterface.showIndex("reconciliation_matches");
      const has = (name) => idx.some((i) => i.name === name);
      if (!has("idx_recmatch_user_created")) {
        await queryInterface.addIndex("reconciliation_matches", ["usersId", "createdAt"], { name: "idx_recmatch_user_created" });
      }
      if (!has("idx_recmatch_entry")) {
        await queryInterface.addIndex("reconciliation_matches", ["entryId"], { name: "idx_recmatch_entry" });
      }
      if (!has("idx_recmatch_finance")) {
        await queryInterface.addIndex("reconciliation_matches", ["financeId"], { name: "idx_recmatch_finance" });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indices em reconciliation_matches:", idxErr.message);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("reconciliation_matches");
  },
};
