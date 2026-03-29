import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
import Users from "./Users.js";

const LoginHistory = sequelize.define(
  "LoginHistory",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Users,
        key: "id",
      },
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userAgent: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    device: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    location: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("success", "failed"),
      defaultValue: "success",
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "login_history",
    timestamps: true,
    updatedAt: false, // Não precisamos de updatedAt para registros de login
  },
);

// Relacionamento com Users
LoginHistory.belongsTo(Users, {
  foreignKey: "userId",
  as: "user",
});

Users.hasMany(LoginHistory, {
  foreignKey: "userId",
  as: "loginHistory",
});

export default LoginHistory;
