import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Sales = sequelize.define(
  "Sales",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    custumerId: {
      type: DataTypes.UUID,
    },
    appointmentId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "ID do agendamento relacionado à venda",
    },
    total: {
      type: DataTypes.DECIMAL(10, 2),
    },
    paymentMethod: {
      type: DataTypes.STRING,
    },
    status: {
      type: DataTypes.ENUM("pago", "pendente", "cancelado"),
      defaultValue: "pendente",
    },
    responsible: {
      type: DataTypes.UUID,
    },
    observation: {
      type: DataTypes.TEXT,
    },
  },
  {
    timestamps: true,
    tableName: "sales",
  },
);

export default Sales;
