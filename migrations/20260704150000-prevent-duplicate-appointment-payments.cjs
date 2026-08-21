"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      WITH ranked AS (
        SELECT
          id,
          "financeId",
          "usersId",
          ROW_NUMBER() OVER (
            PARTITION BY
              "appointmentId",
              "usersId",
              "dueDate",
              "paymentMethod",
              ROUND(COALESCE("grossAmount", amount, 0)::numeric, 2),
              md5(COALESCE(details, '')),
              status
            ORDER BY "createdAt" ASC, id ASC
          ) AS rn
        FROM appointment_payments
        WHERE status IN ('pendente', 'pago')
      ),
      deleted_payments AS (
        DELETE FROM appointment_payments ap
        USING ranked r
        WHERE ap.id = r.id
          AND r.rn > 1
        RETURNING ap.id, ap."financeId", ap."usersId"
      )
      DELETE FROM finances f
      USING deleted_payments dp
      WHERE f."usersId" = dp."usersId"
        AND (
          f.id = dp."financeId"
          OR f.reference = CONCAT('appointment_payment:', dp.id::text)
        );
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_payments_exact_signature
      ON appointment_payments (
        "appointmentId",
        "usersId",
        "dueDate",
        "paymentMethod",
        (ROUND(COALESCE("grossAmount", amount, 0)::numeric, 2)),
        (md5(COALESCE(details, ''))),
        status
      )
      WHERE status IN ('pendente', 'pago');
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS uq_appointment_payments_exact_signature;
    `);
  },
};
