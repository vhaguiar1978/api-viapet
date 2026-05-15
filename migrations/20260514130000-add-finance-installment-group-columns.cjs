"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("finances");

    if (!table.purchaseGroupId) {
      await queryInterface.addColumn("finances", "purchaseGroupId", {
        type: Sequelize.UUID,
        allowNull: true,
        comment: "UUID compartilhado por todas as parcelas de uma mesma compra",
      });
    }

    if (!table.parentFinanceId) {
      await queryInterface.addColumn("finances", "parentFinanceId", {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "Aponta para a primeira parcela (parent) — opcional, redundante com purchaseGroupId",
      });
    }

    if (!table.vendor) {
      await queryInterface.addColumn("finances", "vendor", {
        type: Sequelize.STRING(180),
        allowNull: true,
        comment: "Fornecedor da despesa",
      });
    }

    if (!table.costCenter) {
      await queryInterface.addColumn("finances", "costCenter", {
        type: Sequelize.STRING(120),
        allowNull: true,
        comment: "Centro de custo (separado de category/subCategory)",
      });
    }

    if (!table.bankAccountId) {
      await queryInterface.addColumn("finances", "bankAccountId", {
        type: Sequelize.UUID,
        allowNull: true,
        comment: "Conta bancária associada (FK soft para bank_accounts.id)",
      });
    }

    try {
      const indexes = await queryInterface.showIndex("finances");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("idx_finance_purchase_group")) {
        await queryInterface.addIndex("finances", ["purchaseGroupId"], {
          name: "idx_finance_purchase_group",
        });
      }
      if (!has("idx_finance_bank_account")) {
        await queryInterface.addIndex("finances", ["bankAccountId"], {
          name: "idx_finance_bank_account",
        });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indices em finances:", idxErr.message);
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("finances");
    if (table.purchaseGroupId) await queryInterface.removeColumn("finances", "purchaseGroupId");
    if (table.parentFinanceId) await queryInterface.removeColumn("finances", "parentFinanceId");
    if (table.vendor) await queryInterface.removeColumn("finances", "vendor");
    if (table.costCenter) await queryInterface.removeColumn("finances", "costCenter");
    if (table.bankAccountId) await queryInterface.removeColumn("finances", "bankAccountId");
  },
};
