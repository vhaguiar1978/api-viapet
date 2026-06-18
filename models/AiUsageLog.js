import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AiUsageLog = sequelize.define(
  "AiUsageLog",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    model: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    promptTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    completionTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    totalTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    estimatedCost: {
      type: DataTypes.DECIMAL(12, 6),
      allowNull: false,
      defaultValue: 0,
    },
    success: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "ai_usage_logs",
  },
);

export default AiUsageLog;
