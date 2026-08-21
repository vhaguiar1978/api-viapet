import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Receivable = sequelize.define(
  "Receivable",
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
    customerId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    petId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    appointmentId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    packageId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    originType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "manual",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "open",
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    paymentMethod: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "receivables",
    timestamps: true,
  },
);

export default Receivable;
