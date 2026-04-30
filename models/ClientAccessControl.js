import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const ClientAccessControl = sequelize.define(
  "ClientAccessControl",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: "users",
        key: "id",
      },
    },
    status: {
      type: DataTypes.ENUM("active", "blocked"),
      allowNull: false,
      defaultValue: "active",
    },
    features: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    access_starts_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    access_ends_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    unlimited_access: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "client_access_controls",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ unique: true, fields: ["user_id"] }, { fields: ["status"] }],
  },
);

export default ClientAccessControl;
