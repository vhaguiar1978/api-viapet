import express from "express";
import auth from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import Users from "../models/Users.js";
import { getAiUsageStatus } from "../service/aiUsageLimits.js";

const router = express.Router();

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
}

router.get("/ai-usage/status", auth, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const status = await getAiUsageStatus(usersId);
    res.json({ success: true, data: status });
  } catch (error) {
    console.error("[AI Usage] status:", error);
    res.status(500).json({
      success: false,
      error: "Nao foi possivel carregar o consumo de IA.",
    });
  }
});

router.get("/admin/ai-usage", adminMiddleware, async (req, res) => {
  try {
    const clients = await Users.findAll({
      where: { role: "user" },
      attributes: ["id", "name", "email", "storeName"],
      order: [["createdAt", "DESC"]],
      limit: 500,
    });
    const rows = await Promise.all(
      clients.map(async (client) => ({
        client: {
          id: client.id,
          name: client.storeName || client.name,
          email: client.email,
        },
        usage: await getAiUsageStatus(client.id),
      })),
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("[AI Usage] admin:", error);
    res.status(500).json({
      success: false,
      error: "Nao foi possivel carregar o consumo de IA dos clientes.",
    });
  }
});

export default router;
