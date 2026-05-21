import express from "express";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import adminMiddleware from "../middlewares/admin.js";
import TutorialCategory from "../models/TutorialCategory.js";
import TutorialVideo from "../models/TutorialVideo.js";

const router = express.Router();

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeColor(value) {
  const allowed = new Set(["green", "purple", "gold", "blue", "navy"]);
  const color = String(value || "").trim().toLowerCase();
  return allowed.has(color) ? color : "green";
}

function normalizeYoutubeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

async function buildTutorialPayload({ onlyActive = false } = {}) {
  const categoryWhere = onlyActive ? { active: true } : undefined;
  const videoWhere = onlyActive ? { active: true } : undefined;
  const categories = await TutorialCategory.findAll({
    where: categoryWhere,
    include: [
      {
        model: TutorialVideo,
        as: "videos",
        required: false,
        where: videoWhere,
      },
    ],
    order: [
      ["sort_order", "ASC"],
      ["name", "ASC"],
      [{ model: TutorialVideo, as: "videos" }, "sort_order", "ASC"],
      [{ model: TutorialVideo, as: "videos" }, "title", "ASC"],
    ],
  });

  return categories.map((category) => {
    const data = category.toJSON();
    return {
      ...data,
      videos: (data.videos || []).map((video) => ({
        ...video,
        youtube_url: normalizeYoutubeUrl(video.youtube_url),
      })),
    };
  });
}

router.get("/tutorials", authenticate, async (_req, res) => {
  try {
    const categories = await buildTutorialPayload({ onlyActive: true });
    return res.json({ ok: true, data: categories });
  } catch (error) {
    console.error("[tutorials GET]", error);
    return res.status(500).json({ message: "Erro ao listar tutoriais", error: error.message });
  }
});

router.get("/admin/tutorial-categories", authenticate, adminMiddleware, async (_req, res) => {
  try {
    const categories = await buildTutorialPayload();
    return res.json({ ok: true, data: categories });
  } catch (error) {
    console.error("[admin/tutorial-categories GET]", error);
    return res.status(500).json({ message: "Erro ao listar categorias", error: error.message });
  }
});

router.post("/admin/tutorial-categories", authenticate, adminMiddleware, async (req, res) => {
  try {
    const { name, description, color, active, sort_order } = req.body || {};
    if (!name) return res.status(400).json({ message: "Nome da categoria é obrigatório" });

    const baseSlug = slugify(name);
    if (!baseSlug) return res.status(400).json({ message: "Não foi possível gerar o slug da categoria" });

    let finalSlug = baseSlug;
    let suffix = 2;
    while (await TutorialCategory.findOne({ where: { slug: finalSlug } })) {
      finalSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const category = await TutorialCategory.create({
      slug: finalSlug,
      name,
      description: description || null,
      color: normalizeColor(color),
      active: active !== false,
      sort_order: Number(sort_order) || 0,
    });

    return res.status(201).json({ ok: true, data: category });
  } catch (error) {
    console.error("[admin/tutorial-categories POST]", error);
    return res.status(500).json({ message: "Erro ao criar categoria", error: error.message });
  }
});

router.put("/admin/tutorial-categories/:id", authenticate, adminMiddleware, async (req, res) => {
  try {
    const category = await TutorialCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ message: "Categoria não encontrada" });

    const payload = {};
    if ("name" in (req.body || {})) payload.name = req.body.name;
    if ("description" in (req.body || {})) payload.description = req.body.description || null;
    if ("color" in (req.body || {})) payload.color = normalizeColor(req.body.color);
    if ("active" in (req.body || {})) payload.active = req.body.active !== false;
    if ("sort_order" in (req.body || {})) payload.sort_order = Number(req.body.sort_order) || 0;

    if ("name" in payload && payload.name && payload.name !== category.name) {
      const nextSlug = slugify(payload.name);
      if (nextSlug) {
        let finalSlug = nextSlug;
        let suffix = 2;
        while (
          await TutorialCategory.findOne({
            where: {
              slug: finalSlug,
              id: { [Op.ne]: category.id },
            },
          })
        ) {
          finalSlug = `${nextSlug}-${suffix}`;
          suffix += 1;
        }
        payload.slug = finalSlug;
      }
    }

    await category.update(payload);
    return res.json({ ok: true, data: category });
  } catch (error) {
    console.error("[admin/tutorial-categories PUT]", error);
    return res.status(500).json({ message: "Erro ao atualizar categoria", error: error.message });
  }
});

router.delete("/admin/tutorial-categories/:id", authenticate, adminMiddleware, async (req, res) => {
  try {
    const category = await TutorialCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ message: "Categoria não encontrada" });

    await TutorialVideo.destroy({ where: { category_id: category.id } });
    await category.destroy();
    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin/tutorial-categories DELETE]", error);
    return res.status(500).json({ message: "Erro ao excluir categoria", error: error.message });
  }
});

router.get("/admin/tutorial-videos", authenticate, adminMiddleware, async (_req, res) => {
  try {
    const videos = await TutorialVideo.findAll({
      include: [{ model: TutorialCategory, as: "category" }],
      order: [
        ["sort_order", "ASC"],
        ["title", "ASC"],
      ],
    });
    return res.json({ ok: true, data: videos });
  } catch (error) {
    console.error("[admin/tutorial-videos GET]", error);
    return res.status(500).json({ message: "Erro ao listar vídeos", error: error.message });
  }
});

router.post("/admin/tutorial-videos", authenticate, adminMiddleware, async (req, res) => {
  try {
    const { category_id, title, youtube_url, description, active, sort_order } = req.body || {};
    if (!category_id) return res.status(400).json({ message: "Categoria é obrigatória" });
    if (!title) return res.status(400).json({ message: "Título do vídeo é obrigatório" });
    if (!youtube_url) return res.status(400).json({ message: "Link do vídeo é obrigatório" });

    const category = await TutorialCategory.findByPk(category_id);
    if (!category) return res.status(404).json({ message: "Categoria não encontrada" });

    const video = await TutorialVideo.create({
      category_id,
      title,
      youtube_url: normalizeYoutubeUrl(youtube_url),
      description: description || null,
      active: active !== false,
      sort_order: Number(sort_order) || 0,
    });

    return res.status(201).json({ ok: true, data: video });
  } catch (error) {
    console.error("[admin/tutorial-videos POST]", error);
    return res.status(500).json({ message: "Erro ao criar vídeo", error: error.message });
  }
});

router.put("/admin/tutorial-videos/:id", authenticate, adminMiddleware, async (req, res) => {
  try {
    const video = await TutorialVideo.findByPk(req.params.id);
    if (!video) return res.status(404).json({ message: "Vídeo não encontrado" });

    const payload = {};
    if ("category_id" in (req.body || {})) {
      const category = await TutorialCategory.findByPk(req.body.category_id);
      if (!category) return res.status(404).json({ message: "Categoria não encontrada" });
      payload.category_id = req.body.category_id;
    }
    if ("title" in (req.body || {})) payload.title = req.body.title;
    if ("youtube_url" in (req.body || {})) payload.youtube_url = normalizeYoutubeUrl(req.body.youtube_url);
    if ("description" in (req.body || {})) payload.description = req.body.description || null;
    if ("active" in (req.body || {})) payload.active = req.body.active !== false;
    if ("sort_order" in (req.body || {})) payload.sort_order = Number(req.body.sort_order) || 0;

    await video.update(payload);
    return res.json({ ok: true, data: video });
  } catch (error) {
    console.error("[admin/tutorial-videos PUT]", error);
    return res.status(500).json({ message: "Erro ao atualizar vídeo", error: error.message });
  }
});

router.delete("/admin/tutorial-videos/:id", authenticate, adminMiddleware, async (req, res) => {
  try {
    const video = await TutorialVideo.findByPk(req.params.id);
    if (!video) return res.status(404).json({ message: "Vídeo não encontrado" });
    await video.destroy();
    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin/tutorial-videos DELETE]", error);
    return res.status(500).json({ message: "Erro ao excluir vídeo", error: error.message });
  }
});

export default router;
