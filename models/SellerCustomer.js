import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("SellerCustomer", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sellerId: { type: DataTypes.UUID, allowNull: false }, userId: { type: DataTypes.UUID, allowNull: false },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "seller" },
  sellerCodeSnapshot: { type: DataTypes.STRING(64), allowNull: false },
  attributedAt: { type: DataTypes.DATE, allowNull: false }, referralId: DataTypes.UUID,
}, { tableName: "seller_customers", timestamps: true });
