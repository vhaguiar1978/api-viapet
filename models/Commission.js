import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("Commission", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sellerId: { type: DataTypes.UUID, allowNull: false }, userId: { type: DataTypes.UUID, allowNull: false },
  paymentHistoryId: DataTypes.UUID,
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  externalPaymentId: { type: DataTypes.STRING(128), allowNull: false }, planId: DataTypes.STRING(64),
  paymentAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  calculationTypeSnapshot: { type: DataTypes.STRING(24), allowNull: false },
  ruleValueSnapshot: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  recurrenceTypeSnapshot: { type: DataTypes.STRING(24), allowNull: false },
  commissionAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "pending" },
  approvedAt: DataTypes.DATE, paidAt: DataTypes.DATE, cancelledAt: DataTypes.DATE, cancellationReason: DataTypes.TEXT,
  commissionPaymentId: DataTypes.UUID,
}, { tableName: "commissions", timestamps: true });
