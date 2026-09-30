"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("relationship_missions", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      name: { type: Sequelize.STRING(160), allowNull: false },
      instruction: { type: Sequelize.TEXT, allowNull: false },
      userIds: { type: Sequelize.JSON, allowNull: false, defaultValue: [] },
      results: { type: Sequelize.JSON, allowNull: false, defaultValue: [] },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "observed" },
      createdBy: { type: Sequelize.UUID, allowNull: false },
      analyzedAt: Sequelize.DATE,
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("relationship_missions", ["systemId", "createdAt"], { name: "idx_relationship_missions_system_created" });
  },
  async down(queryInterface) { await queryInterface.dropTable("relationship_missions"); },
};
