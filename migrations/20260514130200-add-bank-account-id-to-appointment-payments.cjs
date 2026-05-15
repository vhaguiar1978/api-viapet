"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("appointment_payments");
    if (!table.bankAccountId) {
      await queryInterface.addColumn("appointment_payments", "bankAccountId", {
        type: Sequelize.UUID,
        allowNull: true,
        comment: "Conta bancária onde o pagamento foi recebido",
      });
    }

    try {
      const indexes = await queryInterface.showIndex("appointment_payments");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("idx_appointment_payments_bank_account")) {
        await queryInterface.addIndex("appointment_payments", ["bankAccountId"], {
          name: "idx_appointment_payments_bank_account",
        });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indice em appointment_payments:", idxErr.message);
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("appointment_payments");
    if (table.bankAccountId) await queryInterface.removeColumn("appointment_payments", "bankAccountId");
  },
};
