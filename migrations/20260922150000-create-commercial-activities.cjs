"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    const lead = await queryInterface.describeTable("commercial_leads");
    if (!lead.lossReason) await queryInterface.addColumn("commercial_leads", "lossReason", { type: Sequelize.STRING(240), allowNull: true });
    await queryInterface.createTable("commercial_activities", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 }, systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      leadId: { type: Sequelize.UUID, allowNull: false, references: { model: "commercial_leads", key: "id" }, onDelete: "CASCADE" }, sellerId: { type: Sequelize.UUID, allowNull: false, references: { model: "sellers", key: "id" }, onDelete: "RESTRICT" },
      type: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "follow_up" }, title: { type: Sequelize.STRING(220), allowNull: false }, notes: Sequelize.TEXT, dueAt: Sequelize.DATE, completedAt: Sequelize.DATE,
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "open" }, createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("commercial_activities", ["sellerId", "status", "dueAt"], { name: "idx_commercial_activities_day" });
    await queryInterface.addIndex("commercial_activities", ["leadId", "createdAt"], { name: "idx_commercial_activities_lead" });
  },
  async down(queryInterface) { await queryInterface.dropTable("commercial_activities"); const lead = await queryInterface.describeTable("commercial_leads"); if (lead.lossReason) await queryInterface.removeColumn("commercial_leads", "lossReason"); },
};
