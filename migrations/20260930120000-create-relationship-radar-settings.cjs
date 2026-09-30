"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("relationship_radar_settings", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      systemId: { type: Sequelize.STRING(32), allowNull: false, unique: true, defaultValue: "VIAPET" },
      settings: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable("relationship_radar_settings"); },
};
