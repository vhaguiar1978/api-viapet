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

const router = express.Router();

const ALLOWED_STATUSES = new Set(["pending", "attending", "closed"]);
const ALLOWED_MESSAGE_TYPES = new Set(["text", "image", "document", "audio"]);

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id || null;
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

    const [rows, all, pending, attending, closed] = await Promise.all([
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
      metadata: metadata || {},
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
      order: [
        ["receivedAt", "ASC"],
        ["sentAt", "ASC"],
        ["createdAt", "ASC"],
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

router.post("/crm-conversations/:conversationId/messages", authenticate, async (req, res) => {
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

    if (
      normalizedDirection === "outbound" &&
      sendNow &&
      String(conversation.channel || "whatsapp").toLowerCase() === "whatsapp"
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

      if (!phoneNumberId || !token) {
        return res.status(400).json({
          message: "WhatsApp Cloud API ainda nao esta configurado para o novo modulo",
        });
      }

      if (!destinationPhone) {
        return res.status(400).json({
          message: "A conversa nao possui telefone valido para envio",
        });
      }

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
        return res.status(500).json({
          message:
            sendError.response?.data?.error?.message ||
            "Nao foi possivel enviar a mensagem pelo WhatsApp",
          error: sendError.message,
        });
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
