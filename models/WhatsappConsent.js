import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const WhatsappConsent = sequelize.define(
  "WhatsappConsent",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    consentStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    consentSource: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    consentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    optOutAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    optOutReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    timestamps: true,
    tableName: "whatsapp_consents",
  },
);

export default WhatsappConsent;
