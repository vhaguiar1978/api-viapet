import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
import Finance from "./Finance.js";

const Appointment = sequelize.define(
  "Appointment",
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
    petId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    serviceId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    responsibleId: {
      type: DataTypes.UUID,
      comment: "ID do funcionario responsavel pelo atendimento",
    },
    sellerName: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Nome livre do responsavel exibido na agenda",
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    time: {
      type: DataTypes.TIME,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: "Agendado",
    },
    observation: {
      type: DataTypes.TEXT,
    },
    secondaryServiceId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    tertiaryServiceId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    instagram: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    facebook: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    tiktok: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    whatsapp: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    driver_status: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "Sem status",
    },
    financeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "ID da transacao financeira associada",
    },
    package: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    packageNumber: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Numero do pacote",
    },
    packageMax: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Numero maximo de pacotes",
    },
    packageGroupId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "ID do grupo de pacote — compartilhado por todas as sessoes do mesmo pacote",
    },
    driverId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    queue: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    queueInternacao: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "Indica se o agendamento esta na fila de internacao",
    },
    queueExame: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "Indica se o agendamento esta na fila de exame",
    },
    queueTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    paymentMethod: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    automationsSent: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment: "Registro das automacoes de WhatsApp ja disparadas para este agendamento",
    },
  },
  {
    timestamps: true,
    tableName: "appointments",
  },
);

Appointment.belongsTo(Finance, {
  foreignKey: "financeId",
  as: "finance",
});

export default Appointment;
