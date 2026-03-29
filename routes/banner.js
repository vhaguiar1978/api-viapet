import express from "express";
import { DataTypes } from "sequelize";
import Banners from "../models/Banners.js";
import upload from "../middlewares/fileImage.js";
import authenticate from "../middlewares/auth.js";
import sequelize from "../database/config.js";

const router = express.Router();

async function ensureBannerSchema() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable("banners");

  const columnsToAdd = [
    ["title", { type: "STRING" }],
    ["placement", { type: "STRING", defaultValue: "agenda_sidebar" }],
    ["startDate", { type: "DATE", allowNull: true }],
    ["endDate", { type: "DATE", allowNull: true }],
    ["isActive", { type: "BOOLEAN", defaultValue: true }],
    ["reminderDays", { type: "INTEGER", defaultValue: 7 }],
    ["notes", { type: "TEXT", allowNull: true }],
  ];

  for (const [name, config] of columnsToAdd) {
    if (table[name]) continue;

    await queryInterface.addColumn("banners", name, {
      type: DataTypes[config.type],
      allowNull: config.allowNull ?? false,
      defaultValue: config.defaultValue,
    });
  }
}

function buildBannerUrl(req, file) {
  if (!file) return null;
  return `${process.env.API_URL || `${req.protocol}://${req.get("host")}`}/uploads/${file.filename}`;
}

function getBannerStage(banner) {
  const now = new Date();
  const endDate = banner?.endDate ? new Date(banner.endDate) : null;
  const startDate = banner?.startDate ? new Date(banner.startDate) : null;

  if (banner?.isActive === false) return "inactive";
  if (startDate && startDate > now) return "scheduled";
  if (endDate && endDate < now) return "expired";
  return "active";
}

function shouldShowBanner(banner) {
  return getBannerStage(banner) === "active";
}

router.get("/banners", async (req, res) => {
  try {
    await ensureBannerSchema();

    const { placement, activeOnly } = req.query;
    const where = {};

    if (placement) {
      where.placement = placement;
    }

    const banners = await Banners.findAll({
      where,
      order: [["order", "ASC"], ["createdAt", "DESC"]],
    });

    const normalized = banners.map((banner) => {
      const data = banner.toJSON();
      return {
        ...data,
        stage: getBannerStage(data),
      };
    });

    res.json(
      activeOnly === "true" ? normalized.filter((item) => shouldShowBanner(item)) : normalized,
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/admin/banners/alerts", authenticate, async (req, res) => {
  try {
    await ensureBannerSchema();

    const banners = await Banners.findAll({
      order: [["endDate", "ASC"], ["order", "ASC"]],
    });

    const alerts = banners
      .map((banner) => {
        const data = banner.toJSON();
        const now = new Date();
        const endDate = data.endDate ? new Date(data.endDate) : null;
        const reminderDays = Number(data.reminderDays || 7);
        const daysUntilEnd = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;
        return {
          ...data,
          stage: getBannerStage(data),
          daysUntilEnd,
          reminderDue: daysUntilEnd != null && daysUntilEnd >= 0 && daysUntilEnd <= reminderDays,
        };
      })
      .filter((item) => item.reminderDue || item.stage === "expired");

    res.json({
      message: "Alertas de banner carregados com sucesso",
      data: alerts,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/banners", authenticate, upload.single("image"), async (req, res) => {
  try {
    await ensureBannerSchema();

    if (!req.file) {
      return res.status(400).json({ message: "Imagem e obrigatoria" });
    }

    const { link, order, title, placement, startDate, endDate, isActive, reminderDays, notes } = req.body;
    const url = buildBannerUrl(req, req.file);

    const banner = await Banners.create({
      url,
      link,
      order: Number(order || 0),
      title: title || "Banner agenda",
      placement: placement || "agenda_sidebar",
      startDate: startDate || null,
      endDate: endDate || null,
      isActive: isActive !== "false",
      reminderDays: Number(reminderDays || 7),
      notes: notes || "",
    });

    res.status(201).json({
      ...banner.toJSON(),
      stage: getBannerStage(banner),
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put("/banners/:id", authenticate, upload.single("image"), async (req, res) => {
  try {
    await ensureBannerSchema();

    const banner = await Banners.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ message: "Banner nao encontrado" });
    }

    const updateData = {
      link: req.body.link ?? banner.link,
      order: req.body.order != null ? Number(req.body.order) : banner.order,
      title: req.body.title ?? banner.title,
      placement: req.body.placement ?? banner.placement ?? "agenda_sidebar",
      startDate: req.body.startDate || null,
      endDate: req.body.endDate || null,
      isActive: req.body.isActive !== "false",
      reminderDays: req.body.reminderDays != null ? Number(req.body.reminderDays) : banner.reminderDays || 7,
      notes: req.body.notes ?? banner.notes,
    };

    if (req.file) {
      updateData.url = buildBannerUrl(req, req.file);
    }

    await banner.update(updateData);
    res.json({
      ...banner.toJSON(),
      stage: getBannerStage(banner),
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/banners/:id", authenticate, async (req, res) => {
  try {
    await ensureBannerSchema();

    const banner = await Banners.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ message: "Banner nao encontrado" });
    }

    await banner.destroy();
    res.json({ message: "Banner removido com sucesso" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
