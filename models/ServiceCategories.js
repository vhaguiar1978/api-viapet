import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const ServiceCategories = sequelize.define(
  "ServiceCategories",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    name: {
      type: DataTypes.STRING,
    },
    description: {
      type: DataTypes.TEXT,
    },
    observation: {
      type: DataTypes.TEXT,
    },
  },
  {
    timestamps: true,
    tableName: "serviceCategories",
  },
);

export default ServiceCategories;
