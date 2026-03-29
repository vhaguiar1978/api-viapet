import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Finance = sequelize.define(
  "Finance",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("entrada", "saida"),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    grossAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    feePercentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
    },
    feeAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    netAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    subCategory: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    expenseType: {
      type: DataTypes.ENUM("fixo", "variavel"),
      allowNull: true,
    },
    frequency: {
      type: DataTypes.ENUM("unico", "mensal", "anual"),
      allowNull: true,
    },
    paymentMethod: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pendente", "pago", "atrasado", "cancelado"),
      allowNull: false,
      defaultValue: "pendente",
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Referência externa (ID de venda, agendamento, etc)",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    attachments: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "URLs de comprovantes ou documentos relacionados",
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
  },
  {
    tableName: "finances",
    timestamps: true,
    indexes: [
      {
        name: "idx_finance_type_date",
        fields: ["type", "date"],
      },
      {
        name: "idx_finance_status_duedate",
        fields: ["status", "dueDate"],
      },
      {
        name: "idx_finance_category",
        fields: ["category"],
      },
    ],
  },
);

export default Finance;
