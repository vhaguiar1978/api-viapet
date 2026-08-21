import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const ProductRecommendationRule = sequelize.define(
  "ProductRecommendationRule",
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
    productId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    triggerType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    triggerValue: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "product_recommendation_rules",
    timestamps: true,
  },
);

export default ProductRecommendationRule;
