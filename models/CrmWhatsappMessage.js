import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const CrmWhatsappMessage = sequelize.define(
  "CrmWhatsappMessage",
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
    customerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
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
    whatsappMessageId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "received",
    },
    receivedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
    },
  },
  {
    timestamps: true,
    tableName: "crm_whatsapp_messages",
  },
);

export default CrmWhatsappMessage;
