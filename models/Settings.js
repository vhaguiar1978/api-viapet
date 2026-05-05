import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Settings = sequelize.define(
  "Settings",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    themeColor: {
      type: DataTypes.STRING,
    },
    storeName: {
      type: DataTypes.STRING,
    },
    logoUrl: {
      type: DataTypes.STRING,
    },
    intervalClinic: {
      type: DataTypes.INTEGER,
      defaultValue: 30,
    },
    intervalAesthetics: {
      type: DataTypes.INTEGER,
      defaultValue: 30,
    },
    notifyClient: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    beds: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    openingTime: {
      type: DataTypes.TIME,
      defaultValue: "08:00:00",
    },
    closingTime: {
      type: DataTypes.TIME,
      defaultValue: "18:00:00",
    },
    breakStartTime: {
      type: DataTypes.TIME,
      defaultValue: "12:00:00",
    },
    breakEndTime: {
      type: DataTypes.TIME,
      defaultValue: "13:00:00",
    },
    textColor: {
      type: DataTypes.STRING,
      defaultValue: "#000000",
    },
    whatsappMessages: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    whatsappConnection: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    crmAutomations: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    workingDays: {
      type: DataTypes.JSON,
      defaultValue: {
        sunday: false,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
      },
      comment: "Dias de funcionamento do estabelecimento",
    },
  },
  {
    timestamps: true,
    tableName: "settings",
  },
);

export default Settings;
