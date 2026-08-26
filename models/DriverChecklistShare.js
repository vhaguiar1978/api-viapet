import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const DriverChecklistShare = sequelize.define(
  "DriverChecklistShare",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    token: {
      type: DataTypes.STRING(24),
      allowNull: false,
      unique: true,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    rows: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    timestamps: true,
    tableName: "driver_checklist_shares",
    indexes: [
      { unique: true, fields: ["token"] },
      { fields: ["usersId", "date"] },
    ],
  },
);

export default DriverChecklistShare;
