import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("CommercialAiSetting", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  mode: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "suggest_only" },
  states: { type: DataTypes.JSON, allowNull: false, defaultValue: [] }, cities: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  segments: { type: DataTypes.JSON, allowNull: false, defaultValue: ["Pet shop"] },
  dailyLeadLimit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20 }, dailyContactLimit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  contactStartTime: { type: DataTypes.TIME, allowNull: false, defaultValue: "09:00:00" }, contactEndTime: { type: DataTypes.TIME, allowNull: false, defaultValue: "18:00:00" },
  requireOptIn: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, pauseOnHumanReply: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  settings: { type: DataTypes.JSON, allowNull: false, defaultValue: {} }, updatedBy: DataTypes.UUID,
}, { tableName: "commercial_ai_settings", timestamps: true });
