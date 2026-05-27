import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const CrmResponseJob = sequelize.define(
  "CrmResponseJob",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    inboundMessageId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    providerMessageId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    sourceChannel: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "official",
    },
    messageType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "text",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    maxAttempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 3,
    },
    dueAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    lockedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastAttemptAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    answeredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    timestamps: true,
    tableName: "crm_response_jobs",
    indexes: [
      { fields: ["usersId", "status", "dueAt"] },
      { fields: ["conversationId"] },
      { unique: true, fields: ["inboundMessageId"] },
    ],
  },
);

export default CrmResponseJob;
