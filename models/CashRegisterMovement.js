import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("CashRegisterMovement", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  sessionId: { type: DataTypes.UUID, allowNull: false }, usersId: { type: DataTypes.UUID, allowNull: false },
  type: { type: DataTypes.STRING(40), allowNull: false }, direction: { type: DataTypes.STRING(10), allowNull: false },
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false }, description: { type: DataTypes.STRING(255), allowNull: false },
  category: DataTypes.STRING(100), destination: DataTypes.STRING(160), sourceType: DataTypes.STRING(80), sourceId: DataTypes.STRING(120),
  idempotencyKey: { type: DataTypes.STRING(255), allowNull: false }, financeId: DataTypes.INTEGER,
  attachmentUrl: DataTypes.TEXT, metadata: DataTypes.JSONB, createdBy: { type: DataTypes.UUID, allowNull: false },
}, { tableName: "cash_register_movements", timestamps: true });
