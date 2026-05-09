import express from "express";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import Users from "../models/Users.js";
import Subscription from "../models/Subscription.js";
import PaymentHistory from "../models/PaymentHistory.js";
import ClientAddon from "../models/ClientAddon.js";
import Addon from "../models/Addon.js";
import ActivityLog from "../models/ActivityLog.js";
import LoginHistory from "../models/LoginHistory.js";
import Custumers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import Appointments from "../models/Appointments.js";

const router = express.Router();

/**
 * GET /admin/clients/:id/detail
 * Drill-down completo de um cliente: cadastro, assinatura, addons, pagamentos,
 * atividade recente e contadores operacionais (clientes/pets/agendamentos).
 */
router.get("/admin/clients/:id/detail", authenticate, adminMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const user = await Users.findByPk(id, {
      attributes: [
        "id",
        "name",
        "email",
        "phone",
        "role",
        "status",
        "establishment",
        "lastAccess",
        "createdAt",
        "expirationDate",
        "plan",
      ],
    });
    if (!user) return res.status(404).json({ message: "Cliente não encontrado" });

    const subscription = await Subscription.findOne({
      where: { user_id: id },
      order: [["created_at", "DESC"]],
    });

    const addons = await ClientAddon.findAll({
      where: { client_user_id: id },
      include: [{ model: Addon, as: "addon", attributes: ["key", "name", "default_amount"] }],
      order: [["created_at", "DESC"]],
    });

    const payments = await PaymentHistory.findAll({
      where: { user_id: id },
      order: [["date_created", "DESC"]],
      limit: 30,
    });

    const recentActivity = await ActivityLog.findAll({
      where: { user_id: id },
      order: [["created_at", "DESC"]],
      limit: 30,
    });

    const recentLogins = await LoginHistory.findAll({
      where: { userId: id },
      order: [["createdAt", "DESC"]],
      limit: 10,
    });

    // Contadores operacionais (o que esse cliente tem dentro do sistema)
    const operationalEstablishment = user.establishment || user.id;
    const [customerCount, petCount, appointmentCount] = await Promise.all([
      Custumers.count({ where: { usersId: operationalEstablishment } }),
      Pets.count({ where: { usersId: operationalEstablishment } }),
      Appointments.count({ where: { usersId: operationalEstablishment } }),
    ]);

    // LTV deste cliente (soma dos pagamentos approved)
    const approvedSum = payments
      .filter((p) => p.status === "approved")
      .reduce((s, p) => s + Number(p.amount || 0), 0);

    return res.json({
      ok: true,
      data: {
        user,
        subscription,
        addons,
        payments,
        recentActivity,
        recentLogins,
        counters: {
          customers: customerCount,
          pets: petCount,
          appointments: appointmentCount,
        },
        ltv: approvedSum,
      },
    });
  } catch (error) {
    console.error("[admin/clients/:id/detail]", error);
    return res.status(500).json({ message: "Erro ao carregar cliente", error: error.message });
  }
});

export default router;
