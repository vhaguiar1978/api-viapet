"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("relationship_contact_approvals", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      missionId: { type: Sequelize.UUID, allowNull: false, references: { model: "relationship_missions", key: "id" }, onDelete: "CASCADE" },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      action: { type: Sequelize.STRING(48), allowNull: false },
      reason: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "pending" },
      reviewedBy: Sequelize.UUID, reviewedAt: Sequelize.DATE,
      providerMessageId: Sequelize.STRING(180), errorCode: Sequelize.STRING(80),
      metadata: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("relationship_contact_approvals", ["missionId", "userId"], { unique: true, name: "uq_relationship_approval_mission_user" });
    await queryInterface.addIndex("relationship_contact_approvals", ["systemId", "status", "createdAt"], { name: "idx_relationship_approval_queue" });
  },
  async down(queryInterface) { await queryInterface.dropTable("relationship_contact_approvals"); },
};
