import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AiPermission = sequelize.define(
  "AiPermission",
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
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    permissionMode: {
      type: DataTypes.ENUM("automatic", "customer_confirmation", "human_approval", "denied"),
      allowNull: false,
      defaultValue: "denied",
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    settings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "ai_permissions",
    timestamps: true,
    indexes: [{ unique: true, fields: ["usersId", "action"] }],
  },
);

export default AiPermission;
