import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Services = sequelize.define(
  "Services",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    establishment: {
      type: DataTypes.UUID,
    },
    name: {
      type: DataTypes.STRING,
    },
    duration: {
      type: DataTypes.INTEGER,
    },
    description: {
      type: DataTypes.TEXT,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
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
  },
  {
    timestamps: true,
    tableName: "services",
  },
);

export default Services;
