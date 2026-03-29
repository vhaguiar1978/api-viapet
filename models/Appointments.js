import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Appointments = sequelize.define(
  "Appointments",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    petId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    serviceId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    date: {
      type: DataTypes.DATE,
    },
    status: {
      type: DataTypes.STRING,
    },
    observation: {
      type: DataTypes.TEXT,
    },
  },
  {
    timestamps: true,
    tableName: "appointments",
  },
);

export default Appointments;
