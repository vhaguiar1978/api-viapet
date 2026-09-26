import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("CommercialLead", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  sellerId: { type: DataTypes.UUID, allowNull: true },
  ownerType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "seller" },
  sourceProvider: { type: DataTypes.STRING(32), allowNull: false },
  externalId: { type: DataTypes.STRING(180), allowNull: false },
  businessName: { type: DataTypes.STRING(220), allowNull: false },
  segment: DataTypes.STRING(120), state: DataTypes.STRING(80), city: DataTypes.STRING(120), neighborhood: DataTypes.STRING(120),
  address: DataTypes.TEXT, phone: DataTypes.STRING(32), whatsapp: DataTypes.STRING(32), website: DataTypes.TEXT,
  latitude: DataTypes.DECIMAL(10, 7), longitude: DataTypes.DECIMAL(10, 7),
  stage: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "found" },
  contactPermission: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "unknown" },
  nextActionAt: DataTypes.DATE, lastContactAt: DataTypes.DATE, aiEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  lossReason: DataTypes.STRING(240),
  metadata: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
}, { tableName: "commercial_leads", timestamps: true });
