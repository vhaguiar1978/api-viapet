import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const BankStatement = sequelize.define(
  "BankStatement",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    usersId: { type: DataTypes.UUID, allowNull: false },
    bankAccountId: { type: DataTypes.UUID, allowNull: true },
    sourceType: { type: DataTypes.STRING(20), allowNull: false },
    fileName: { type: DataTypes.STRING(255), allowNull: true },
    startDate: { type: DataTypes.DATE, allowNull: true },
    endDate: { type: DataTypes.DATE, allowNull: true },
    totalEntries: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalCredits: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    totalDebits: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "imported" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.UUID, allowNull: true },
  },
  {
    tableName: "bank_statements",
    timestamps: true,
  },
);

export default BankStatement;
