"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const addColumnIfMissing = async (tableName, columnName, definition) => {
      const table = await queryInterface.describeTable(tableName);
      if (!table[columnName]) {
        await queryInterface.addColumn(tableName, columnName, definition);
      }
    };

    await addColumnIfMissing("appointment_payments", "grossAmount", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await addColumnIfMissing("appointment_payments", "feePercentage", {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await addColumnIfMissing("appointment_payments", "feeAmount", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await addColumnIfMissing("appointment_payments", "netAmount", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await addColumnIfMissing("finances", "grossAmount", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });

    await addColumnIfMissing("finances", "feePercentage", {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
    });

    await addColumnIfMissing("finances", "feeAmount", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });

    await addColumnIfMissing("finances", "netAmount", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("appointment_payments", "grossAmount");
    await queryInterface.removeColumn("appointment_payments", "feePercentage");
    await queryInterface.removeColumn("appointment_payments", "feeAmount");
    await queryInterface.removeColumn("appointment_payments", "netAmount");

    await queryInterface.removeColumn("finances", "grossAmount");
    await queryInterface.removeColumn("finances", "feePercentage");
    await queryInterface.removeColumn("finances", "feeAmount");
    await queryInterface.removeColumn("finances", "netAmount");
  },
};
