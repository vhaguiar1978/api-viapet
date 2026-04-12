"use strict";

const CONSTRAINTS = [
  {
    table: "appointment_items",
    name: "fk_appointment_items_appointment",
    fields: ["appointmentId"],
    references: {
      table: "appointments",
      field: "id",
    },
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  },
  {
    table: "appointment_payments",
    name: "fk_appointment_payments_appointment",
    fields: ["appointmentId"],
    references: {
      table: "appointments",
      field: "id",
    },
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  },
  {
    table: "appointment_payments",
    name: "fk_appointment_payments_finance",
    fields: ["financeId"],
    references: {
      table: "finances",
      field: "id",
    },
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  },
  {
    table: "appointment_status_history",
    name: "fk_appointment_status_history_appointment",
    fields: ["appointmentId"],
    references: {
      table: "appointments",
      field: "id",
    },
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  },
];

async function runCleanup(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();

  if (dialect === "postgres") {
    await queryInterface.sequelize.query(`
      DELETE FROM appointment_items ai
      WHERE NOT EXISTS (
        SELECT 1 FROM appointments a WHERE a.id = ai."appointmentId"
      )
    `);
    await queryInterface.sequelize.query(`
      DELETE FROM appointment_payments ap
      WHERE NOT EXISTS (
        SELECT 1 FROM appointments a WHERE a.id = ap."appointmentId"
      )
    `);
    await queryInterface.sequelize.query(`
      DELETE FROM appointment_status_history ash
      WHERE NOT EXISTS (
        SELECT 1 FROM appointments a WHERE a.id = ash."appointmentId"
      )
    `);
    await queryInterface.sequelize.query(`
      UPDATE appointment_payments ap
      SET "financeId" = NULL
      WHERE "financeId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM finances f WHERE f.id = ap."financeId"
        )
    `);
  } else {
    await queryInterface.sequelize.query(`
      DELETE ai FROM appointment_items ai
      LEFT JOIN appointments a ON a.id = ai.appointmentId
      WHERE a.id IS NULL
    `);
    await queryInterface.sequelize.query(`
      DELETE ap FROM appointment_payments ap
      LEFT JOIN appointments a ON a.id = ap.appointmentId
      WHERE a.id IS NULL
    `);
    await queryInterface.sequelize.query(`
      DELETE ash FROM appointment_status_history ash
      LEFT JOIN appointments a ON a.id = ash.appointmentId
      WHERE a.id IS NULL
    `);
    await queryInterface.sequelize.query(`
      UPDATE appointment_payments ap
      LEFT JOIN finances f ON f.id = ap.financeId
      SET ap.financeId = NULL
      WHERE ap.financeId IS NOT NULL
        AND f.id IS NULL
    `);
  }
}

async function addConstraintSafely(queryInterface, constraint) {
  try {
    await queryInterface.addConstraint(constraint.table, {
      fields: constraint.fields,
      type: "foreign key",
      name: constraint.name,
      references: constraint.references,
      onDelete: constraint.onDelete,
      onUpdate: constraint.onUpdate,
    });
  } catch (error) {
    const message = String(error?.message || "");
    const alreadyExists =
      message.includes(constraint.name) ||
      message.includes("already exists") ||
      message.includes("Duplicate") ||
      message.includes("duplicate");

    if (!alreadyExists) {
      throw error;
    }
  }
}

module.exports = {
  async up(queryInterface) {
    await runCleanup(queryInterface);

    for (const constraint of CONSTRAINTS) {
      await addConstraintSafely(queryInterface, constraint);
    }
  },

  async down(queryInterface) {
    for (const constraint of [...CONSTRAINTS].reverse()) {
      try {
        await queryInterface.removeConstraint(constraint.table, constraint.name);
      } catch (error) {
        const message = String(error?.message || "");
        const missingConstraint =
          message.includes("does not exist") ||
          message.includes("Unknown constraint") ||
          message.includes("not found");

        if (!missingConstraint) {
          throw error;
        }
      }
    }
  },
};
