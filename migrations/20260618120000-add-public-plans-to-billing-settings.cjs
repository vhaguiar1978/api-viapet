"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((item) => (typeof item === "object" ? item.tableName || item.name : item));
    if (!names.includes("billing_settings")) return;

    const columns = await queryInterface.describeTable("billing_settings");
    if (!columns.publicPlans) {
      await queryInterface.addColumn("billing_settings", "publicPlans", {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      });
    }
    if (!columns.fiscalModuleEnabled) {
      await queryInterface.addColumn("billing_settings", "fiscalModuleEnabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((item) => (typeof item === "object" ? item.tableName || item.name : item));
    if (!names.includes("billing_settings")) return;

    const columns = await queryInterface.describeTable("billing_settings");
    if (columns.fiscalModuleEnabled) {
      await queryInterface.removeColumn("billing_settings", "fiscalModuleEnabled");
    }
    if (columns.publicPlans) {
      await queryInterface.removeColumn("billing_settings", "publicPlans");
    }
  },
};
