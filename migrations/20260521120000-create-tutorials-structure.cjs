"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((table) => (typeof table === "string" ? table : table.tableName));

    if (!normalized.includes("tutorial_categories")) {
      await queryInterface.createTable("tutorial_categories", {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },
        slug: {
          type: Sequelize.STRING(80),
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
        color: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: "green",
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

    if (!normalized.includes("tutorial_videos")) {
      await queryInterface.createTable("tutorial_videos", {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },
        category_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: "tutorial_categories",
            key: "id",
          },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
        },
        title: {
          type: Sequelize.STRING(160),
          allowNull: false,
        },
        youtube_url: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
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

    const categoryIndexes = await queryInterface.showIndex("tutorial_categories");
    if (!categoryIndexes.some((item) => item.name === "idx_tutorial_categories_sort")) {
      await queryInterface.addIndex("tutorial_categories", ["sort_order"], {
        name: "idx_tutorial_categories_sort",
      });
    }

    const videoIndexes = await queryInterface.showIndex("tutorial_videos");
    if (!videoIndexes.some((item) => item.name === "idx_tutorial_videos_category")) {
      await queryInterface.addIndex("tutorial_videos", ["category_id"], {
        name: "idx_tutorial_videos_category",
      });
    }
    if (!videoIndexes.some((item) => item.name === "idx_tutorial_videos_sort")) {
      await queryInterface.addIndex("tutorial_videos", ["sort_order"], {
        name: "idx_tutorial_videos_sort",
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("tutorial_videos");
    await queryInterface.dropTable("tutorial_categories");
  },
};
