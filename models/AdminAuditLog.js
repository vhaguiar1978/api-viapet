import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AdminAuditLog = sequelize.define(
  "AdminAuditLog",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    admin_user_id: { type: DataTypes.UUID, allowNull: true },
    admin_name: { type: DataTypes.STRING(180), allowNull: true },
    action: { type: DataTypes.STRING(60), allowNull: false },
    target_type: { type: DataTypes.STRING(60), allowNull: true },
    target_id: { type: DataTypes.STRING(80), allowNull: true },
    target_label: { type: DataTypes.STRING(180), allowNull: true },
    method: { type: DataTypes.STRING(10), allowNull: true },
    path: { type: DataTypes.STRING(255), allowNull: true },
    status_code: { type: DataTypes.INTEGER, allowNull: true },
    metadata_json: { type: DataTypes.JSON, allowNull: true },
    ip: { type: DataTypes.STRING(60), allowNull: true },
    user_agent: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: "admin_audit_logs",
    timestamps: false,
    indexes: [
      { name: "idx_admin_audit_admin_created", fields: ["admin_user_id", "created_at"] },
      { name: "idx_admin_audit_action", fields: ["action"] },
      { name: "idx_admin_audit_created", fields: ["created_at"] },
    ],
  },
);

export default AdminAuditLog;
