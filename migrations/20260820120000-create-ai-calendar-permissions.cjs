"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.map(String).map((name) => name.toLowerCase()).includes("ai_permissions")) return;

    await queryInterface.createTable("ai_permissions", {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      usersId: { type: Sequelize.UUID, allowNull: false },
      action: { type: Sequelize.STRING, allowNull: false },
      permissionMode: {
        type: Sequelize.ENUM("automatic", "customer_confirmation", "human_approval", "denied"),
        allowNull: false,
        defaultValue: "denied",
      },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      settings: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("ai_permissions", ["usersId", "action"], {
      name: "idx_ai_permissions_tenant_action",
      unique: true,
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.map(String).map((name) => name.toLowerCase()).includes("ai_permissions")) {
      await queryInterface.dropTable("ai_permissions");
    }
  },
};
