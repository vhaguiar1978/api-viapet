"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("data_export_jobs", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      usersId: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      requestedBy: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "RESTRICT" },
      format: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "xlsx" },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "REQUESTED" },
      fileName: Sequelize.STRING(255), storageKey: Sequelize.TEXT, fileSize: Sequelize.BIGINT,
      recordCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      startedAt: Sequelize.DATE, finishedAt: Sequelize.DATE, expiresAt: Sequelize.DATE, downloadedAt: Sequelize.DATE,
      errorCode: Sequelize.STRING(80), errorMessage: Sequelize.TEXT,
      downloadTokenHash: Sequelize.STRING(64), downloadTokenExpiresAt: Sequelize.DATE,
      createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("data_export_jobs", ["usersId", "createdAt"], { name: "idx_data_exports_tenant_created" });
    await queryInterface.addIndex("data_export_jobs", ["status", "createdAt"], { name: "idx_data_exports_status_created" });
    await queryInterface.addIndex("data_export_jobs", ["expiresAt"], { name: "idx_data_exports_expires" });
  },
  async down(queryInterface) { await queryInterface.dropTable("data_export_jobs"); },
};
