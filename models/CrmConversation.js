import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const CrmConversation = sequelize.define(
  "CrmConversation",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    petId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    assignedUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "whatsapp",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "crm",
    },
    title: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    petName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    avatarUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    lastMessagePreview: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastInboundAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastOutboundAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    unreadCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    isPinned: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    isArchived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    timestamps: true,
    tableName: "crm_conversations",
  },
);

export default CrmConversation;
