import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("Seller", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  name: { type: DataTypes.STRING(160), allowNull: false },
  phone: DataTypes.STRING(32), whatsapp: DataTypes.STRING(32),
  email: { type: DataTypes.STRING(180), allowNull: false },
  document: DataTypes.STRING(32),
  joinedAt: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "active" },
  code: { type: DataTypes.STRING(64), allowNull: false },
  notes: DataTypes.TEXT, passwordHash: DataTypes.STRING,
}, { tableName: "sellers", timestamps: true });
