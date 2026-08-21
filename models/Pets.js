import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Pets = sequelize.define(
  "Pets",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    name: {
      type: DataTypes.STRING,
    },
    species: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    sex: {
      type: DataTypes.ENUM("Macho", "Femea"),
      allowNull: true,
    },
    breed: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    size: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    approxWeight: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    birthdate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    custumerId: {
      type: DataTypes.UUID,
    },
    observation: {
      type: DataTypes.TEXT,
    },
    allergic: {
      type: DataTypes.STRING,
    },
    restrictions: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    behavior: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    lastParamsMessage: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    feedBrand: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    hygienicCarpet: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    favoriteTreat: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    treatEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    productPreferences: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    photoUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "pets",
  }
);

export default Pets;
