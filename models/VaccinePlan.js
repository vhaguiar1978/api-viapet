import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const VaccinePlan = sequelize.define(
  "VaccinePlan",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    establishment: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "vaccine_plans",
    timestamps: true,
  },
);

export default VaccinePlan;
