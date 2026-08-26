"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("sellers", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      name: { type: Sequelize.STRING(160), allowNull: false },
      phone: { type: Sequelize.STRING(32) },
      whatsapp: { type: Sequelize.STRING(32) },
      email: { type: Sequelize.STRING(180), allowNull: false },
      document: { type: Sequelize.STRING(32) },
      joinedAt: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "active" },
      code: { type: Sequelize.STRING(64), allowNull: false },
      notes: { type: Sequelize.TEXT },
      passwordHash: { type: Sequelize.STRING },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("sellers", ["systemId", "code"], { unique: true, name: "uq_sellers_system_code" });
    await queryInterface.addIndex("sellers", ["systemId", "email"], { unique: true, name: "uq_sellers_system_email" });

    await queryInterface.createTable("commission_rules", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      sellerId: { type: Sequelize.UUID, allowNull: false, references: { model: "sellers", key: "id" }, onDelete: "CASCADE" },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      planId: { type: Sequelize.STRING(64) },
      calculationType: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "percentage" },
      value: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      recurrenceType: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "recurring" },
      maxMonths: { type: Sequelize.INTEGER },
      startsAt: { type: Sequelize.DATEONLY },
      endsAt: { type: Sequelize.DATEONLY },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("commission_rules", ["sellerId", "systemId", "planId"], { name: "idx_commission_rules_lookup" });

    await queryInterface.createTable("seller_customers", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      sellerId: { type: Sequelize.UUID, allowNull: false, references: { model: "sellers", key: "id" }, onDelete: "RESTRICT" },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      source: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "seller" },
      sellerCodeSnapshot: { type: Sequelize.STRING(64), allowNull: false },
      attributedAt: { type: Sequelize.DATE, allowNull: false },
      referralId: { type: Sequelize.UUID },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("seller_customers", ["systemId", "userId"], { unique: true, name: "uq_seller_customers_first_attribution" });
    await queryInterface.addIndex("seller_customers", ["sellerId"], { name: "idx_seller_customers_seller" });

    await queryInterface.createTable("referrals", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      sellerId: { type: Sequelize.UUID, allowNull: false, references: { model: "sellers", key: "id" }, onDelete: "CASCADE" },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      sessionId: { type: Sequelize.STRING(128), allowNull: false },
      ipHash: { type: Sequelize.STRING(128) },
      utmSource: { type: Sequelize.STRING(128) },
      utmMedium: { type: Sequelize.STRING(128) },
      utmCampaign: { type: Sequelize.STRING(128) },
      landingPage: { type: Sequelize.TEXT },
      firstAccessAt: { type: Sequelize.DATE, allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      registeredUserId: { type: Sequelize.UUID },
      registeredAt: { type: Sequelize.DATE },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("referrals", ["systemId", "sessionId"], { unique: true, name: "uq_referrals_session" });

    await queryInterface.createTable("commissions", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      sellerId: { type: Sequelize.UUID, allowNull: false, references: { model: "sellers", key: "id" }, onDelete: "RESTRICT" },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "RESTRICT" },
      paymentHistoryId: { type: Sequelize.UUID, references: { model: "payment_history", key: "id" }, onDelete: "SET NULL" },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      externalPaymentId: { type: Sequelize.STRING(128), allowNull: false },
      planId: { type: Sequelize.STRING(64) },
      paymentAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      calculationTypeSnapshot: { type: Sequelize.STRING(24), allowNull: false },
      ruleValueSnapshot: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      recurrenceTypeSnapshot: { type: Sequelize.STRING(24), allowNull: false },
      commissionAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "pending" },
      approvedAt: { type: Sequelize.DATE },
      paidAt: { type: Sequelize.DATE },
      cancelledAt: { type: Sequelize.DATE },
      cancellationReason: { type: Sequelize.TEXT },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("commissions", ["systemId", "externalPaymentId"], { unique: true, name: "uq_commissions_payment" });
    await queryInterface.addIndex("commissions", ["sellerId", "status", "createdAt"], { name: "idx_commissions_seller_status" });

    await queryInterface.createTable("commission_payments", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      sellerId: { type: Sequelize.UUID, allowNull: false, references: { model: "sellers", key: "id" }, onDelete: "RESTRICT" },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      paidAt: { type: Sequelize.DATE, allowNull: false }, paymentMethod: { type: Sequelize.STRING(64), allowNull: false },
      notes: { type: Sequelize.TEXT }, proofUrl: { type: Sequelize.TEXT }, createdBy: { type: Sequelize.UUID, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addColumn("commissions", "commissionPaymentId", { type: Sequelize.UUID, allowNull: true });

    await queryInterface.createTable("seller_audit_logs", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      systemId: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "VIAPET" },
      action: { type: Sequelize.STRING(64), allowNull: false },
      userId: { type: Sequelize.UUID },
      previousSellerId: { type: Sequelize.UUID },
      newSellerId: { type: Sequelize.UUID },
      actorUserId: { type: Sequelize.UUID },
      reason: { type: Sequelize.TEXT },
      metadata: { type: Sequelize.JSON },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    for (const table of ["seller_audit_logs", "commission_payments", "commissions", "referrals", "seller_customers", "commission_rules", "sellers"]) {
      await queryInterface.dropTable(table);
    }
  },
};
