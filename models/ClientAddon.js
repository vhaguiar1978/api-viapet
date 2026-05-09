import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
import Addon from "./Addon.js";
import Users from "./Users.js";

const ClientAddon = sequelize.define(
  "ClientAddon",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    client_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    addon_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    addon_key: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "active",
      // active | suspended | cancelled | trial | overdue
    },
    amount_override: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    activated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    next_billing_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancelled_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_payment_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "client_addons",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { name: "idx_client_addons_user", fields: ["client_user_id"] },
      { name: "idx_client_addons_addon", fields: ["addon_id"] },
      { name: "idx_client_addons_status", fields: ["status"] },
      { name: "uq_client_addons_user_addon", fields: ["client_user_id", "addon_id"], unique: true },
    ],
  },
);

ClientAddon.belongsTo(Addon, { foreignKey: "addon_id", as: "addon" });
Addon.hasMany(ClientAddon, { foreignKey: "addon_id", as: "subscriptions" });

ClientAddon.belongsTo(Users, { foreignKey: "client_user_id", as: "client" });

export default ClientAddon;
