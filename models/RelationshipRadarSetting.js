import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
import { RADAR_DEFAULTS } from "../service/relationshipRadarRules.js";

export default sequelize.define("RelationshipRadarSetting", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, unique: true, defaultValue: "VIAPET" },
  settings: { type: DataTypes.JSON, allowNull: false, defaultValue: RADAR_DEFAULTS },
  updatedBy: DataTypes.UUID,
}, { tableName: "relationship_radar_settings", timestamps: true });
