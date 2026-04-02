"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("appointments");

    if (!table.sellerName) {
      await queryInterface.addColumn("appointments", "sellerName", {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Nome livre do responsavel exibido na agenda",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("appointments");

    if (table.sellerName) {
      await queryInterface.removeColumn("appointments", "sellerName");
    }
  },
};
