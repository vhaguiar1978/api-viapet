import express from "express";
import adminMiddleware from "../middlewares/admin.js";
import { getGuardianStatus, runGuardianProbe } from "../service/systemGuardian.js";

const router = express.Router();

router.get("/health/live", (_req, res) => {
  res.status(200).json({ ok: true, service: "api-viapet", uptimeSeconds: Math.floor(process.uptime()) });
});

router.get("/health/ready", async (_req, res) => {
  const result = await runGuardianProbe({ allowRecovery: false });
  res.status(result.ok ? 200 : 503).json(result);
});

router.get("/admin/system-health", adminMiddleware, (_req, res) => {
  res.json({ ok: true, guardian: getGuardianStatus() });
});

router.post("/admin/system-health/check", adminMiddleware, async (_req, res) => {
  const result = await runGuardianProbe({ allowRecovery: true });
  res.status(result.ok ? 200 : 503).json(result);
});

export default router;

