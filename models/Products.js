import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Products = sequelize.define(
  "Products",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    imageUrl: {
      type: DataTypes.STRING,
    },
    barcode: {
      type: DataTypes.STRING,
    },
    name: {
      type: DataTypes.STRING,
    },
    description: {
      type: DataTypes.TEXT,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
    },
    stoke: {
      type: DataTypes.INTEGER,
    },
    unitary: {
      type: DataTypes.BOOLEAN,
    },
    category: {
      type: DataTypes.STRING,
    },
    observation: {
      type: DataTypes.TEXT,
    },
    cost: {
      type: DataTypes.DECIMAL(10, 2),
    },
    unit: {
      type: DataTypes.STRING,
      defaultValue: "unidade",
    },
  },
  {
    timestamps: true,
    tableName: "products",
  },
);

export default Products;
