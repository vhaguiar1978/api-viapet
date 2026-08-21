import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AiSettings = sequelize.define(
  "AiSettings",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    aiActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    allowAiSchedule: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    allowAiRegisterNewCustomer: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    allowAiRegisterPet: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    allowAiOfferExtraServices: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    allowAiOfferProducts: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    allowAiReadPaymentProof: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    allowAiChargeCustomers: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    allowAiMonthlyReport: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    monthlyReportDay: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    monthlyReportTime: {
      type: DataTypes.TIME,
      allowNull: false,
      defaultValue: "09:00:00",
    },
    humanTransferPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    defaultAiTone: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "profissional",
    },
    settings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "ai_settings",
    timestamps: true,
  },
);

export default AiSettings;
