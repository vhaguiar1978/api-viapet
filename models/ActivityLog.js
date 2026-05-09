import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const ActivityLog = sequelize.define(
  "ActivityLog",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tenant_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    nome_usuario: {
      type: DataTypes.STRING(180),
      allowNull: true,
    },
    modulo: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    acao: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    descricao: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    entidade_tipo: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    entidade_id: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    metadata_json: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    ip: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    navegador: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "activity_logs",
    timestamps: false,
    indexes: [
      { name: "idx_activity_logs_tenant_created", fields: ["tenant_id", "created_at"] },
      { name: "idx_activity_logs_user_created", fields: ["user_id", "created_at"] },
      { name: "idx_activity_logs_modulo_acao", fields: ["modulo", "acao"] },
    ],
  },
);

export default ActivityLog;
