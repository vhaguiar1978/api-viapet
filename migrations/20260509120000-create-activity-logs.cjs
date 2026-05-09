"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalizedTables = tables.map((table) =>
      typeof table === "string" ? table : table.tableName,
    );

    if (!normalizedTables.includes("activity_logs")) {
      await queryInterface.createTable("activity_logs", {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },
        tenant_id: {
          type: Sequelize.UUID,
          allowNull: true,
        },
        user_id: {
          type: Sequelize.UUID,
          allowNull: true,
        },
        nome_usuario: {
          type: Sequelize.STRING(180),
          allowNull: true,
        },
        modulo: {
          type: Sequelize.STRING(60),
          allowNull: false,
        },
        acao: {
          type: Sequelize.STRING(80),
          allowNull: false,
        },
        descricao: {
          type: Sequelize.STRING(500),
          allowNull: true,
        },
        entidade_tipo: {
          type: Sequelize.STRING(60),
          allowNull: true,
        },
        entidade_id: {
          type: Sequelize.STRING(60),
          allowNull: true,
        },
        metadata_json: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        ip: {
          type: Sequelize.STRING(60),
          allowNull: true,
        },
        navegador: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });
    }

    const indexes = await queryInterface.showIndex("activity_logs");
    const hasIndex = (name) => indexes.some((index) => index.name === name);

    if (!hasIndex("idx_activity_logs_tenant_created")) {
      await queryInterface.addIndex("activity_logs", ["tenant_id", "created_at"], {
        name: "idx_activity_logs_tenant_created",
      });
    }
    if (!hasIndex("idx_activity_logs_user_created")) {
      await queryInterface.addIndex("activity_logs", ["user_id", "created_at"], {
        name: "idx_activity_logs_user_created",
      });
    }
    if (!hasIndex("idx_activity_logs_modulo_acao")) {
      await queryInterface.addIndex("activity_logs", ["modulo", "acao"], {
        name: "idx_activity_logs_modulo_acao",
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("activity_logs");
  },
};
