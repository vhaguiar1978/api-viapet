"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("appointments", "queueInternacao", {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "Indica se o agendamento está na fila de internação",
    });

    await queryInterface.addColumn("appointments", "queueExame", {
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
