import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const EmailCampaign = sequelize.define(
  "EmailCampaign",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    previewText: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    contentHtml: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    contentText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    targetMode: {
      type: DataTypes.ENUM("all", "selected"),
      allowNull: false,
      defaultValue: "all",
    },
    selectedClientIds: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    automaticEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    scheduleType: {
      type: DataTypes.ENUM("weekly", "interval"),
      allowNull: false,
      defaultValue: "weekly",
    },
    sendDaysOfWeek: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    sendTime: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "09:00",
    },
    frequencyDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 7,
    },
    status: {
      type: DataTypes.ENUM("draft", "active", "paused"),
      allowNull: false,
      defaultValue: "draft",
    },
    createdByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    lastRunAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    nextRunAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "email_campaigns",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

export default EmailCampaign;
