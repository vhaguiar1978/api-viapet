"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("crm_conversations", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      customerId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      petId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      assignedUserId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      channel: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "whatsapp",
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "pending",
      },
      source: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "crm",
      },
      title: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      customerName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      petName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      avatarUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      lastMessagePreview: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      lastMessageAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastInboundAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastOutboundAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      unreadCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      isPinned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isArchived: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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

    await queryInterface.createTable("crm_conversation_messages", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      conversationId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      customerId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      petId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      authorUserId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      direction: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "inbound",
      },
      channel: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "whatsapp",
      },
      messageType: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "text",
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mediaUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      mimeType: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      providerMessageId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "received",
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      sentAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      receivedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      readAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      payload: {
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

    await queryInterface.addIndex("crm_conversations", ["usersId"]);
    await queryInterface.addIndex("crm_conversations", ["status"]);
    await queryInterface.addIndex("crm_conversations", ["phone"]);
    await queryInterface.addIndex("crm_conversations", ["lastMessageAt"]);
    await queryInterface.addIndex("crm_conversation_messages", ["conversationId"]);
    await queryInterface.addIndex("crm_conversation_messages", ["usersId"]);
    await queryInterface.addIndex("crm_conversation_messages", ["providerMessageId"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("crm_conversation_messages");
    await queryInterface.dropTable("crm_conversations");
  },
};
