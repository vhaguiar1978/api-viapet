"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const table = await queryInterface.describeTable("finances");

    if (!table.installmentIndex) {
      await queryInterface.addColumn("finances", "installmentIndex", {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    if (!table.installmentTotal) {
      await queryInterface.addColumn("finances", "installmentTotal", {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    if (dialect === "postgres") {
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumlabel = 'parcelado'
              AND enumtypid = (
                SELECT oid FROM pg_type WHERE typname = 'enum_finances_frequency'
              )
          ) THEN
            ALTER TYPE "enum_finances_frequency" ADD VALUE 'parcelado';
          END IF;
        END$$;
      `);
    } else if (dialect === "mysql" || dialect === "mariadb") {
      await queryInterface.sequelize.query(
        "ALTER TABLE `finances` MODIFY COLUMN `frequency` ENUM('unico','mensal','anual','parcelado') NULL",
      );
    } else {
      await queryInterface.changeColumn("finances", "frequency", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const table = await queryInterface.describeTable("finances");

    if (table.installmentIndex) {
      await queryInterface.removeColumn("finances", "installmentIndex");
    }

    if (table.installmentTotal) {
      await queryInterface.removeColumn("finances", "installmentTotal");
    }

    if (dialect === "mysql" || dialect === "mariadb") {
      await queryInterface.sequelize.query(
        "UPDATE `finances` SET `frequency` = 'unico' WHERE `frequency` = 'parcelado'",
      );
      await queryInterface.sequelize.query(
        "ALTER TABLE `finances` MODIFY COLUMN `frequency` ENUM('unico','mensal','anual') NULL",
      );
    }
    // Postgres: removing an enum value is non-trivial and risky on existing data; skip in down().
  },
};
