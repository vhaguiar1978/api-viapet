import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const AppointmentStatusHistory = sequelize.define(
  "AppointmentStatusHistory",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    appointmentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "appointments",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    usersId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    eventType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "status_change",
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: "appointment_status_history",
    timestamps: true,
    updatedAt: false,
  },
);

export default AppointmentStatusHistory;
