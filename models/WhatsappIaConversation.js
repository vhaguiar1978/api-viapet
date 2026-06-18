import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const WhatsappIaConversation = sequelize.define(
  "WhatsappIaConversation",
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
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "open",
    },
    attendanceMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "ai",
    },
    assignedUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastUserMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastAiMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    aiPaused: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    result: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    summary: {
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
    tableName: "whatsapp_conversations",
  },
);

export default WhatsappIaConversation;
