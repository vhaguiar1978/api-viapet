import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const PurchaseItems = sequelize.define(
  "PurchaseItems",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    purchaseId: {
      type: DataTypes.UUID,
    },
    productId: {
      type: DataTypes.UUID,
    },
    quantify: {
      type: DataTypes.INTEGER,
    },
    price: {
      type: DataTypes.DECIMAL,
    },
    subtotal: {
      type: DataTypes.DECIMAL,
    },
    observation: {
      type: DataTypes.TEXT,
    },
  },
  {
    timestamps: true,
    tableName: "purchaseItems",
  },
);

export default PurchaseItems;
