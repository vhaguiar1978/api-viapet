import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("Referral", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sellerId: { type: DataTypes.UUID, allowNull: false },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  sessionId: { type: DataTypes.STRING(128), allowNull: false }, ipHash: DataTypes.STRING(128),
  utmSource: DataTypes.STRING(128), utmMedium: DataTypes.STRING(128), utmCampaign: DataTypes.STRING(128),
  landingPage: DataTypes.TEXT, firstAccessAt: { type: DataTypes.DATE, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false }, registeredUserId: DataTypes.UUID, registeredAt: DataTypes.DATE,
}, { tableName: "referrals", timestamps: true });
