"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalizedTables = tables.map((table) =>
      typeof table === "string" ? table : table.tableName
    );

    if (!normalizedTables.includes("cash_closures")) {
      await queryInterface.createTable("cash_closures", {
        id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        referenceDate: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        totalEntries: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
        },
        totalExpenses: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
        },
        totalSales: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
        },
        balance: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        closedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        closedBy: {
          type: Sequelize.UUID,
          allowNull: false,
        },
        usersId: {
          type: Sequelize.UUID,
          allowNull: false,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });
    }

    const indexes = await queryInterface.showIndex("cash_closures");
    const hasReferenceDateIndex = indexes.some(
      (index) => index.name === "idx_cash_closure_reference_date"
    );

    if (!hasReferenceDateIndex) {
      await queryInterface.addIndex("cash_closures", ["referenceDate", "usersId"], {
        name: "idx_cash_closure_reference_date",
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("cash_closures");
  },
};
