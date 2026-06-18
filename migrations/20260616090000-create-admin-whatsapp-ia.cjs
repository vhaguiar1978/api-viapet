"use strict";

const tableExists = async (queryInterface, tableName) => {
  const tables = await queryInterface.showAllTables();
  return tables.map((item) => (typeof item === "object" ? item.tableName || item.name : item)).includes(tableName);
};

const addColumnIfMissing = async (queryInterface, Sequelize, tableName, columnName, definition) => {
  if (!(await tableExists(queryInterface, tableName))) return;
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
};

const addIndexSafe = async (queryInterface, tableName, fields, options = {}) => {
  if (!(await tableExists(queryInterface, tableName))) return;
  try {
    await queryInterface.addIndex(tableName, fields, options);
  } catch (error) {
    if (!/already exists|Duplicate key name|relation .* exists/i.test(String(error?.message || ""))) {
      throw error;
    }
  }
};

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("whatsapp_conversations", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: { type: Sequelize.UUID, allowNull: false },
      userId: { type: Sequelize.UUID, allowNull: true },
      phoneNumber: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "open" },
      attendanceMode: { type: Sequelize.STRING, allowNull: false, defaultValue: "ai" },
      assignedUserId: { type: Sequelize.UUID, allowNull: true },
      lastMessageAt: { type: Sequelize.DATE, allowNull: true },
      lastUserMessageAt: { type: Sequelize.DATE, allowNull: true },
      lastAiMessageAt: { type: Sequelize.DATE, allowNull: true },
      aiPaused: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      result: { type: Sequelize.STRING, allowNull: true },
      summary: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.createTable("inactive_user_automations", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: { type: Sequelize.UUID, allowNull: false },
      userId: { type: Sequelize.UUID, allowNull: false },
      inactiveSince: { type: Sequelize.DATE, allowNull: true },
      inactivityDays: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      currentStep: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      nextContactAt: { type: Sequelize.DATE, allowNull: true },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "pending" },
      lastContactAt: { type: Sequelize.DATE, allowNull: true },
      repliedAt: { type: Sequelize.DATE, allowNull: true },
      returnedAt: { type: Sequelize.DATE, allowNull: true },
      convertedAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.createTable("ai_knowledge", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: { type: Sequelize.UUID, allowNull: false },
      title: { type: Sequelize.STRING, allowNull: false },
      category: { type: Sequelize.STRING, allowNull: false, defaultValue: "Perguntas frequentes" },
      questions: { type: Sequelize.TEXT, allowNull: true },
      content: { type: Sequelize.TEXT, allowNull: false },
      instructions: { type: Sequelize.TEXT, allowNull: true },
      keywords: { type: Sequelize.TEXT, allowNull: true },
      internalLink: { type: Sequelize.STRING, allowNull: true },
      videoLink: { type: Sequelize.STRING, allowNull: true },
      relatedPlan: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "draft" },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.createTable("whatsapp_consents", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: { type: Sequelize.UUID, allowNull: false },
      userId: { type: Sequelize.UUID, allowNull: false },
      phoneNumber: { type: Sequelize.STRING, allowNull: true },
      consentStatus: { type: Sequelize.STRING, allowNull: false, defaultValue: "pending" },
      consentSource: { type: Sequelize.STRING, allowNull: true },
      consentAt: { type: Sequelize.DATE, allowNull: true },
      optOutAt: { type: Sequelize.DATE, allowNull: true },
      optOutReason: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.createTable("ai_usage_logs", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: { type: Sequelize.UUID, allowNull: false },
      conversationId: { type: Sequelize.UUID, allowNull: true },
      userId: { type: Sequelize.UUID, allowNull: true },
      model: { type: Sequelize.STRING, allowNull: true },
      promptTokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      completionTokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      totalTokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      estimatedCost: { type: Sequelize.DECIMAL(12, 6), allowNull: false, defaultValue: 0 },
      success: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      errorMessage: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await addColumnIfMissing(queryInterface, Sequelize, "whatsapp_messages", "senderType", { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, Sequelize, "whatsapp_messages", "content", { type: Sequelize.TEXT, allowNull: true });
    await addColumnIfMissing(queryInterface, Sequelize, "whatsapp_messages", "deliveryStatus", { type: Sequelize.STRING, allowNull: true });

    await addIndexSafe(queryInterface, "whatsapp_conversations", ["organizationId", "status"], { name: "idx_whatsapp_conversations_org_status" });
    await addIndexSafe(queryInterface, "whatsapp_conversations", ["organizationId", "lastMessageAt"], { name: "idx_whatsapp_conversations_org_last_message" });
    await addIndexSafe(queryInterface, "inactive_user_automations", ["organizationId", "status", "nextContactAt"], { name: "idx_inactive_automations_due" });
    await addIndexSafe(queryInterface, "inactive_user_automations", ["organizationId", "userId"], { name: "idx_inactive_automations_user" });
    await addIndexSafe(queryInterface, "ai_knowledge", ["organizationId", "status", "category"], { name: "idx_ai_knowledge_org_status_category" });
    await addIndexSafe(queryInterface, "whatsapp_consents", ["organizationId", "userId"], { name: "idx_whatsapp_consents_user" });
    await addIndexSafe(queryInterface, "ai_usage_logs", ["organizationId", "createdAt"], { name: "idx_ai_usage_logs_org_created" });
    await addIndexSafe(queryInterface, "whatsapp_messages", ["companyId", "externalMessageId"], { name: "idx_whatsapp_messages_company_external" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ai_usage_logs");
    await queryInterface.dropTable("whatsapp_consents");
    await queryInterface.dropTable("ai_knowledge");
    await queryInterface.dropTable("inactive_user_automations");
    await queryInterface.dropTable("whatsapp_conversations");
  },
};
