import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("CommercialLeadEvent", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  leadId: { type: DataTypes.UUID, allowNull: false },
  eventType: { type: DataTypes.STRING(48), allowNull: false },
  previousStage: DataTypes.STRING(32), newStage: DataTypes.STRING(32),
  previousSellerId: DataTypes.UUID, newSellerId: DataTypes.UUID,
  actorType: { type: DataTypes.STRING(24), allowNull: false }, actorId: DataTypes.UUID,
  reason: DataTypes.TEXT, metadata: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
}, { tableName: "commercial_lead_events", timestamps: true });
