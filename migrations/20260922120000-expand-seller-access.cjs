"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("sellers");
    if (!table.approvedAt) await queryInterface.addColumn("sellers", "approvedAt", { type: Sequelize.DATE, allowNull: true });
    if (!table.approvedBy) await queryInterface.addColumn("sellers", "approvedBy", { type: Sequelize.UUID, allowNull: true });
    if (!table.lastAccessAt) await queryInterface.addColumn("sellers", "lastAccessAt", { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addIndex("sellers", ["systemId", "status", "createdAt"], { name: "idx_sellers_approval_queue" }).catch(() => {});
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable("sellers");
    if (table.lastAccessAt) await queryInterface.removeColumn("sellers", "lastAccessAt");
    if (table.approvedBy) await queryInterface.removeColumn("sellers", "approvedBy");
    if (table.approvedAt) await queryInterface.removeColumn("sellers", "approvedAt");
  },
};
