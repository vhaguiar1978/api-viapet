import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const InactiveUserAutomation = sequelize.define(
  "InactiveUserAutomation",
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
      allowNull: false,
    },
    inactiveSince: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    inactivityDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    currentStep: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    nextContactAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    lastContactAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    repliedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    returnedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    convertedAt: {
      type: DataTypes.DATE,
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
    tableName: "inactive_user_automations",
  },
);

export default InactiveUserAutomation;
