"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("bank_accounts")) {
      await queryInterface.createTable("bank_accounts", {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
        usersId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: "users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
        },
        name: { type: Sequelize.STRING(120), allowNull: false },
        bank: { type: Sequelize.STRING(120), allowNull: true },
        agency: { type: Sequelize.STRING(20), allowNull: true },
        accountNumber: { type: Sequelize.STRING(40), allowNull: true },
        accountType: {
          type: Sequelize.STRING(30),
          allowNull: false,
          defaultValue: "corrente",
          comment: "corrente, poupanca, pagamento, cartao, outros",
        },
        pixKey: { type: Sequelize.STRING(180), allowNull: true },
        initialBalance: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
    }

    try {
      const indexes = await queryInterface.showIndex("bank_accounts");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("idx_bank_accounts_user")) {
        await queryInterface.addIndex("bank_accounts", ["usersId"], { name: "idx_bank_accounts_user" });
      }
      if (!has("idx_bank_accounts_active")) {
        await queryInterface.addIndex("bank_accounts", ["usersId", "active"], { name: "idx_bank_accounts_active" });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indices de bank_accounts:", idxErr.message);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("bank_accounts");
  },
};
