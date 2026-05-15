import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const ReconciliationMatch = sequelize.define(
  "ReconciliationMatch",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    usersId: { type: DataTypes.UUID, allowNull: false },
    entryId: { type: DataTypes.UUID, allowNull: false },
    bankAccountId: { type: DataTypes.UUID, allowNull: true },
    financeId: { type: DataTypes.INTEGER, allowNull: true },
    paymentId: { type: DataTypes.UUID, allowNull: true },
    confidence: { type: DataTypes.DECIMAL(4, 3), allowNull: true },
    source: { type: DataTypes.STRING(20), allowNull: false },
    grossAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    feeAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    netAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.UUID, allowNull: true },
  },
  {
    tableName: "reconciliation_matches",
    timestamps: true,
  },
);

export default ReconciliationMatch;
