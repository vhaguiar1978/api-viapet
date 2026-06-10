"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableExists = async (tableName) => {
      try {
        await queryInterface.describeTable(tableName);
        return true;
      } catch {
        return false;
      }
    };

    const addIndexIfMissing = async (tableName, fields, options = {}) => {
      const indexName = options.name || `${tableName}_${fields.join("_")}`;
      const indexes = await queryInterface.showIndex(tableName);
      if (!indexes.some((index) => index.name === indexName)) {
        await queryInterface.addIndex(tableName, fields, options);
      }
    };

    const addConstraintIfMissing = async (tableName, constraintName, options) => {
      const [constraints] = await queryInterface.sequelize.query(
        "SELECT conname FROM pg_constraint WHERE conname = :constraintName",
        { replacements: { constraintName } },
      );
      if (!constraints.length) {
        await queryInterface.addConstraint(tableName, options);
      }
    };

    if (!(await tableExists("crm_response_jobs"))) {
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
    }

    await addIndexIfMissing("crm_response_jobs", ["usersId", "status", "dueAt"], {
      name: "crm_response_jobs_users_id_status_due_at",
    });
    await addIndexIfMissing("crm_response_jobs", ["conversationId"], {
      name: "crm_response_jobs_conversation_id",
    });
    await addConstraintIfMissing("crm_response_jobs", "crm_response_jobs_inbound_message_unique", {
      fields: ["inboundMessageId"],
      type: "unique",
      name: "crm_response_jobs_inbound_message_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("crm_response_jobs");
  },
};
