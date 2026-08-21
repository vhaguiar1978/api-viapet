import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const PaymentProof = sequelize.define(
  "PaymentProof",
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
    customerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    appointmentId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    receivableId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    mediaUrl: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    extractedAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    extractedDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    extractedPayerName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    extractedReceiverName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    extractedTransactionId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    confidenceScore: {
      type: DataTypes.DECIMAL(5, 4),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending_review",
    },
    reviewedBy: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    rawExtraction: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "payment_proofs",
    timestamps: true,
  },
);

export default PaymentProof;
