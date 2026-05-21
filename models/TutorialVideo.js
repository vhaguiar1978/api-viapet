import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
import TutorialCategory from "./TutorialCategory.js";

const TutorialVideo = sequelize.define(
  "TutorialVideo",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    category_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    youtube_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "tutorial_videos",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

TutorialVideo.belongsTo(TutorialCategory, { foreignKey: "category_id", as: "category" });
TutorialCategory.hasMany(TutorialVideo, { foreignKey: "category_id", as: "videos" });

export default TutorialVideo;
