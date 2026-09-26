"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("commercial_lead_events", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 }, systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      leadId: { type: Sequelize.UUID, allowNull: false, references: { model: "commercial_leads", key: "id" }, onDelete: "CASCADE" }, eventType: { type: Sequelize.STRING(48), allowNull: false },
      previousStage: Sequelize.STRING(32), newStage: Sequelize.STRING(32), previousSellerId: Sequelize.UUID, newSellerId: Sequelize.UUID,
      actorType: { type: Sequelize.STRING(24), allowNull: false }, actorId: Sequelize.UUID, reason: Sequelize.TEXT, metadata: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("commercial_lead_events", ["leadId", "createdAt"], { name: "idx_commercial_lead_timeline" });
    await queryInterface.createTable("commercial_ai_settings", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 }, systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, mode: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "suggest_only" },
      states: { type: Sequelize.JSON, allowNull: false, defaultValue: [] }, cities: { type: Sequelize.JSON, allowNull: false, defaultValue: [] }, segments: { type: Sequelize.JSON, allowNull: false, defaultValue: ["Pet shop"] },
      dailyLeadLimit: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 20 }, dailyContactLimit: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      contactStartTime: { type: Sequelize.TIME, allowNull: false, defaultValue: "09:00:00" }, contactEndTime: { type: Sequelize.TIME, allowNull: false, defaultValue: "18:00:00" },
      requireOptIn: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }, pauseOnHumanReply: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      settings: { type: Sequelize.JSON, allowNull: false, defaultValue: {} }, updatedBy: Sequelize.UUID,
      createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("commercial_ai_settings", ["systemId"], { unique: true, name: "uq_commercial_ai_settings_system" });
  },
  async down(queryInterface) { await queryInterface.dropTable("commercial_ai_settings"); await queryInterface.dropTable("commercial_lead_events"); },
};
