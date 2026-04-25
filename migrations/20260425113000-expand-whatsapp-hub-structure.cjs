"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const connectionTable = await queryInterface.describeTable("whatsapp_connections");
    const messageTable = await queryInterface.describeTable("whatsapp_messages");
    const templateTable = await queryInterface.describeTable("whatsapp_templates");
    const webhookLogTable = await queryInterface.describeTable("whatsapp_webhook_logs");

    if (!connectionTable.integrationMode) {
      await queryInterface.addColumn("whatsapp_connections", "integrationMode", {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "simple",
      });
    }

    if (!connectionTable.businessId) {
      await queryInterface.addColumn("whatsapp_connections", "businessId", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!connectionTable.businessName) {
      await queryInterface.addColumn("whatsapp_connections", "businessName", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!connectionTable.connectedAt) {
      await queryInterface.addColumn("whatsapp_connections", "connectedAt", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!messageTable.phone) {
      await queryInterface.addColumn("whatsapp_messages", "phone", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!messageTable.origin) {
      await queryInterface.addColumn("whatsapp_messages", "origin", {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "api",
      });
    }

    if (!messageTable.externalMessageId) {
      await queryInterface.addColumn("whatsapp_messages", "externalMessageId", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!messageTable.templateName) {
      await queryInterface.addColumn("whatsapp_messages", "templateName", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!messageTable.errorMessage) {
      await queryInterface.addColumn("whatsapp_messages", "errorMessage", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    if (!templateTable.title) {
      await queryInterface.addColumn("whatsapp_templates", "title", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!templateTable.body) {
      await queryInterface.addColumn("whatsapp_templates", "body", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    if (!templateTable.variables) {
      await queryInterface.addColumn("whatsapp_templates", "variables", {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      });
    }

    if (!templateTable.active) {
      await queryInterface.addColumn("whatsapp_templates", "active", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
    }

    if (!templateTable.isSystem) {
      await queryInterface.addColumn("whatsapp_templates", "isSystem", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    if (!templateTable.sortOrder) {
      await queryInterface.addColumn("whatsapp_templates", "sortOrder", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }

    if (!webhookLogTable.logType) {
      await queryInterface.addColumn("whatsapp_webhook_logs", "logType", {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "event",
      });
    }

    if (!webhookLogTable.description) {
      await queryInterface.addColumn("whatsapp_webhook_logs", "description", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const safeRemove = async (table, column) => {
      const current = await queryInterface.describeTable(table);
      if (current[column]) {
        await queryInterface.removeColumn(table, column);
      }
    };

    await safeRemove("whatsapp_webhook_logs", "description");
    await safeRemove("whatsapp_webhook_logs", "logType");
    await safeRemove("whatsapp_templates", "sortOrder");
    await safeRemove("whatsapp_templates", "isSystem");
    await safeRemove("whatsapp_templates", "active");
    await safeRemove("whatsapp_templates", "variables");
    await safeRemove("whatsapp_templates", "body");
    await safeRemove("whatsapp_templates", "title");
    await safeRemove("whatsapp_messages", "errorMessage");
    await safeRemove("whatsapp_messages", "templateName");
    await safeRemove("whatsapp_messages", "externalMessageId");
    await safeRemove("whatsapp_messages", "origin");
    await safeRemove("whatsapp_messages", "phone");
    await safeRemove("whatsapp_connections", "connectedAt");
    await safeRemove("whatsapp_connections", "businessName");
    await safeRemove("whatsapp_connections", "businessId");
    await safeRemove("whatsapp_connections", "integrationMode");
  },
};
