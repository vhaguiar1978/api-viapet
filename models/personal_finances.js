import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const PersonalFinance = sequelize.define(
  "PersonalFinance",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user: {
      type: DataTypes.CHAR(36),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("entrada", "saida"),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
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
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    subCategory: {
      type: DataTypes.STRING(255),
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
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pendente", "pago", "atrasado", "cancelado"),
      allowNull: false,
      defaultValue: "pendente",
    },
    reference: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Referência externa (ID de venda, agendamento, etc)",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    attachments: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "URLs de comprovantes ou documentos relacionados",
    },
    budgetId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Vinculado a um orçamento específico, se aplicável",
    },
  },
  {
    tableName: "personal_finances",
    timestamps: true,
    indexes: [
      {
        fields: ["type", "date"],
      },
      {
        fields: ["status", "dueDate"],
      },
      {
        fields: ["category"],
      },
    ],
  },
);

export default PersonalFinance;
