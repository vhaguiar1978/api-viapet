"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("driver_checklist_shares", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      token: { type: Sequelize.STRING(24), allowNull: false, unique: true },
      usersId: { type: Sequelize.UUID, allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      rows: { type: Sequelize.JSON, allowNull: false, defaultValue: [] },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("driver_checklist_shares", ["token"], {
      unique: true,
      name: "uq_driver_checklist_shares_token",
    });
    await queryInterface.addIndex("driver_checklist_shares", ["usersId", "date"], {
      name: "idx_driver_checklist_shares_tenant_date",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("driver_checklist_shares");
  },
};
