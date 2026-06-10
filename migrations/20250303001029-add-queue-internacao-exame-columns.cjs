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

    await addColumnIfMissing("appointments", "queueInternacao", {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "Indica se o agendamento está na fila de internação",
    });

    await addColumnIfMissing("appointments", "queueExame", {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "Indica se o agendamento está na fila de exame",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("appointments", "queueInternacao");
    await queryInterface.removeColumn("appointments", "queueExame");
  },
};
