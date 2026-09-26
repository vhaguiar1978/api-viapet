import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("CommercialActivity", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  leadId: { type: DataTypes.UUID, allowNull: false }, sellerId: { type: DataTypes.UUID, allowNull: false },
  type: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "follow_up" }, title: { type: DataTypes.STRING(220), allowNull: false }, notes: DataTypes.TEXT,
  dueAt: DataTypes.DATE, completedAt: DataTypes.DATE, status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "open" },
}, { tableName: "commercial_activities", timestamps: true });
