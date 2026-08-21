"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("cash_register_sessions", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal("gen_random_uuid()") },
      usersId: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      registerCode: { type: Sequelize.STRING(80), allowNull: false, defaultValue: "principal" },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: "ABERTO" },
      openingAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      openingNotes: { type: Sequelize.TEXT, allowNull: true },
      openedBy: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
      openedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      countedAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      differenceAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      differenceReason: { type: Sequelize.TEXT, allowNull: true },
      closedBy: { type: Sequelize.UUID, allowNull: true, references: { model: "users", key: "id" } },
      closedAt: { type: Sequelize.DATE, allowNull: true },
      deviceInfo: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX uq_cash_register_open ON cash_register_sessions ("usersId", "registerCode") WHERE status IN ('ABERTO','EM_CONFERENCIA','FECHAMENTO_COM_PENDENCIA')`);

    await queryInterface.createTable("cash_register_movements", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal("gen_random_uuid()") },
      sessionId: { type: Sequelize.UUID, allowNull: false, references: { model: "cash_register_sessions", key: "id" }, onDelete: "RESTRICT" },
      usersId: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      type: { type: Sequelize.STRING(40), allowNull: false },
      direction: { type: Sequelize.STRING(10), allowNull: false },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      description: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(100), allowNull: true },
      destination: { type: Sequelize.STRING(160), allowNull: true },
      sourceType: { type: Sequelize.STRING(80), allowNull: true },
      sourceId: { type: Sequelize.STRING(120), allowNull: true },
      idempotencyKey: { type: Sequelize.STRING(255), allowNull: false },
      financeId: { type: Sequelize.INTEGER, allowNull: true, references: { model: "finances", key: "id" }, onDelete: "SET NULL" },
      attachmentUrl: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("cash_register_movements", ["usersId", "idempotencyKey"], { unique: true, name: "uq_cash_movement_idempotency" });
    await queryInterface.addIndex("cash_register_movements", ["sessionId", "createdAt"], { name: "idx_cash_movement_session" });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("cash_register_movements");
    await queryInterface.dropTable("cash_register_sessions");
  },
};
