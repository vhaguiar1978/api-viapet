import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AiCalendarApproval = sequelize.define("AiCalendarApproval", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  usersId: { type: DataTypes.UUID, allowNull: false },
  conversationId: { type: DataTypes.UUID, allowNull: true },
  customerId: { type: DataTypes.UUID, allowNull: true },
  petId: { type: DataTypes.UUID, allowNull: true },
  appointmentId: { type: DataTypes.UUID, allowNull: true },
  action: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
  payload: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  requestedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  decidedAt: { type: DataTypes.DATE, allowNull: true },
  decidedBy: { type: DataTypes.UUID, allowNull: true },
  decisionNotes: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "ai_calendar_approvals", timestamps: true });

export default AiCalendarApproval;
