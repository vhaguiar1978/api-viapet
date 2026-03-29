import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";

const Purchases = sequelize.define(
  "Purchases",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    usersId: {
      type: DataTypes.UUID,
    },
    supplierId: {
      type: DataTypes.UUID,
    },
    total: {
      type: DataTypes.DECIMAL,
    },
    paymentMethod: {
      type: DataTypes.STRING,
    },
    status: {
      type: DataTypes.ENUM("pago", "pendente", "cancelado"),
      defaultValue: "pendente",
    },
    observation: {
      type: DataTypes.TEXT,
    },
  },
  {
    timestamps: true,
    tableName: "purchases",
  },
);

export default Purchases;
