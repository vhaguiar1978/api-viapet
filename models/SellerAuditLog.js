import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
export default sequelize.define("SellerAuditLog", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" }, action: { type: DataTypes.STRING(64), allowNull: false },
  userId: DataTypes.UUID, previousSellerId: DataTypes.UUID, newSellerId: DataTypes.UUID, actorUserId: DataTypes.UUID,
  reason: DataTypes.TEXT, metadata: DataTypes.JSON,
}, { tableName: "seller_audit_logs", timestamps: true });
