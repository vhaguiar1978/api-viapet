"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("commercial_leads", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      sellerId: { type: Sequelize.UUID, allowNull: true, references: { model: "sellers", key: "id" }, onDelete: "RESTRICT" },
      ownerType: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "seller" },
      sourceProvider: { type: Sequelize.STRING(32), allowNull: false }, externalId: { type: Sequelize.STRING(180), allowNull: false },
      businessName: { type: Sequelize.STRING(220), allowNull: false }, segment: Sequelize.STRING(120), state: Sequelize.STRING(80), city: Sequelize.STRING(120), neighborhood: Sequelize.STRING(120),
      address: Sequelize.TEXT, phone: Sequelize.STRING(32), whatsapp: Sequelize.STRING(32), website: Sequelize.TEXT,
      latitude: Sequelize.DECIMAL(10, 7), longitude: Sequelize.DECIMAL(10, 7), stage: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "found" },
      contactPermission: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "unknown" }, nextActionAt: Sequelize.DATE, lastContactAt: Sequelize.DATE,
      aiEnabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, metadata: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("commercial_leads", ["systemId", "sourceProvider", "externalId"], { unique: true, name: "uq_commercial_lead_source" });
    await queryInterface.addIndex("commercial_leads", ["sellerId", "stage", "nextActionAt"], { name: "idx_commercial_leads_work_queue" });
  },
  async down(queryInterface) { await queryInterface.dropTable("commercial_leads"); },
};
