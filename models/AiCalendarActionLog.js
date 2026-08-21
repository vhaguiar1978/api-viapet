import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AiCalendarActionLog = sequelize.define("AiCalendarActionLog", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  usersId: { type: DataTypes.UUID, allowNull: false },
  conversationId: { type: DataTypes.UUID, allowNull: true }, customerId: { type: DataTypes.UUID, allowNull: true },
  petId: { type: DataTypes.UUID, allowNull: true }, appointmentId: { type: DataTypes.UUID, allowNull: true },
  action: { type: DataTypes.STRING, allowNull: false }, permissionMode: { type: DataTypes.STRING, allowNull: false },
  previousData: { type: DataTypes.JSON, allowNull: false, defaultValue: {} }, newData: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  confirmedByCustomer: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, approvedByUserId: { type: DataTypes.UUID, allowNull: true },
  model: { type: DataTypes.STRING, allowNull: true }, toolCalled: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: false }, error: { type: DataTypes.TEXT, allowNull: true }, undoneAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: "ai_calendar_action_logs", timestamps: true });
export default AiCalendarActionLog;
