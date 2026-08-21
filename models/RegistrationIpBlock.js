import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const RegistrationIpBlock = sequelize.define("RegistrationIpBlock", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  ip: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  reason: { type: DataTypes.TEXT, allowNull: true },
  blockedBy: { type: DataTypes.UUID, allowNull: true },
}, { tableName: "registration_ip_blocks", timestamps: true });

export default RegistrationIpBlock;
