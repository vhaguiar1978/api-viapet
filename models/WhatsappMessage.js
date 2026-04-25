import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const WhatsappMessage = sequelize.define(
  "WhatsappMessage",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    conversationId: {
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
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    metaMessageId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    externalMessageId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    direction: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "inbound",
    },
    origin: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "api",
    },
    messageType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "text",
    },
    templateName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    mediaUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    mimeType: {
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
    rawPayload: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    failedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "whatsapp_messages",
  },
);

export default WhatsappMessage;
