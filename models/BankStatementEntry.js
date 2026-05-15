import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const BankStatementEntry = sequelize.define(
  "BankStatementEntry",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    statementId: { type: DataTypes.UUID, allowNull: false },
    usersId: { type: DataTypes.UUID, allowNull: false },
    bankAccountId: { type: DataTypes.UUID, allowNull: true },
    entryDate: { type: DataTypes.DATEONLY, allowNull: false },
    direction: { type: DataTypes.STRING(10), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    description: { type: DataTypes.STRING(500), allowNull: true },
    payerName: { type: DataTypes.STRING(180), allowNull: true },
    payerDocument: { type: DataTypes.STRING(20), allowNull: true },
    externalId: { type: DataTypes.STRING(120), allowNull: true },
    paymentMethodHint: { type: DataTypes.STRING(40), allowNull: true },
    rawJson: { type: DataTypes.JSON, allowNull: true },
    matchStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "pending",
    },
    matchedFinanceId: { type: DataTypes.INTEGER, allowNull: true },
    matchedPaymentId: { type: DataTypes.UUID, allowNull: true },
    matchConfidence: { type: DataTypes.DECIMAL(4, 3), allowNull: true },
    matchedAt: { type: DataTypes.DATE, allowNull: true },
    matchedBy: { type: DataTypes.UUID, allowNull: true },
    matchSource: { type: DataTypes.STRING(20), allowNull: true },
  },
  {
    tableName: "bank_statement_entries",
    timestamps: true,
    indexes: [
      { name: "idx_bse_user_status", fields: ["usersId", "matchStatus"] },
      { name: "idx_bse_statement", fields: ["statementId"] },
      { name: "idx_bse_amount_date", fields: ["amount", "entryDate"] },
    ],
  },
);

export default BankStatementEntry;
