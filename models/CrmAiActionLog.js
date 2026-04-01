import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const CrmAiActionLog = sequelize.define(
  "CrmAiActionLog",
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
    appointmentId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    financeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    authorUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    actionType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "proposed",
    },
    summary: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    assistantReply: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    approvalRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    approvedByHuman: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    executed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    timestamps: true,
    tableName: "crm_ai_action_logs",
  },
);

export default CrmAiActionLog;

