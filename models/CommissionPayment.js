import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
export default sequelize.define("CommissionPayment", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, sellerId: { type: DataTypes.UUID, allowNull: false },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" }, amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  paidAt: { type: DataTypes.DATE, allowNull: false }, paymentMethod: { type: DataTypes.STRING(64), allowNull: false },
  notes: DataTypes.TEXT, proofUrl: DataTypes.TEXT, createdBy: { type: DataTypes.UUID, allowNull: false },
}, { tableName: "commission_payments", timestamps: true });
