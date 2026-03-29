import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const PaymentHistory = sequelize.define(
  "PaymentHistory",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    subscription_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "subscriptions",
        key: "id",
      },
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    payment_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    external_reference: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    merchant_order_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(
        "pending",
        "approved",
        "authorized",
        "in_process",
        "in_mediation",
        "rejected",
        "cancelled",
        "refunded",
        "charged_back"
      ),
      allowNull: false,
      defaultValue: "pending",
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: "BRL",
    },
    payment_method: {
      type: DataTypes.ENUM(
        // Novos tipos oficiais do Mercado Pago
        "account_money", // Dinheiro na conta MP
        "ticket", // Boleto e similares
        "bank_transfer", // Pix, SPEI, PSE, Yape
        "atm", // Caixa eletrônico
        "credit_card", // Cartão de crédito
        "debit_card", // Cartão de débito
        "prepaid_card", // Cartão pré-pago
        "digital_currency", // Linha de Crédito
        "voucher_card", // Alelo, Sodexo
        "crypto_transfer", // Criptomoedas

        // Manter compatibilidade com valores antigos
        "pix", // Mantido para compatibilidade
        "boleto" // Mantido para compatibilidade
      ),
      allowNull: true,
    },
    payment_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    installments: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1,
    },
    date_created: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    date_approved: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    date_last_updated: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    billing_period_start: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    billing_period_end: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    plan_type: {
      type: DataTypes.ENUM("monthly", "promotional", "trial"),
      allowNull: false,
    },
    is_trial: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    webhook_data: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "payment_history",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["subscription_id"] },
      { fields: ["user_id"] },
      { fields: ["status"] },
      { fields: ["payment_id"] },
      { fields: ["date_created"] },
      { fields: ["billing_period_start", "billing_period_end"] },
    ],
  }
);

export default PaymentHistory;
