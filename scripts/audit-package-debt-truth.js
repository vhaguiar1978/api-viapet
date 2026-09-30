import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Appointment from "../models/Appointment.js";
import Custumers from "../models/Custumers.js";
import Finance from "../models/Finance.js";
import { calculateAppointmentOutstandingSummary } from "../service/appointmentFinance.js";

const tenant = String(process.argv[2] || "bfdd29c4-d790-43c6-bc2b-5b685b4c319a");
const names = process.argv.slice(3).length ? process.argv.slice(3) : ["Vilma", "Juliana Cristina", "antonio martins"];

try {
  for (const name of names) {
    const customer = await Custumers.findOne({
      where: { usersId: tenant, name: { [Op.iLike]: `%${name}%` } },
      attributes: ["id", "name"],
    });
    if (!customer) continue;
    const appointments = await Appointment.findAll({
      where: { usersId: tenant, customerId: customer.id },
      attributes: ["id", "usersId", "customerId", "petId", "serviceId", "secondaryServiceId", "tertiaryServiceId", "date", "time", "package", "packageGroupId", "packageNumber", "packageMax"],
    });
    const appointmentById = new Map(appointments.map((row) => [String(row.id), row]));
    const balances = await Finance.findAll({
      where: { usersId: tenant, type: "entrada", status: { [Op.in]: ["pendente", "atrasado"] }, reference: { [Op.like]: "appointment_balance:%" } },
      attributes: ["reference"],
    });
    let open = 0;
    const groups = new Set();
    for (const finance of balances) {
      const appointment = appointmentById.get(String(finance.reference || "").split(":")[1]);
      if (!appointment) continue;
      const groupKey = String(appointment.packageGroupId || appointment.id);
      if (groups.has(groupKey)) continue;
      groups.add(groupKey);
      const { summary } = await calculateAppointmentOutstandingSummary(appointment);
      open += Number(summary.balance || 0);
    }
    console.log(JSON.stringify({ customer: customer.name, openPackageBalance: Number(open.toFixed(2)), groups: groups.size }));
  }
} finally {
  await sequelize.close();
}
