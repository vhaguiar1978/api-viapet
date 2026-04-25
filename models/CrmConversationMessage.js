import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const CrmConversationMessage = sequelize.define(
  "CrmConversationMessage",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    petId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    authorUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    direction: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "inbound",
    },
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "whatsapp",
    },
    messageType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "text",
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    mediaUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    mimeType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    providerMessageId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "received",
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    receivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    timestamps: true,
    tableName: "crm_conversation_messages",
  },
);

export default CrmConversationMessage;
