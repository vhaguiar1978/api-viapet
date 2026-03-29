import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const FinancialRecords = sequelize.define(
  "FinancialRecords",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      comment: "ID do usuário/clínica",
    },
    customer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "custumers",
        key: "id",
      },
      comment: "ID do cliente (se aplicável)",
    },
    description: {
      type: DataTypes.TEXT,
    },
    type: {
      type: DataTypes.ENUM("income", "expense"), // Alterado para inglês para padronizar
      comment: "Tipo: income (entrada) ou expense (saída)",
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Categoria do movimento financeiro",
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
    },
    payment_method: {
      // Renomeado de paymentMethod para seguir padrão
      type: DataTypes.STRING,
      comment: "Método de pagamento",
    },
    transaction_id: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "ID da transação externa (ex: Mercado Pago)",
    },
    status: {
      type: DataTypes.ENUM("pending", "confirmed", "cancelled"),
      defaultValue: "confirmed",
      comment: "Status do movimento financeiro",
    },
    date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: "Data do movimento financeiro",
    },
    observation: {
      type: DataTypes.TEXT,
      comment: "Observações adicionais",
    },
  },
  {
    timestamps: true,
    tableName: "FinancialRecords",
  }
);

export default FinancialRecords;
