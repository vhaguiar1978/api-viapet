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

    if (!(await tableExists("crm_ai_subscriptions"))) {
      await queryInterface.createTable("crm_ai_subscriptions", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("pending", "active", "cancelled", "expired", "suspended"),
        allowNull: false,
        defaultValue: "pending",
      },
      payment_status: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 49.9,
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: "BRL",
      },
      payment_preference_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      payment_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      external_reference: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      activated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      next_billing_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      });
    }

    await addIndexIfMissing("crm_ai_subscriptions", ["user_id"]);
    await addIndexIfMissing("crm_ai_subscriptions", ["status"]);
    await addIndexIfMissing("crm_ai_subscriptions", ["external_reference"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("crm_ai_subscriptions");
  },
};
