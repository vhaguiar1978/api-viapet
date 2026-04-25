import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const WhatsappWebhookLog = sequelize.define(
  "WhatsappWebhookLog",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    payloadJson: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    eventType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "unknown",
    },
    logType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "event",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    processed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "whatsapp_webhook_logs",
  },
);

export default WhatsappWebhookLog;
