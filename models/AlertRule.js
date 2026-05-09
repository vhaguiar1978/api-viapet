import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AlertRule = sequelize.define(
  "AlertRule",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(160), allowNull: false },
    kind: { type: DataTypes.STRING(60), allowNull: false },
    // kinds: high_value_overdue | mrr_drop_pct | client_cancelled | no_login_days | new_client_no_data
    config_json: { type: DataTypes.JSON, allowNull: true },
    channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "in_app" },
    recipient: { type: DataTypes.STRING(180), allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    last_triggered_at: { type: DataTypes.DATE, allowNull: true },
    last_check_at: { type: DataTypes.DATE, allowNull: true },
    last_payload_json: { type: DataTypes.JSON, allowNull: true },
    cooldown_hours: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 24 },
  },
  {
    tableName: "alert_rules",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

export default AlertRule;
