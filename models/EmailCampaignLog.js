import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const EmailCampaignLog = sequelize.define(
  "EmailCampaignLog",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    campaignId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    recipientEmail: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    recipientName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("sent", "failed", "scheduled"),
      allowNull: false,
      defaultValue: "scheduled",
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "email_campaign_logs",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

export default EmailCampaignLog;
