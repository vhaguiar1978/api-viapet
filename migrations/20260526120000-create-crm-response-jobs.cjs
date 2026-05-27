"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("crm_response_jobs", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      conversationId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      inboundMessageId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      providerMessageId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      sourceChannel: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "official",
      },
      messageType: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "text",
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "pending",
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      maxAttempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
      dueAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      lockedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastAttemptAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      answeredAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastError: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: {},
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    await queryInterface.addIndex("crm_response_jobs", ["usersId", "status", "dueAt"]);
    await queryInterface.addIndex("crm_response_jobs", ["conversationId"]);
    await queryInterface.addConstraint("crm_response_jobs", {
      fields: ["inboundMessageId"],
      type: "unique",
      name: "crm_response_jobs_inbound_message_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("crm_response_jobs");
  },
};
