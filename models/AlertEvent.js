import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AlertEvent = sequelize.define(
  "AlertEvent",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    rule_id: { type: DataTypes.UUID, allowNull: false },
    rule_name: { type: DataTypes.STRING(160), allowNull: true },
    kind: { type: DataTypes.STRING(60), allowNull: false },
    severity: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "info" },
    title: { type: DataTypes.STRING(180), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: true },
    payload_json: { type: DataTypes.JSON, allowNull: true },
    delivery_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pending" },
    delivered_via: { type: DataTypes.STRING(20), allowNull: true },
    acknowledged_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: "alert_events",
    timestamps: false,
    indexes: [
      { name: "idx_alert_events_rule", fields: ["rule_id"] },
      { name: "idx_alert_events_created", fields: ["created_at"] },
      { name: "idx_alert_events_status", fields: ["delivery_status"] },
    ],
  },
);

export default AlertEvent;
