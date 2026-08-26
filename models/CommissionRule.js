import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("CommissionRule", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sellerId: { type: DataTypes.UUID, allowNull: false },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  planId: DataTypes.STRING(64),
  calculationType: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "percentage" },
  value: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  recurrenceType: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "recurring" },
  maxMonths: DataTypes.INTEGER, startsAt: DataTypes.DATEONLY, endsAt: DataTypes.DATEONLY,
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: "commission_rules", timestamps: true });
