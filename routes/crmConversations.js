import express from "express";
import axios from "axios";
import { Op } from "sequelize";
import authenticate from "../middlewares/auth.js";
import upload from "../middlewares/fileUpload.js";
import Settings from "../models/Settings.js";
import Custumers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import Users from "../models/Users.js";
import CrmWhatsappMessage from "../models/CrmWhatsappMessage.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import { enforcePlanLimit } from "../service/planLimits.js";
import BaileysService from "../service/baileys.js";

const router = express.Router();

const ALLOWED_STATUSES = new Set(["pending", "attending", "closed"]);
const ALLOWED_MESSAGE_TYPES = new Set(["text", "image", "document", "audio"]);
const DEFAULT_CRM_BOARD = {
  columns: [
    {
      id: "prospectar",
      label: "Prospectar",
      color: "#ffe4e8",
      description: "Novos contatos e primeiras conversas.",
    },
    {
      id: "qualificar",
      label: "Qualificar",
      color: "#ffdbe7",
      description: "Separar quem tem interesse real e contexto definido.",
    },
    {
      id: "necessidades",
      label: "Levantando necessidades",
      color: "#ffd3df",
      description: "Mapear servicos, dores e urgencia do cliente.",
    },
    {
      id: "proposta",
      label: "Proposta",
      color: "#ffd7ea",
      description: "Negociacoes e combinacoes comerciais em andamento.",
    },
    {
      id: "followup",
      label: "Follow-up",
      color: "#ffe3ef",
      description: "Retomar contatos e acompanhar decisoes pendentes.",
    },
    {
      id: "negociacao",
      label: "Negociacao",
      color: "#ffd8df",
      description: "Ajustes finais antes do fechamento.",
    },
    {
      id: "fechamento",
      label: "Contratar e cobrar",
      color: "#ffeef2",
      description: "Fechamento, pagamento e confirmacoes finais.",
    },
  ],
};

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
}

function slugifyBoardColumnId(value, fallback = "coluna") {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function sanitizeBoardColumn(column, index = 0, usedIds = new Set()) {
  const source = column && typeof column === "object" ? column : {};
  const label = String(source.label || source.name || "").trim() || `Coluna ${index + 1}`;
  let id = slugifyBoardColumnId(source.id || label, `coluna-${index + 1}`);

  while (usedIds.has(id)) {
    id = `${id}-${usedIds.size + 1}`;
  }

  usedIds.add(id);

  return {
    id,
    label,
    color: String(source.color || "#ffe4e8").trim() || "#ffe4e8",
    description: String(source.description || "").trim(),
  };
}

function sanitizeCrmBoardConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const usedIds = new Set();
  const requestedColumns = Array.isArray(source.columns) ? source.columns : [];
  const columns = (requestedColumns.length ? requestedColumns : DEFAULT_CRM_BOARD.columns)
    .map((column, index) => sanitizeBoardColumn(column, index, usedIds))
    .slice(0, 20);

  return {
    columns: columns.length ? columns : DEFAULT_CRM_BOARD.columns.map((column, index) => sanitizeBoardColumn(column, index, usedIds)),
  };
}

async function getOrCreateCrmBoardSettings(usersId) {
  let settings = await Settings.findOne({
    where: { usersId },
  });

  if (!settings) {
    settings = await Settings.create({
      usersId,
      whatsappConnection: {},
    });
  }

  const whatsappConnection =
    settings.whatsappConnection && typeof settings.whatsappConnection === "object"
      ? settings.whatsappConnection
      : {};

  const crmBoard = sanitizeCrmBoardConfig(whatsappConnection.crmBoard);

  return {
    settings,
    whatsappConnection,
    crmBoard,
  };
}

function buildPublicUploadUrl(req, fileName) {
  const baseUrl =
    process.env.API_URL ||
    process.env.URL ||
    `${req.protocol}://${req.get("host")}`;
  return `${baseUrl}/uploads/${fileName}`;
}

function sanitizeMessageType(messageType, mediaUrl) {
  const normalized = String(messageType || "").trim().toLowerCase();
  if (ALLOWED_MESSAGE_TYPES.has(normalized)) {
    return normalized;
  }
  return mediaUrl ? "document" : "text";
}

function buildWhatsappMessagePayload({
  destinationPhone,
  messageType,
  body,
  mediaUrl,
  mimeType,
  payload,
}) {
  if (messageType === "image" && mediaUrl) {
    return {
      messaging_product: "whatsapp",
      to: destinationPhone,
      type: "image",
      image: {
        link: mediaUrl,
        ...(body ? { caption: body } : {}),
      },
    };
  }

  if (messageType === "audio" && mediaUrl) {
    const normalizedMime = String(mimeType || "").toLowerCase();
    const supportedAudioMime = [
      "audio/ogg",
      "audio/ogg; codecs=opus",
      "audio/mpeg",
      "audio/mp4",
      "audio/aac",
      "audio/amr",
    ];

    if (!supportedAudioMime.includes(normalizedMime)) {
      return {
        messaging_product: "whatsapp",
        to: destinationPhone,
        type: "document",
        document: {
          link: mediaUrl,
          filename: payload?.fileName || "audio",
          ...(body ? { caption: body } : {}),
        },
      };
    }

    return {
      messaging_product: "whatsapp",
      to: destinationPhone,
      type: "audio",
      audio: {
        link: mediaUrl,
      },
    };
  }

  if (messageType === "document" && mediaUrl) {
    return {
      messaging_product: "whatsapp",
      to: destinationPhone,
      type: "document",
      document: {
        link: mediaUrl,
        filename: payload?.fileName || "arquivo",
        ...(body ? { caption: body } : {}),
      },
    };
  }

  return {
    messaging_product: "whatsapp",
    to: destinationPhone,
    type: "text",
    text: {
      body: body || "",
    },
  };
}

function getMetaErrorMessage(error) {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    ""
  );
}

function isMetaTokenInvalidError(error) {
  const rawMessage = String(getMetaErrorMessage(error) || "").toLowerCase();
  return (
    rawMessage.includes("error validating access token") ||
    rawMessage.includes("session has been invalidated") ||
    rawMessage.includes("access token") && rawMessage.includes("invalid")
  );
}

async function persistInvalidMetaToken(settings, error) {
  if (!settings) return;
  settings.whatsappConnection = {
    ...(settings.whatsappConnection || {}),
    accessToken: "",
    accessTokenConfigured: false,
    oauthConnectedAt: null,
    tokenInvalid: true,
    tokenErrorMessage: getMetaErrorMessage(error),
  };
  await settings.save();
}

function sanitizeStatus(value, fallback = "pending") {
  const normalized = String(value || "").trim().toLowerCase();
  return ALLOWED_STATUSES.has(normalized) ? normalized : fallback;
}

function buildSearchWhere(search) {
  const normalized = String(search || "").trim();
  if (!normalized) return {};

  return {
    [Op.or]: [
      { title: { [Op.like]: `%${normalized}%` } },
      { customerName: { [Op.like]: `%${normalized}%` } },
      { petName: { [Op.like]: `%${normalized}%` } },
      { phone: { [Op.like]: `%${normalized.replace(/\D/g, "")}%` } },
      { lastMessagePreview: { [Op.like]: `%${normalized}%` } },
    ],
  };
}

async function loadLinkedNames({ usersId, customerId, petId, customerName, petName, phone }) {
  let resolvedCustomer = null;
  let resolvedPet = null;

  if (customerId) {
    resolvedCustomer = await Custumers.findOne({
      where: {
        id: customerId,
        usersId,
      },
      attributes: ["id", "name", "phone"],
    });
  }

  if (petId) {
    resolvedPet = await Pets.findOne({
      where: {
        id: petId,
        usersId,
      },
      attributes: ["id", "name"],
    });
  }

  return {
    customerId: resolvedCustomer?.id || customerId || null,
    customerName: resolvedCustomer?.name || customerName || null,
    phone: normalizePhone(resolvedCustomer?.phone || phone),
    petId: resolvedPet?.id || petId || null,
    petName: resolvedPet?.name || petName || null,
  };
}

function buildConversationInclude() {
  return [
    {
      model: Custumers,
      as: "customer",
      attributes: [
        "id",
        "name",
        "phone",
        "email",
        "address",
        "city",
        "bairro",
        "observation",
      ],
      required: false,
    },
    {
      model: Pets,
      as: "pet",
      attributes: [
        "id",
        "name",
        "species",
        "breed",
        "color",
        "sex",
        "birthdate",
        "observation",
        "allergic",
      ],
      required: false,
    },
    {
      model: Users,
      as: "assignedUser",
      attributes: ["id", "name", "role"],
      required: false,
    },
  ];
}

router.get("/crm-conversations/summary", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const baseWhere = {
      usersId,
      isArchived: false,
      ...buildSearchWhere(req.query.search),
    };

    const [all, pending, attending, closed] = await Promise.all([
      CrmConversation.count({ where: baseWhere }),
      CrmConversation.count({ where: { ...baseWhere, status: "pending" } }),
      CrmConversation.count({ where: { ...baseWhere, status: "attending" } }),
      CrmConversation.count({ where: { ...baseWhere, status: "closed" } }),
    ]);

    return res.status(200).json({
      message: "Resumo das conversas carregado com sucesso",
      data: { all, pending, attending, closed },
    });
  } catch (error) {
    console.error("Erro ao carregar resumo das conversas:", error);
    return res.status(500).json({
      message: "Erro ao carregar resumo das conversas",
      error: error.message,
    });
  }
});

router.get("/crm-conversations/board/config", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const { crmBoard } = await getOrCreateCrmBoardSettings(usersId);

    return res.status(200).json({
      message: "Quadro do CRM carregado com sucesso",
      data: crmBoard,
    });
  } catch (error) {
    console.error("Erro ao carregar quadro do CRM:", error);
    return res.status(500).json({
      message: "Erro ao carregar quadro do CRM",
      error: error.message,
    });
  }
});

router.post("/crm-conversations/board/config", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const { settings, whatsappConnection } = await getOrCreateCrmBoardSettings(usersId);
    const crmBoard = sanitizeCrmBoardConfig(req.body || {});

    settings.whatsappConnection = {
      ...whatsappConnection,
      crmBoard,
    };

    await settings.save();

    return res.status(200).json({
      message: "Quadro do CRM atualizado com sucesso",
      data: crmBoard,
    });
  } catch (error) {
    console.error("Erro ao salvar quadro do CRM:", error);
    return res.status(500).json({
      message: "Erro ao salvar quadro do CRM",
      error: error.message,
    });
  }
});

router.get("/crm-conversations", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const status = String(req.query.status || "all").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);

    const baseWhere = {
      usersId,
      isArchived: false,
      ...buildSearchWhere(req.query.search),
    };
    const where = {
      ...baseWhere,
    };

    if (status !== "all") {
      where.status = sanitizeStatus(status);
    }

    if (req.query.channel) {
      where.channel = String(req.query.channel).trim().toLowerCase();
    }

    if (req.query.assignedUserId) {
      where.assignedUserId = req.query.assignedUserId;
    }

    if (req.query.customerId) {
      where.customerId = String(req.query.customerId).trim();
    }

    if (req.query.petId) {
      where.petId = String(req.query.petId).trim();
    }

    if (req.query.phone) {
      where.phone = normalizePhone(req.query.phone);
    }

    const tagFilter = req.query.tag ? String(req.query.tag).trim().toLowerCase() : null;

    const [rawRows, all, pending, attending, closed] = await Promise.all([
      CrmConversation.findAll({
        where,
        include: buildConversationInclude(),
        order: [
          ["isPinned", "DESC"],
          ["lastMessageAt", "DESC"],
          ["updatedAt", "DESC"],
        ],
        limit,
      }),
      CrmConversation.count({ where: baseWhere }),
      CrmConversation.count({ where: { ...baseWhere, status: "pending" } }),
      CrmConversation.count({ where: { ...baseWhere, status: "attending" } }),
      CrmConversation.count({ where: { ...baseWhere, status: "closed" } }),
    ]);

    // Filtro por tag (aplicado em memória — tags ficam em metadata.tags JSON)
    const rows = tagFilter
      ? rawRows.filter((row) => {
          const tags = Array.isArray(row.metadata?.tags) ? row.metadata.tags : [];
          return tags.map((t) => String(t).toLowerCase()).includes(tagFilter);
        })
      : rawRows;

    return res.status(200).json({
      message: "Conversas carregadas com sucesso",
      data: rows,
      summary: {
        all,
        pending,
        attending,
        closed,
      },
    });
  } catch (error) {
    console.error("Erro ao carregar conversas:", error);
    return res.status(500).json({
      message: "Erro ao carregar conversas",
      error: error.message,
    });
  }
});

router.post("/crm-conversations", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const {
      customerId,
      petId,
      assignedUserId,
      phone,
      channel,
      customerName,
      petName,
      title,
      notes,
      metadata,
      source,
      status,
    } = req.body || {};

    const linked = await loadLinkedNames({
      usersId,
      customerId,
      petId,
      customerName,
      petName,
      phone,
    });

    let existingConversation = null;

    if (linked.customerId) {
      existingConversation = await CrmConversation.findOne({
        where: {
          usersId,
          customerId: linked.customerId,
          isArchived: false,
        },
        order: [["lastMessageAt", "DESC"]],
      });
    }

    if (!existingConversation && linked.phone) {
      existingConversation = await CrmConversation.findOne({
        where: {
          usersId,
          phone: linked.phone,
          isArchived: false,
        },
        order: [["lastMessageAt", "DESC"]],
      });
    }

    const payload = {
      usersId,
      customerId: linked.customerId,
      petId: linked.petId,
      assignedUserId: assignedUserId || null,
      phone: linked.phone,
      customerName: linked.customerName,
      petName: linked.petName,
      channel: String(channel || "whatsapp").trim().toLowerCase(),
      status: sanitizeStatus(status),
      source: String(source || "crm").trim().toLowerCase() || "crm",
      title:
        String(title || "").trim() ||
        linked.customerName ||
        linked.petName ||
        linked.phone ||
        "Nova conversa",
      notes: notes || null,
      metadata:
        metadata !== undefined
          ? metadata || {}
          : existingConversation?.metadata || {},
    };

    const conversation = existingConversation
      ? await existingConversation.update({
          ...payload,
          unreadCount: existingConversation.unreadCount,
          isPinned: existingConversation.isPinned,
          isArchived: false,
        })
      : await CrmConversation.create(payload);

    const hydrated = await CrmConversation.findByPk(conversation.id, {
      include: buildConversationInclude(),
    });

    return res.status(existingConversation ? 200 : 201).json({
      message: existingConversation
        ? "Conversa atualizada com sucesso"
        : "Conversa criada com sucesso",
      data: hydrated,
    });
  } catch (error) {
    console.error("Erro ao criar conversa:", error);
    return res.status(500).json({
      message: "Erro ao criar conversa",
      error: error.message,
    });
  }
});

router.patch("/crm-conversations/:conversationId", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const conversation = await CrmConversation.findOne({
      where: {
        id: req.params.conversationId,
        usersId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversa nao encontrada",
      });
    }

    const linked = await loadLinkedNames({
      usersId,
      customerId: req.body?.customerId ?? conversation.customerId,
      petId: req.body?.petId ?? conversation.petId,
      customerName: req.body?.customerName ?? conversation.customerName,
      petName: req.body?.petName ?? conversation.petName,
      phone: req.body?.phone ?? conversation.phone,
    });

    await conversation.update({
      customerId: linked.customerId,
      petId: linked.petId,
      assignedUserId:
        req.body?.assignedUserId !== undefined
          ? req.body.assignedUserId || null
          : conversation.assignedUserId,
      phone: linked.phone || conversation.phone,
      customerName: linked.customerName,
      petName: linked.petName,
      title:
        req.body?.title !== undefined
          ? String(req.body.title || "").trim() || linked.customerName || linked.phone || conversation.title
          : conversation.title,
      notes: req.body?.notes !== undefined ? req.body.notes || null : conversation.notes,
      channel:
        req.body?.channel !== undefined
          ? String(req.body.channel || conversation.channel).trim().toLowerCase()
          : conversation.channel,
      source:
        req.body?.source !== undefined
          ? String(req.body.source || conversation.source).trim().toLowerCase()
          : conversation.source,
      status:
        req.body?.status !== undefined
          ? sanitizeStatus(req.body.status, conversation.status)
          : conversation.status,
      isPinned:
        req.body?.isPinned !== undefined
          ? Boolean(req.body.isPinned)
          : conversation.isPinned,
      isArchived:
        req.body?.isArchived !== undefined
          ? Boolean(req.body.isArchived)
          : conversation.isArchived,
      metadata:
        req.body?.metadata !== undefined
          ? req.body.metadata || {}
          : conversation.metadata,
    });

    const hydrated = await CrmConversation.findByPk(conversation.id, {
      include: buildConversationInclude(),
    });

    return res.status(200).json({
      message: "Conversa atualizada com sucesso",
      data: hydrated,
    });
  } catch (error) {
    console.error("Erro ao atualizar conversa:", error);
    return res.status(500).json({
      message: "Erro ao atualizar conversa",
      error: error.message,
    });
  }
});

// Aplica/remove uma tag em uma conversa
router.post("/crm-conversations/:conversationId/tags", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const conversation = await CrmConversation.findOne({
      where: { id: req.params.conversationId, usersId },
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversa nao encontrada" });
    }

    const tag = String(req.body?.tag || "").trim().toLowerCase();
    const action = String(req.body?.action || "add").trim().toLowerCase();

    if (!tag) {
      return res.status(400).json({ message: "Tag obrigatoria" });
    }

    const currentMeta = conversation.metadata || {};
    const currentTags = Array.isArray(currentMeta.tags) ? currentMeta.tags.map((t) => String(t).toLowerCase()) : [];

    let nextTags;
    if (action === "remove") {
      nextTags = currentTags.filter((t) => t !== tag);
    } else {
      nextTags = currentTags.includes(tag) ? currentTags : [...currentTags, tag];
    }

    await conversation.update({
      metadata: { ...currentMeta, tags: nextTags },
    });

    return res.status(200).json({
      message: action === "remove" ? "Tag removida" : "Tag aplicada",
      data: { tags: nextTags },
    });
  } catch (error) {
    console.error("Erro ao atualizar tags:", error);
    return res.status(500).json({ message: "Erro ao atualizar tags", error: error.message });
  }
});

// Retoma/pausa a IA em uma conversa especifica (apos escalacao para humano)
router.post("/crm-conversations/:conversationId/ai-resume", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const conversation = await CrmConversation.findOne({
      where: { id: req.params.conversationId, usersId },
    });
    if (!conversation) {
      return res.status(404).json({ message: "Conversa nao encontrada" });
    }
    const action = String(req.body?.action || "resume").toLowerCase();
    const meta = conversation.metadata || {};
    const next = { ...meta };
    if (action === "pause") {
      next.aiPaused = true;
      next.aiPausedAt = new Date().toISOString();
    } else {
      next.aiPaused = false;
      delete next.aiPausedAt;
      delete next.escalationReason;
      delete next.escalationMessage;
    }
    await conversation.update({ metadata: next });
    return res.status(200).json({
      message: action === "pause" ? "IA pausada" : "IA retomada",
      data: { aiPaused: Boolean(next.aiPaused) },
    });
  } catch (error) {
    console.error("Erro ao alternar IA:", error);
    return res.status(500).json({ message: "Erro ao alternar IA", error: error.message });
  }
});

router.post("/crm-conversations/:conversationId/read", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const conversation = await CrmConversation.findOne({
      where: {
        id: req.params.conversationId,
        usersId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversa nao encontrada",
      });
    }

    const now = new Date();

    await CrmConversationMessage.update(
      {
        readAt: now,
      },
      {
        where: {
          conversationId: conversation.id,
          usersId,
          direction: "inbound",
          readAt: null,
        },
      },
    );

    await conversation.update({
      unreadCount: 0,
    });

    return res.status(200).json({
      message: "Conversa marcada como lida",
    });
  } catch (error) {
    console.error("Erro ao marcar conversa como lida:", error);
    return res.status(500).json({
      message: "Erro ao marcar conversa como lida",
      error: error.message,
    });
  }
});

router.get("/crm-conversations/:conversationId/messages", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const conversation = await CrmConversation.findOne({
      where: {
        id: req.params.conversationId,
        usersId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversa nao encontrada",
      });
    }

    const rows = await CrmConversationMessage.findAll({
      where: {
        conversationId: conversation.id,
        usersId,
      },
      include: [
        {
          model: Users,
          as: "authorUser",
          attributes: ["id", "name", "role"],
          required: false,
        },
        {
          model: Custumers,
          as: "customer",
          attributes: ["id", "name", "phone"],
          required: false,
        },
        {
          model: Pets,
          as: "pet",
          attributes: ["id", "name"],
          required: false,
        },
      ],
      // Ordem cronologica unificada: usa createdAt (sempre presente),
      // intercala corretamente inbound/outbound conforme acontecem.
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"],
      ],
      limit: Math.min(Math.max(Number(req.query.limit || 200), 1), 500),
    });

    return res.status(200).json({
      message: "Mensagens carregadas com sucesso",
      data: rows,
    });
  } catch (error) {
    console.error("Erro ao carregar mensagens da conversa:", error);
    return res.status(500).json({
      message: "Erro ao carregar mensagens da conversa",
      error: error.message,
    });
  }
});

router.post(
  "/crm-conversations/upload",
  authenticate,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: "Nenhum arquivo foi enviado para o CRM.",
        });
      }

      const mimeType = String(req.file.mimetype || "").toLowerCase();
      const suggestedMessageType = mimeType.startsWith("image/")
        ? "image"
        : mimeType.startsWith("audio/")
          ? "audio"
          : "document";

      return res.status(200).json({
        message: "Arquivo enviado com sucesso.",
        data: {
          fileName: req.file.originalname || req.file.filename,
          storedName: req.file.filename,
          mimeType,
          size: req.file.size || 0,
          mediaUrl: buildPublicUploadUrl(req, req.file.filename),
          messageType: suggestedMessageType,
        },
      });
    } catch (error) {
      console.error("Erro ao enviar arquivo do CRM:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Nao foi possivel enviar o arquivo do CRM.",
      });
    }
  },
);

// Limpa todas as mensagens de uma conversa (mantem a conversa em si).
// Usado quando o dono quer "zerar o historico" da conversa pra recomecar
// limpo (testes com a IA, conversa antiga, etc.).
router.delete("/crm-conversations/:conversationId/messages", authenticate, async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const conversation = await CrmConversation.findOne({
      where: { id: req.params.conversationId, usersId },
    });
    if (!conversation) {
      return res.status(404).json({ message: "Conversa nao encontrada" });
    }

    const deleted = await CrmConversationMessage.destroy({
      where: { conversationId: conversation.id, usersId },
    });

    // Reseta os campos de "ultima mensagem" da conversa
    await conversation.update({
      lastMessagePreview: "",
      lastMessageAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      unreadCount: 0,
      // Tambem despausa a IA (se estava pausada por escalonamento) — comeca limpo
      metadata: {
        ...(conversation.metadata || {}),
        aiPaused: false,
        aiPausedAt: null,
        escalationReason: null,
        escalationMessage: null,
        clearedAt: new Date().toISOString(),
      },
    });

    console.log(
      `[CRM] Conversa ${conversation.id.slice(0, 8)} limpa por ${usersId} (${deleted} mensagens removidas)`,
    );
    return res.json({
      message: `${deleted} mensagens removidas com sucesso.`,
      data: { deleted, conversationId: conversation.id },
    });
  } catch (error) {
    console.error("Erro ao limpar conversa:", error);
    return res.status(500).json({
      message: "Nao foi possivel limpar a conversa",
      error: error.message,
    });
  }
});

router.post("/crm-conversations/:conversationId/messages", authenticate, enforcePlanLimit("messagesPerMonth"), async (req, res) => {
  try {
    const usersId = getEstablishmentId(req);
    const conversation = await CrmConversation.findOne({
      where: {
        id: req.params.conversationId,
        usersId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversa nao encontrada",
      });
    }

    const {
      body,
      direction = "outbound",
      messageType = "text",
      mediaUrl = null,
      mimeType = null,
      payload = {},
      sendNow = true,
    } = req.body || {};

    const normalizedDirection =
      String(direction || "outbound").trim().toLowerCase() === "inbound"
        ? "inbound"
        : "outbound";
    const normalizedBody = String(body || "").trim();
    const normalizedMessageType = sanitizeMessageType(messageType, mediaUrl);

    if (!normalizedBody && !mediaUrl) {
      return res.status(400).json({
        message: "Mensagem vazia nao pode ser enviada",
      });
    }

    let providerMessageId = null;
    let messageStatus =
      normalizedDirection === "inbound"
        ? "received"
        : sendNow
          ? "sent"
          : "draft";
    let errorMessage = null;
    const now = new Date();

    const channelLower = String(conversation.channel || "whatsapp").toLowerCase();
    const isWhatsappLikeChannel = channelLower === "whatsapp" || channelLower === "baileys";

    if (
      normalizedDirection === "outbound" &&
      sendNow &&
      isWhatsappLikeChannel
    ) {
      const settings = await Settings.findOne({
        where: {
          usersId,
        },
      });

      const config = settings?.whatsappConnection || {};
      const phoneNumberId =
        config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
      const token = config.accessToken || process.env.WHATSAPP_TOKEN || "";
        const destinationPhone = normalizePhone(conversation.phone);

      if (!destinationPhone) {
        return res.status(400).json({
          message: "A conversa nao possui telefone valido para envio",
        });
      }

      // Estrategia: Baileys tem prioridade absoluta quando conectado.
      // Se conectou via QR, e isso que o usuario escolheu usar.
      // Cloud API so e usado se Baileys nao esta conectado.
      const cloudApiConfigured = Boolean(phoneNumberId && token);

      let baileysConnected = false;
      let baileysInstance = null;
      try {
        baileysInstance = BaileysService.getInstance(usersId, "default");
        baileysConnected = await baileysInstance.isConnected();

        // AUTO-RECOVERY: Se a instancia esta disconnected mas o user TEM creds salvas
        // no DB (ja escaneou o QR antes), tenta reabrir a sessao na hora.
        // Isso resolve o caso de o servidor ter reiniciado e o reinit em background
        // ainda nao ter chegado neste user.
        if (!baileysConnected) {
          const hasCreds = Boolean(config?.baileys?.authState?.creds);
          if (hasCreds && baileysInstance.connectionStatus !== "scanning") {
            console.log(`[CRM Send] Tentando auto-recovery do Baileys para user=${usersId}`);
            try {
              await baileysInstance.initialize();
              // Espera ate 8s pelo socket abrir
              const startedAt = Date.now();
              while (Date.now() - startedAt < 8000) {
                if (baileysInstance.connectionStatus === "connected") break;
                if (baileysInstance.connectionStatus === "error") break;
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
              baileysConnected = await baileysInstance.isConnected();
              console.log(
                `[CRM Send] Auto-recovery resultado: status=${baileysInstance.connectionStatus} connected=${baileysConnected}`,
              );
            } catch (recoveryErr) {
              console.warn("[CRM Send] Auto-recovery falhou:", recoveryErr?.message);
            }
          }
        }
      } catch (_) {
        baileysConnected = false;
      }

      console.log(`[CRM Send] user=${usersId} channel=${channelLower} baileys=${baileysConnected} cloudApi=${cloudApiConfigured}`);
      const shouldUseBaileys = baileysConnected;

      if (shouldUseBaileys) {
        try {
          // Prefere o JID original do contato (ex: @lid do Baileys 7.x).
          // Fallback: monta @s.whatsapp.net pelo telefone normalizado.
          const baileysJid = conversation?.metadata?.baileysJid;
          const target = baileysJid || destinationPhone;
          const result = await baileysInstance.sendMessage(target, normalizedBody || "");
          providerMessageId = result?.key?.id || `baileys_${Date.now()}`;
        } catch (baileysError) {
          console.error("Erro ao enviar via Baileys:", baileysError);
          if (String(baileysError.message || "").includes("Rate limit")) {
            return res.status(429).json({
              message: "Limite de envio por hora atingido. Aguarde alguns minutos.",
            });
          }
          return res.status(500).json({
            message: baileysError.message || "Nao foi possivel enviar a mensagem pelo WhatsApp",
          });
        }
      } else if (!cloudApiConfigured && !baileysConnected) {
        return res.status(400).json({
          message: "WhatsApp nao esta conectado. Conecte via QR Code para enviar mensagens.",
        });
      } else {

        try {
        const whatsappPayload = buildWhatsappMessagePayload({
          destinationPhone,
          messageType: normalizedMessageType,
          body: normalizedBody,
          mediaUrl,
          mimeType,
          payload,
        });

          const response = await axios.post(
            `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          whatsappPayload,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        providerMessageId = response?.data?.messages?.[0]?.id || null;

        await CrmWhatsappMessage.create({
          usersId,
          customerId: conversation.customerId || null,
          customerName: conversation.customerName || null,
          phone: destinationPhone,
          direction: "outbound",
          channel: "whatsapp",
          messageType: normalizedMessageType,
          body: normalizedBody || (mediaUrl ? "[midia]" : null),
          whatsappMessageId: providerMessageId,
          status: "sent",
          receivedAt: now,
          payload: {
            ...(response?.data || {}),
            mediaUrl,
            mimeType,
            fileName: payload?.fileName || null,
          },
        });
      } catch (sendError) {
        console.error("Erro ao enviar mensagem na nova conversa CRM:", sendError.response?.data || sendError);

        if (isMetaTokenInvalidError(sendError)) {
          try {
            await persistInvalidMetaToken(settings, sendError);
          } catch (persistError) {
            console.error("Erro ao marcar token invalido na conversa CRM:", persistError);
          }

          return res.status(409).json({
            message: "A conexao com a Meta expirou. Reconecte o WhatsApp para voltar a enviar mensagens.",
            requiresReconnect: true,
            tokenInvalid: true,
          });
        }

        return res.status(500).json({
          message: getMetaErrorMessage(sendError) || "Nao foi possivel enviar a mensagem pelo WhatsApp",
          error: sendError.message,
        });
      }
      }
    }

    if (normalizedDirection === "outbound" && !sendNow) {
      messageStatus = "draft";
    }

    const message = await CrmConversationMessage.create({
      conversationId: conversation.id,
      usersId,
      customerId: conversation.customerId || null,
      petId: conversation.petId || null,
      authorUserId: req.user?.id || null,
      direction: normalizedDirection,
      channel: conversation.channel,
      messageType: normalizedMessageType,
      body: normalizedBody || null,
      mediaUrl,
      mimeType,
      providerMessageId,
      status: messageStatus,
      errorMessage,
      sentAt: normalizedDirection === "outbound" ? now : null,
      receivedAt: normalizedDirection === "inbound" ? now : null,
      payload,
    });

    const nextStatus =
      normalizedDirection === "inbound"
        ? conversation.status === "closed"
          ? "pending"
          : conversation.status
        : "attending";

    await conversation.update({
      lastMessagePreview: normalizedBody || "[midia]",
      lastMessageAt: now,
      lastInboundAt:
        normalizedDirection === "inbound" ? now : conversation.lastInboundAt,
      lastOutboundAt:
        normalizedDirection === "outbound" ? now : conversation.lastOutboundAt,
      unreadCount:
        normalizedDirection === "inbound" ? (conversation.unreadCount || 0) + 1 : 0,
      status: nextStatus,
    });

    const hydrated = await CrmConversationMessage.findByPk(message.id, {
      include: [
        {
          model: Users,
          as: "authorUser",
          attributes: ["id", "name", "role"],
          required: false,
        },
      ],
    });

    return res.status(201).json({
      message: "Mensagem registrada com sucesso",
      data: hydrated,
    });
  } catch (error) {
    console.error("Erro ao registrar mensagem da conversa:", error);
    return res.status(500).json({
      message: "Erro ao registrar mensagem da conversa",
      error: error.message,
    });
  }
});

export default router;
