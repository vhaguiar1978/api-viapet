"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("payment_method_fees")) {
      await queryInterface.createTable("payment_method_fees", {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },
        usersId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: "users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
        },
        method: {
          type: Sequelize.STRING(40),
          allowNull: false,
          comment: "Chave normalizada: dinheiro, pix, debito, credito_avista, credito_parcelado, transferencia, outros",
        },
        label: {
          type: Sequelize.STRING(80),
          allowNull: false,
        },
        feePercent: {
          type: Sequelize.DECIMAL(5, 2),
          allowNull: false,
          defaultValue: 0,
        },
        feeFixed: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
        },
        active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        sortOrder: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });
    }

    try {
      const indexes = await queryInterface.showIndex("payment_method_fees");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("uq_payment_method_fees_user_method")) {
        await queryInterface.addIndex("payment_method_fees", ["usersId", "method"], {
          name: "uq_payment_method_fees_user_method",
          unique: true,
        });
      }
      if (!has("idx_payment_method_fees_user")) {
        await queryInterface.addIndex("payment_method_fees", ["usersId"], {
          name: "idx_payment_method_fees_user",
        });
      }
    } catch (err) {
      console.warn("Aviso ao criar indices de payment_method_fees:", err.message);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("payment_method_fees");
  },
};
