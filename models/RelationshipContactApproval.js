import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

export default sequelize.define("RelationshipContactApproval", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  systemId: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "VIAPET" },
  missionId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  action: { type: DataTypes.STRING(48), allowNull: false },
  reason: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "pending" },
  reviewedBy: DataTypes.UUID,
  reviewedAt: DataTypes.DATE,
  providerMessageId: DataTypes.STRING(180),
  errorCode: DataTypes.STRING(80),
  metadata: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
}, { tableName: "relationship_contact_approvals", timestamps: true, indexes: [{ unique: true, fields: ["missionId", "userId"] }] });
