"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("whatsapp_connections", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      companyId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      wabaId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      phoneNumberId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      businessPhone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      verifyToken: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      accessTokenEncrypted: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      accessTokenLast4: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      webhookVerified: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "disconnected",
      },
      lastEventAt: {
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

    await queryInterface.createTable("whatsapp_messages", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      companyId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      conversationId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      customerId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      petId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      metaMessageId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      direction: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "inbound",
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
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mimeType: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "received",
      },
      rawPayload: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: {},
      },
      sentAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      deliveredAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      readAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      failedAt: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await queryInterface.createTable("whatsapp_webhook_logs", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      companyId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      payloadJson: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: {},
      },
      eventType: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "unknown",
      },
      processed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    await queryInterface.createTable("whatsapp_templates", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      companyId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      templateName: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      language: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "pt_BR",
      },
      category: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "active",
      },
      components: {
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

    await queryInterface.addIndex("whatsapp_connections", ["companyId"], {
      unique: true,
      name: "whatsapp_connections_company_id_unique",
    });
    await queryInterface.addIndex("whatsapp_connections", ["phoneNumberId"], {
      unique: true,
      name: "whatsapp_connections_phone_number_id_unique",
    });
    await queryInterface.addIndex("whatsapp_messages", ["companyId"]);
    await queryInterface.addIndex("whatsapp_messages", ["conversationId"]);
    await queryInterface.addIndex("whatsapp_messages", ["metaMessageId"]);
    await queryInterface.addIndex("whatsapp_messages", ["status"]);
    await queryInterface.addIndex("whatsapp_webhook_logs", ["companyId"]);
    await queryInterface.addIndex("whatsapp_webhook_logs", ["processed"]);
    await queryInterface.addIndex("whatsapp_templates", ["companyId"]);
    await queryInterface.addIndex("whatsapp_templates", ["templateName"]);

    const conversationTable = await queryInterface.describeTable("crm_conversations");
    if (!conversationTable.companyId) {
      await queryInterface.addColumn("crm_conversations", "companyId", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await queryInterface.sequelize.query(
        'UPDATE "crm_conversations" SET "companyId" = "usersId" WHERE "companyId" IS NULL;',
      ).catch(() => {});
      await queryInterface.addIndex("crm_conversations", ["companyId"]);
    }
    if (!conversationTable.stage) {
      await queryInterface.addColumn("crm_conversations", "stage", {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "prospectar",
      });
      await queryInterface.addIndex("crm_conversations", ["stage"]);
    }

    const messageTable = await queryInterface.describeTable("crm_conversation_messages");
    if (!messageTable.companyId) {
      await queryInterface.addColumn("crm_conversation_messages", "companyId", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await queryInterface.sequelize.query(
        'UPDATE "crm_conversation_messages" SET "companyId" = "usersId" WHERE "companyId" IS NULL;',
      ).catch(() => {});
      await queryInterface.addIndex("crm_conversation_messages", ["companyId"]);
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("crm_conversation_messages", "companyId").catch(() => {});
    await queryInterface.removeColumn("crm_conversations", "stage").catch(() => {});
    await queryInterface.removeColumn("crm_conversations", "companyId").catch(() => {});
    await queryInterface.dropTable("whatsapp_templates").catch(() => {});
    await queryInterface.dropTable("whatsapp_webhook_logs").catch(() => {});
    await queryInterface.dropTable("whatsapp_messages").catch(() => {});
    await queryInterface.dropTable("whatsapp_connections").catch(() => {});
  },
};
