import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const DataExportJob = sequelize.define("DataExportJob", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  usersId: { type: DataTypes.UUID, allowNull: false },
  requestedBy: { type: DataTypes.UUID, allowNull: false },
  format: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "xlsx" },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "REQUESTED" },
  fileName: DataTypes.STRING(255),
  storageKey: DataTypes.TEXT,
  fileSize: DataTypes.BIGINT,
  recordCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  startedAt: DataTypes.DATE,
  finishedAt: DataTypes.DATE,
  expiresAt: DataTypes.DATE,
  downloadedAt: DataTypes.DATE,
  errorCode: DataTypes.STRING(80),
  errorMessage: DataTypes.TEXT,
  downloadTokenHash: DataTypes.STRING(64),
  downloadTokenExpiresAt: DataTypes.DATE,
}, {
  tableName: "data_export_jobs",
  timestamps: true,
  indexes: [
    { fields: ["usersId", "createdAt"] },
    { fields: ["status", "createdAt"] },
    { fields: ["expiresAt"] },
  ],
});

export default DataExportJob;
