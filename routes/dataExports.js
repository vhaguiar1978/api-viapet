import crypto from "node:crypto";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import express from "express";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import owner from "../middlewares/owner.js";
import DataExportJob from "../models/DataExportJob.js";
import { canAccessExport, fetchPrivateExport, hashDownloadToken, processNextDataExport, resolvePrivateExportPath } from "../service/dataExportService.js";

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const requireTenant = (req, res, next) => req.user?.establishment
  ? next()
  : res.status(403).json({ message: "Selecione uma empresa válida para exportar os dados." });
const secured = [authenticate, owner, requireTenant];
const publicJob = (job) => ({ id: job.id, format: job.format, status: job.status, fileName: job.fileName, fileSize: Number(job.fileSize || 0), recordCount: job.recordCount, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, expiresAt: job.expiresAt, downloadedAt: job.downloadedAt });
router.use("/data-exports", (_req, res, next) => { res.set("Cache-Control", "no-store, private"); next(); });

router.get("/data-exports", ...secured, asyncRoute(async (req, res) => {
  const jobs = await DataExportJob.findAll({ where: { usersId: req.user.establishment }, order: [["createdAt", "DESC"]], limit: 20 });
  res.json({ data: jobs.map(publicJob) });
}));

router.post("/data-exports", ...secured, asyncRoute(async (req, res) => {
  const recent = await DataExportJob.findOne({ where: { usersId: req.user.establishment, status: { [Op.in]: ["REQUESTED", "QUEUED", "PROCESSING", "GENERATING_FILE"] } }, order: [["createdAt", "DESC"]] });
  if (recent) return res.status(202).json({ message: "Já existe uma exportação em processamento.", data: publicJob(recent) });
  const lastRequest = await DataExportJob.findOne({ where: { usersId: req.user.establishment, createdAt: { [Op.gte]: new Date(Date.now() - 60000) } }, order: [["createdAt", "DESC"]] });
  if (lastRequest) return res.status(429).json({ message: "Aguarde um minuto antes de gerar outra exportação." });
  const job = await DataExportJob.create({ usersId: req.user.establishment, requestedBy: req.user.id, status: "REQUESTED" });
  setImmediate(async () => {
    try {
      await job.update({ status: "QUEUED" });
      await processNextDataExport();
    } catch (error) { console.error("Erro no worker de exportação:", error.message); }
  });
  res.status(202).json({ message: "Preparando seus dados…", data: publicJob(job) });
}));

router.post("/data-exports/:id/download-token", ...secured, asyncRoute(async (req, res) => {
  const job = await DataExportJob.findByPk(req.params.id);
  if (!canAccessExport(job, req.user)) return res.status(404).json({ message: "Exportação não encontrada." });
  if (job.status !== "READY" || !job.expiresAt || new Date(job.expiresAt) <= new Date()) return res.status(410).json({ message: "Este arquivo não está mais disponível." });
  const token = crypto.randomBytes(32).toString("hex");
  await job.update({ downloadTokenHash: hashDownloadToken(token), downloadTokenExpiresAt: new Date(Date.now() + 10 * 60000) });
  res.json({ data: { url: `/data-exports/${job.id}/download?token=${token}`, expiresInSeconds: 600 } });
}));

router.get("/data-exports/:id/download", ...secured, asyncRoute(async (req, res) => {
  const job = await DataExportJob.findByPk(req.params.id);
  const suppliedHash = hashDownloadToken(req.query.token || "");
  if (!canAccessExport(job, req.user) || !job.downloadTokenHash || suppliedHash.length !== job.downloadTokenHash.length || !crypto.timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(job.downloadTokenHash))) return res.status(404).json({ message: "Download não encontrado." });
  if (job.status !== "READY" || new Date(job.expiresAt) <= new Date() || new Date(job.downloadTokenExpiresAt) <= new Date()) return res.status(410).json({ message: "Link expirado. Gere um novo link de download." });
  if (String(job.storageKey || "").startsWith("supabase:")) {
    const storedResponse = await fetchPrivateExport(job.storageKey);
    if (!storedResponse) return res.status(404).json({ message: "Arquivo não encontrado." });
    await job.update({ downloadedAt: new Date(), downloadTokenHash: null, downloadTokenExpiresAt: null });
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(job.fileName)}`);
    if (storedResponse.headers.get("content-length")) res.set("Content-Length", storedResponse.headers.get("content-length"));
    return Readable.fromWeb(storedResponse.body).pipe(res);
  }
  const target = resolvePrivateExportPath(job.storageKey);
  if (!target) return res.status(404).json({ message: "Arquivo não encontrado." });
  try { await fs.access(target); } catch { return res.status(404).json({ message: "Arquivo não encontrado." }); }
  await job.update({ downloadedAt: new Date(), downloadTokenHash: null, downloadTokenExpiresAt: null });
  res.download(target, job.fileName);
}));

export default router;
