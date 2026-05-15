import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const BankAccount = sequelize.define(
  "BankAccount",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    bank: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    agency: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    accountNumber: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    accountType: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "corrente",
      comment: "corrente, poupanca, pagamento, cartao, outros",
    },
    pixKey: {
      type: DataTypes.STRING(180),
      allowNull: true,
    },
    initialBalance: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "bank_accounts",
    timestamps: true,
    indexes: [
      { name: "idx_bank_accounts_user", fields: ["usersId"] },
      { name: "idx_bank_accounts_active", fields: ["usersId", "active"] },
    ],
  },
);

export const ACCOUNT_TYPES = ["corrente", "poupanca", "pagamento", "cartao", "outros"];

export default BankAccount;
