import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
export default sequelize.define("TransportJob", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  usersId: { type: DataTypes.UUID, allowNull: false }, appointmentId: { type: DataTypes.UUID, allowNull: false, unique: true },
  mode: { type: DataTypes.STRING, defaultValue: "none" }, regionId: DataTypes.UUID, driverId: DataTypes.UUID,
  driverName: DataTypes.STRING, vehicleId: DataTypes.UUID, pickupTime: DataTypes.TIME, deliveryTime: DataTypes.TIME,
  pickupAddress: DataTypes.TEXT, deliveryAddress: DataTypes.TEXT, latitude: DataTypes.DECIMAL, longitude: DataTypes.DECIMAL,
  geocodeStatus: { type: DataTypes.STRING, defaultValue: "pending" }, status: { type: DataTypes.STRING, defaultValue: "scheduled" },
  routeSequence: DataTypes.INTEGER, etaMinutes: DataTypes.INTEGER, notes: DataTypes.TEXT,
}, { tableName: "transport_jobs" });
