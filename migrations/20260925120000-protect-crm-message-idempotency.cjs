"use strict";
module.exports = {
  async up(queryInterface) {
    if (queryInterface.sequelize.getDialect() !== "postgres") return;
    await queryInterface.sequelize.query(`WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY "usersId", "providerMessageId" ORDER BY "createdAt" ASC, id ASC) AS position FROM crm_conversation_messages WHERE "providerMessageId" IS NOT NULL) DELETE FROM crm_response_jobs WHERE "inboundMessageId" IN (SELECT id FROM ranked WHERE position > 1)`);
    await queryInterface.sequelize.query(`WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY "usersId", "providerMessageId" ORDER BY "createdAt" ASC, id ASC) AS position FROM crm_conversation_messages WHERE "providerMessageId" IS NOT NULL) DELETE FROM crm_conversation_messages WHERE id IN (SELECT id FROM ranked WHERE position > 1)`);
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_messages_tenant_provider ON crm_conversation_messages ("usersId", "providerMessageId") WHERE "providerMessageId" IS NOT NULL`);
  },
  async down(queryInterface) {
    if (queryInterface.sequelize.getDialect() !== "postgres") return;
    await queryInterface.sequelize.query("DROP INDEX IF EXISTS uq_crm_messages_tenant_provider");
  },
};
