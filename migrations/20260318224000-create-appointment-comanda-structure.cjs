"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("appointment_items", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      type: {
        type: Sequelize.ENUM("service", "product", "manual"),
        allowNull: false,
      },
      serviceId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      productId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      description: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      quantity: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      unitPrice: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      discount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      observation: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex("appointment_items", ["appointmentId"], {
      name: "idx_appointment_items_appointment",
    });
    await queryInterface.addIndex("appointment_items", ["usersId"], {
      name: "idx_appointment_items_users",
    });

    await queryInterface.createTable("appointment_payments", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      dueDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      paymentMethod: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      details: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("pendente", "pago", "cancelado"),
        allowNull: false,
        defaultValue: "pendente",
      },
      paidAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      financeId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex("appointment_payments", ["appointmentId"], {
      name: "idx_appointment_payments_appointment",
    });
    await queryInterface.addIndex("appointment_payments", ["usersId"], {
      name: "idx_appointment_payments_users",
    });

    await queryInterface.createTable("appointment_status_history", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      usersId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      eventType: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "status_change",
      },
      createdBy: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex(
      "appointment_status_history",
      ["appointmentId", "createdAt"],
      {
        name: "idx_appointment_status_history_appointment",
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      "appointment_status_history",
      "idx_appointment_status_history_appointment",
    );
    await queryInterface.dropTable("appointment_status_history");

    await queryInterface.removeIndex(
      "appointment_payments",
      "idx_appointment_payments_appointment",
    );
    await queryInterface.removeIndex(
      "appointment_payments",
      "idx_appointment_payments_users",
    );
    await queryInterface.dropTable("appointment_payments");

    await queryInterface.removeIndex(
      "appointment_items",
      "idx_appointment_items_appointment",
    );
    await queryInterface.removeIndex(
      "appointment_items",
      "idx_appointment_items_users",
    );
    await queryInterface.dropTable("appointment_items");
  },
};
