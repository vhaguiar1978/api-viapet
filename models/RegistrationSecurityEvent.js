import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const RegistrationSecurityEvent = sequelize.define("RegistrationSecurityEvent", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: true },
  eventType: { type: DataTypes.STRING(64), allowNull: false },
  ip: { type: DataTypes.STRING(64), allowNull: true },
  country: { type: DataTypes.STRING(80), allowNull: true },
  city: { type: DataTypes.STRING(120), allowNull: true },
  browser: { type: DataTypes.STRING(120), allowNull: true },
  os: { type: DataTypes.STRING(120), allowNull: true },
  device: { type: DataTypes.STRING(120), allowNull: true },
  deviceFingerprint: { type: DataTypes.STRING(128), allowNull: true },
  email: { type: DataTypes.STRING, allowNull: true },
  phone: { type: DataTypes.STRING(32), allowNull: true },
  success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  metadata: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
}, { tableName: "registration_security_events", timestamps: true, updatedAt: false });

export default RegistrationSecurityEvent;
