import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const WhatsappConnection = sequelize.define(
  "WhatsappConnection",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    wabaId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phoneNumberId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    businessPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    verifyToken: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    accessTokenEncrypted: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    accessTokenLast4: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    webhookVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "disconnected",
    },
    lastEventAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastError: {
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
    tableName: "whatsapp_connections",
  },
);

export default WhatsappConnection;
