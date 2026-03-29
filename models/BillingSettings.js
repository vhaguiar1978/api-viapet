import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const BillingSettings = sequelize.define(
  "BillingSettings",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    monthlyPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 69.9,
    },
    promotionalPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 39.9,
    },
    trialDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
    },
    promotionalMonths: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 3,
    },
    reminderDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 7,
    },
    mercadoPagoEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    mercadoPagoPublicKey: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "billing_settings",
    timestamps: true,
  },
);

export default BillingSettings;
