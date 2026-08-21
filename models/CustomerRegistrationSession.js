import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const CustomerRegistrationSession = sequelize.define(
  "CustomerRegistrationSession",
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
    conversationId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    contactPhone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "open",
    },
    formToken: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    formUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    draft: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    submittedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "customer_registration_sessions",
    timestamps: true,
  },
);

export default CustomerRegistrationSession;
