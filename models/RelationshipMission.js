import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("RelationshipMission", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  name: { type: DataTypes.STRING(160), allowNull: false },
  instruction: { type: DataTypes.TEXT, allowNull: false },
  userIds: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  results: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "observed" },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  analyzedAt: DataTypes.DATE,
}, { tableName: "relationship_missions", timestamps: true });
