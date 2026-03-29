import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
import Products from "./Products.js";
import Services from "./Services.js";
import Settings from "./Settings.js";

const Users = sequelize.define(
  "Users",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    establishment: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM("admin", "proprietario", "funcionario"),
      defaultValue: "proprietario",
    },
    status: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    observation: {
      type: DataTypes.TEXT,
    },
    recoveryPassToken: {
      type: DataTypes.TEXT,
    },
    timeRecoveryPass: {
      type: DataTypes.TIME,
    },
    expirationDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    plan: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    lastAccess: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "users",
  },
);

// Auto-relacionamento para funcionários
Users.hasMany(Users, {
  foreignKey: "establishment",
  as: "employees",
});

Users.belongsTo(Users, {
  foreignKey: "establishment",
  as: "employer",
});

// Associações com outros modelos
Users.hasMany(Products, {
  foreignKey: "usersId",
  as: "products",
});

Users.hasMany(Services, {
  foreignKey: "establishment",
  as: "services",
});

Users.hasOne(Settings, {
  foreignKey: "usersId",
  as: "settings",
});

export default Users;
