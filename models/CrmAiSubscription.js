import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const CrmAiSubscription = sequelize.define(
  "CrmAiSubscription",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    status: {
      type: DataTypes.ENUM("pending", "active", "cancelled", "expired", "suspended"),
      allowNull: false,
      defaultValue: "pending",
    },
    payment_status: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 49.9,
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: "BRL",
    },
    payment_preference_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    payment_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    external_reference: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    activated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    next_billing_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancelled_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "crm_ai_subscriptions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ fields: ["user_id"] }, { fields: ["status"] }, { fields: ["external_reference"] }],
  },
);

export default CrmAiSubscription;
