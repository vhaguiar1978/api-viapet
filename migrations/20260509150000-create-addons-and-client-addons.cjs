"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("addons")) {
      await queryInterface.createTable("addons", {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },
        key: {
          type: Sequelize.STRING(60),
          allowNull: false,
          unique: true,
        },
        name: {
          type: Sequelize.STRING(120),
          allowNull: false,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        default_amount: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
        },
        billing_cycle: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: "monthly",
        },
        active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        sort_order: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });
    }

    if (!normalized.includes("client_addons")) {
      await queryInterface.createTable("client_addons", {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },
        client_user_id: {
          type: Sequelize.UUID,
          allowNull: false,
        },
        addon_id: {
          type: Sequelize.UUID,
          allowNull: false,
        },
        addon_key: {
          type: Sequelize.STRING(60),
          allowNull: false,
        },
        status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: "active",
        },
        amount_override: {
          type: Sequelize.DECIMAL(10, 2),
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
        last_payment_at: {
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
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });
    }

    const addonIndexes = await queryInterface.showIndex("client_addons");
    const has = (name) => addonIndexes.some((i) => i.name === name);
    if (!has("idx_client_addons_user")) {
      await queryInterface.addIndex("client_addons", ["client_user_id"], {
        name: "idx_client_addons_user",
      });
    }
    if (!has("idx_client_addons_addon")) {
      await queryInterface.addIndex("client_addons", ["addon_id"], {
        name: "idx_client_addons_addon",
      });
    }
    if (!has("idx_client_addons_status")) {
      await queryInterface.addIndex("client_addons", ["status"], {
        name: "idx_client_addons_status",
      });
    }
    if (!has("uq_client_addons_user_addon")) {
      await queryInterface.addIndex("client_addons", ["client_user_id", "addon_id"], {
        name: "uq_client_addons_user_addon",
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("client_addons");
    await queryInterface.dropTable("addons");
  },
};
