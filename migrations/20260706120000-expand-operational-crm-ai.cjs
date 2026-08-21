"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const safeDescribe = async (table) => {
      try {
        return await queryInterface.describeTable(table);
      } catch {
        return null;
      }
    };

    const safeAddColumn = async (table, column, definition) => {
      const current = await safeDescribe(table);
      if (current && !current[column]) {
        await queryInterface.addColumn(table, column, definition);
      }
    };

    const safeCreateTable = async (table, definition, indexes = []) => {
      const current = await safeDescribe(table);
      if (current) return;
      await queryInterface.createTable(table, definition);
      for (const index of indexes) {
        await queryInterface.addIndex(table, index.fields, index.options || {});
      }
    };

    const timestamps = {
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
    };

    const uuidPk = {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
    };

    await safeAddColumn("crm_conversations", "currentIntent", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn("crm_conversations", "summary", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await safeAddColumn("crm_conversations", "collectedFields", {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: {},
    });
    await safeAddColumn("crm_conversations", "missingFields", {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: [],
    });
    await safeAddColumn("crm_conversations", "aiEnabled", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await safeAddColumn("crm_conversations", "queueKey", {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "geral",
    });
    await safeAddColumn("crm_conversations", "assignedAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await safeAddColumn("crm_conversation_messages", "whatsappMessageId", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn("crm_conversation_messages", "senderType", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn("crm_conversation_messages", "role", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn("crm_conversation_messages", "content", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await safeAddColumn("crm_conversation_messages", "mediaType", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn("crm_conversation_messages", "metadata", {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: {},
    });

    await safeAddColumn("crm_ai_action_logs", "actionName", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn("crm_ai_action_logs", "actionPayload", {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: {},
    });
    await safeAddColumn("crm_ai_action_logs", "actionResult", {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: {},
    });
    await safeAddColumn("crm_ai_action_logs", "confidenceScore", {
      type: Sequelize.DECIMAL(5, 4),
      allowNull: true,
    });
    await safeAddColumn("crm_ai_action_logs", "errorMessage", {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await safeAddColumn("services", "requiresGroomer", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await safeAddColumn("services", "blocksParallelServices", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await safeAddColumn("services", "maxParallelQuantity", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
    await safeAddColumn("services", "aiCanSchedule", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await safeAddColumn("services", "aiCanOffer", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    await safeAddColumn("pets", "approxWeight", { type: Sequelize.STRING, allowNull: true });
    await safeAddColumn("pets", "size", { type: Sequelize.STRING, allowNull: true });
    await safeAddColumn("pets", "behavior", { type: Sequelize.TEXT, allowNull: true });
    await safeAddColumn("pets", "restrictions", { type: Sequelize.TEXT, allowNull: true });
    await safeAddColumn("pets", "treatEnabled", { type: Sequelize.BOOLEAN, allowNull: true });
    await safeAddColumn("pets", "productPreferences", { type: Sequelize.JSON, allowNull: false, defaultValue: [] });
    await safeAddColumn("pets", "photoUrl", { type: Sequelize.STRING, allowNull: true });

    await safeAddColumn("appointments", "paymentStatus", {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "pending",
    });
    await safeAddColumn("appointments", "paymentAmount", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await safeAddColumn("appointments", "paidAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await safeAddColumn("appointments", "receivableId", {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await safeAddColumn("appointments", "paymentProofId", {
      type: Sequelize.UUID,
      allowNull: true,
    });

    await safeCreateTable("ai_settings", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      aiActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      allowAiSchedule: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      allowAiRegisterNewCustomer: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      allowAiRegisterPet: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      allowAiOfferExtraServices: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      allowAiOfferProducts: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      allowAiReadPaymentProof: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      allowAiChargeCustomers: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      allowAiMonthlyReport: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      monthlyReportDay: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      monthlyReportTime: { type: Sequelize.TIME, allowNull: false, defaultValue: "09:00:00" },
      humanTransferPhone: { type: Sequelize.STRING, allowNull: true },
      defaultAiTone: { type: Sequelize.STRING, allowNull: false, defaultValue: "profissional" },
      settings: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, [{ fields: ["usersId"], options: { unique: true } }]);

    await safeCreateTable("ai_grooming_settings", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      allowAiGroomingSchedule: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      groomingHumanPhone: { type: Sequelize.STRING, allowNull: true },
      defaultGroomingDurationMinutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 120 },
      maxGroomingsSameSlot: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      allowOtherServicesDuringGrooming: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      maxOtherPetsSameSlot: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 2 },
      ...timestamps,
    }, [{ fields: ["usersId"], options: { unique: true } }]);

    await safeCreateTable("ai_service_offer_settings", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      maxOffersPerConversation: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 2 },
      offerTiming: { type: Sequelize.STRING, allowNull: false, defaultValue: "after_schedule" },
      ...timestamps,
    }, [{ fields: ["usersId"], options: { unique: true } }]);

    await safeCreateTable("ai_service_offers", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      serviceId: { type: Sequelize.UUID, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      offerName: { type: Sequelize.STRING, allowNull: false },
      offerMessage: { type: Sequelize.TEXT, allowNull: true },
      triggerServiceId: { type: Sequelize.UUID, allowNull: true },
      triggerKeywords: { type: Sequelize.JSON, allowNull: false, defaultValue: [] },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...timestamps,
    }, [{ fields: ["usersId"] }, { fields: ["serviceId"] }]);

    await safeCreateTable("customer_registration_sessions", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      conversationId: { type: Sequelize.UUID, allowNull: true },
      contactPhone: { type: Sequelize.STRING, allowNull: false },
      customerId: { type: Sequelize.UUID, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "open" },
      formToken: { type: Sequelize.STRING, allowNull: false },
      formUrl: { type: Sequelize.STRING, allowNull: true },
      draft: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      submittedAt: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    }, [{ fields: ["usersId"] }, { fields: ["formToken"], options: { unique: true } }]);

    await safeCreateTable("product_recommendation_rules", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      productId: { type: Sequelize.UUID, allowNull: false },
      triggerType: { type: Sequelize.STRING, allowNull: false },
      triggerValue: { type: Sequelize.STRING, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...timestamps,
    }, [{ fields: ["usersId"] }, { fields: ["productId"] }]);

    await safeCreateTable("receivables", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      customerId: { type: Sequelize.UUID, allowNull: false },
      petId: { type: Sequelize.UUID, allowNull: true },
      appointmentId: { type: Sequelize.UUID, allowNull: true },
      packageId: { type: Sequelize.STRING, allowNull: true },
      originType: { type: Sequelize.STRING, allowNull: false, defaultValue: "manual" },
      description: { type: Sequelize.TEXT, allowNull: false },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      dueDate: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "open" },
      paidAt: { type: Sequelize.DATE, allowNull: true },
      paymentMethod: { type: Sequelize.STRING, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    }, [{ fields: ["usersId", "status", "dueDate"] }, { fields: ["customerId"] }]);

    await safeCreateTable("payment_proofs", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      conversationId: { type: Sequelize.UUID, allowNull: true },
      customerId: { type: Sequelize.UUID, allowNull: true },
      appointmentId: { type: Sequelize.UUID, allowNull: true },
      receivableId: { type: Sequelize.UUID, allowNull: true },
      mediaUrl: { type: Sequelize.STRING, allowNull: false },
      extractedAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      extractedDate: { type: Sequelize.DATEONLY, allowNull: true },
      extractedPayerName: { type: Sequelize.STRING, allowNull: true },
      extractedReceiverName: { type: Sequelize.STRING, allowNull: true },
      extractedTransactionId: { type: Sequelize.STRING, allowNull: true },
      confidenceScore: { type: Sequelize.DECIMAL(5, 4), allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "pending_review" },
      reviewedBy: { type: Sequelize.UUID, allowNull: true },
      reviewedAt: { type: Sequelize.DATE, allowNull: true },
      rawExtraction: { type: Sequelize.JSON, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, [{ fields: ["usersId"] }, { fields: ["extractedTransactionId"] }]);

    await safeCreateTable("ai_payment_settings", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      allowAiReadPaymentProof: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      allowAutoPaymentConfirmation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      minConfidenceToAutoApprove: { type: Sequelize.DECIMAL(5, 4), allowNull: false, defaultValue: 0.92 },
      paymentReviewHumanPhone: { type: Sequelize.STRING, allowNull: true },
      ...timestamps,
    }, [{ fields: ["usersId"], options: { unique: true } }]);

    await safeCreateTable("ai_collection_settings", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      daysBeforeDue: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      chargeOnDueDate: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      daysAfterDue: { type: Sequelize.JSON, allowNull: false, defaultValue: [1, 3, 7] },
      maxChargeAttempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      humanAfterAttempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      collectionHumanPhone: { type: Sequelize.STRING, allowNull: true },
      ...timestamps,
    }, [{ fields: ["usersId"], options: { unique: true } }]);

    await safeCreateTable("collection_attempts", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      receivableId: { type: Sequelize.UUID, allowNull: false },
      customerId: { type: Sequelize.UUID, allowNull: false },
      conversationId: { type: Sequelize.UUID, allowNull: true },
      attemptNumber: { type: Sequelize.INTEGER, allowNull: false },
      messageSent: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "sent" },
      sentAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      ...timestamps,
    }, [{ fields: ["usersId", "receivableId"] }]);

    await safeCreateTable("ai_monthly_report_settings", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      reportDay: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      reportTime: { type: Sequelize.TIME, allowNull: false, defaultValue: "09:00:00" },
      recipients: { type: Sequelize.JSON, allowNull: false, defaultValue: [] },
      includeFinancial: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      includeAppointments: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      includeProducts: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    }, [{ fields: ["usersId"], options: { unique: true } }]);

    await safeCreateTable("ai_monthly_report_recipients", {
      id: uuidPk,
      usersId: { type: Sequelize.UUID, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    }, [{ fields: ["usersId"] }]);
  },

  async down(queryInterface) {
    const safeDescribe = async (table) => {
      try {
        return await queryInterface.describeTable(table);
      } catch {
        return null;
      }
    };
    const safeRemoveColumn = async (table, column) => {
      const current = await safeDescribe(table);
      if (current?.[column]) await queryInterface.removeColumn(table, column);
    };
    const safeDropTable = async (table) => {
      const current = await safeDescribe(table);
      if (current) await queryInterface.dropTable(table);
    };

    for (const table of [
      "ai_monthly_report_recipients",
      "ai_monthly_report_settings",
      "collection_attempts",
      "ai_collection_settings",
      "ai_payment_settings",
      "payment_proofs",
      "receivables",
      "product_recommendation_rules",
      "customer_registration_sessions",
      "ai_service_offers",
      "ai_service_offer_settings",
      "ai_grooming_settings",
      "ai_settings",
    ]) {
      await safeDropTable(table);
    }

    for (const column of ["paymentProofId", "receivableId", "paidAt", "paymentAmount", "paymentStatus"]) {
      await safeRemoveColumn("appointments", column);
    }
    for (const column of ["photoUrl", "productPreferences", "treatEnabled", "restrictions", "behavior", "size", "approxWeight"]) {
      await safeRemoveColumn("pets", column);
    }
    for (const column of ["aiCanOffer", "aiCanSchedule", "maxParallelQuantity", "blocksParallelServices", "requiresGroomer"]) {
      await safeRemoveColumn("services", column);
    }
    for (const column of ["errorMessage", "confidenceScore", "actionResult", "actionPayload", "actionName"]) {
      await safeRemoveColumn("crm_ai_action_logs", column);
    }
    for (const column of ["metadata", "mediaType", "content", "role", "senderType", "whatsappMessageId"]) {
      await safeRemoveColumn("crm_conversation_messages", column);
    }
    for (const column of ["assignedAt", "queueKey", "aiEnabled", "missingFields", "collectedFields", "summary", "currentIntent"]) {
      await safeRemoveColumn("crm_conversations", column);
    }
  },
};
