import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const SaleItem = sequelize.define(
  "SaleItem",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    saleId: {
      type: DataTypes.UUID,
    },
    productId: {
      type: DataTypes.UUID,
    },
    quantify: {
      type: DataTypes.INTEGER,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
    },
    subTotal: {
      type: DataTypes.DECIMAL(10, 2),
    },
    observation: {
      type: DataTypes.TEXT,
    },
  },
  {
    timestamps: true,
    tableName: "saleitem",
  },
);

export default SaleItem;
