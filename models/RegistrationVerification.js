import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const RegistrationVerification = sequelize.define("RegistrationVerification", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  channel: { type: DataTypes.ENUM("email", "phone"), allowNull: false },
  codeHash: { type: DataTypes.STRING(128), allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  consumedAt: { type: DataTypes.DATE, allowNull: true },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  sentAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: "registration_verifications", timestamps: true });

export default RegistrationVerification;
