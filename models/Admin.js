import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Admin = sequelize.define(
  "Admin",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    smtpHost: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    smtpPort: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    smtpEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    smtpPassword: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    mercadoPagoAccessToken: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    siteConsultantWhatsapp: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    bannerUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    tiktok: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    facebook: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    instagram: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    youtube: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
  },
  {
    timestamps: true,
    tableName: "admin",
  },
);

export default Admin;
