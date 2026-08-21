import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("CashRegisterSession", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  usersId: { type: DataTypes.UUID, allowNull: false },
  registerCode: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "principal" },
  status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "ABERTO" },
  openingAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  openingNotes: DataTypes.TEXT, openedBy: { type: DataTypes.UUID, allowNull: false },
  openedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  countedAmount: DataTypes.DECIMAL(12, 2), differenceAmount: DataTypes.DECIMAL(12, 2),
  differenceReason: DataTypes.TEXT, closedBy: DataTypes.UUID, closedAt: DataTypes.DATE, deviceInfo: DataTypes.JSONB,
}, { tableName: "cash_register_sessions", timestamps: true });
