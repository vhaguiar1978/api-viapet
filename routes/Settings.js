import express from "express";
import Settings from "../models/Settings.js";
import Users from "../models/Users.js";
import owner from "../middlewares/owner.js";
import "dotenv/config";
import authenticate from "../middlewares/auth.js";
import upload from "../middlewares/fileImage.js";
const router = express.Router();

function getEstablishmentId(req) {
  return req.user?.establishment || req.user?.id;
}

function getSettingsEnvelope(settings) {
  return settings?.whatsappConnection || {};
}

function getAccountSettings(settings) {
  return getSettingsEnvelope(settings)?.accountSettings || {};
}

function getProfileSettings(settings) {
  return getSettingsEnvelope(settings)?.profileSettings || {};
}

function getAgendaSettings(settings) {
  return getSettingsEnvelope(settings)?.agendaSettings || {};
}

function buildAccountPayload(user, settings) {
  const accountSettings = getAccountSettings(settings);
  return {
    establishmentName: settings?.storeName || user?.name || "",
    naming: accountSettings.naming || "Pet e Responsavel",
    contactEmail: user?.email || "",
    contactPhone: user?.phone || "",
    crmAccessWhatsapp:
      accountSettings.crmAccessWhatsapp ||
      accountSettings.supportWhatsapp ||
      "551120977579",
    driverWhatsappRecipients: accountSettings.driverWhatsappRecipients || "",
    bankName: accountSettings.bankName || "",
    debitFee: accountSettings.debitFee || "1,99",
    creditFee: accountSettings.creditFee || "3,49",
    installmentFee: accountSettings.installmentFee || "4,99",
    pixFee: accountSettings.pixFee || "0",
    cashFee: accountSettings.cashFee || "0",
    electronicSignatureUrl: accountSettings.electronicSignatureUrl || "",
    electronicSignatureName: accountSettings.electronicSignatureName || "",
    expirationDate: user?.expirationDate || null,
  };
}

function buildResourcesPayload(settings) {
  const resources = getSettingsEnvelope(settings)?.resources || {};
  return {
    selected: Array.isArray(resources.selected) ? resources.selected : [],
  };
}

function buildPrintPayload(settings) {
  const printSettings = getSettingsEnvelope(settings)?.printSettings || {};
  return {
    useCompact: printSettings.useCompact !== false,
    showHeader: printSettings.showHeader !== false,
    showFooter: printSettings.showFooter !== false,
    printerName: printSettings.printerName || "Impressora termica padrao",
    paperSize: printSettings.paperSize || "A4",
  };
}

router.post(
  "/settings",
  upload.single("logo"),
  authenticate,
  owner,
  async (req, res) => {
    try {
      const settings = JSON.parse(req.body.settings);

      const userId = req.user.id;

      if (!settings) {
        return res.status(400).json({ message: "Nenhum dado fornecido" });
      }

      let user = await Settings.findOne({ where: { usersId: userId } });
      const currentEnvelope = getSettingsEnvelope(user);
      const currentProfileSettings = getProfileSettings(user);
      const currentAgendaSettings = getAgendaSettings(user);

      if (!user) {
        user = await Settings.create({
          usersId: userId,
          themeColor: settings.theme || null,
          storeName: settings.storeName ? settings.storeName.trim() : null,
          logoUrl: req.file
            ? `${process.env.URL}/uploads/${req.file.filename}`
            : typeof settings.logoUrl === "string"
              ? settings.logoUrl
              : null,
          intervalClinic: settings.intervalClinic || 10,
          intervalAesthetics: settings.intervalAesthetics || 23,
          notifyClient: settings.notifyClient || true,
          openingTime: settings.openingTime || "08:00:00",
          closingTime: settings.closingTime || "18:00:00",
          breakStartTime: settings.breakStartTime || "12:00:00",
          breakEndTime: settings.breakEndTime || "13:00:00",
          textColor: settings.textColor || "#000000",
          whatsappConnection: {
            profileSettings: {
              backgroundLogoUrl: settings.backgroundLogoUrl || "",
              backgroundLogoOpacity: settings.backgroundLogoOpacity || "0.08",
              backgroundLogoScope: settings.backgroundLogoScope || ["all"],
              signatureImageUrl: settings.signatureImageUrl || "",
            },
            agendaSettings: {
              statusLabels: settings.statusLabels || {},
            },
          },
        });
        return res
          .status(201)
          .json({ message: "Configurações criadas com sucesso", data: user });
      }

      if (settings.theme) {
        if (!/^#([0-9A-F]{3}){1,2}$/i.test(settings.theme)) {
          return res
            .status(400)
            .json({ message: "Formato de cor inválido. Use hexadecimal." });
        }
        user.themeColor = settings.theme;
      }

      if (settings.storeName) {
        if (
          typeof settings.storeName !== "string" ||
          settings.storeName.trim().length === 0
        ) {
          return res.status(400).json({ message: "Nome da loja inválido" });
        }
        user.storeName = settings.storeName.trim();
      }

      // Atualiza a URL da logo apenas se um novo arquivo foi enviado
      if (req.file) {
        user.logoUrl = `${process.env.URL}/uploads/${req.file.filename}`;
      } else if (typeof settings.logoUrl === "string") {
        user.logoUrl = settings.logoUrl;
      }

      if (settings.intervalClinic)
        user.intervalClinic = settings.intervalClinic;
      if (settings.intervalAesthetics)
        user.intervalAesthetics = settings.intervalAesthetics;
      if (settings.notifyClient !== undefined)
        user.notifyClient = settings.notifyClient;
      if (settings.openingTime) user.openingTime = settings.openingTime;
      if (settings.closingTime) user.closingTime = settings.closingTime;
      if (settings.breakStartTime)
        user.breakStartTime = settings.breakStartTime;
      if (settings.breakEndTime) user.breakEndTime = settings.breakEndTime;
      if (settings.textColor) user.textColor = settings.textColor;
      if (settings.workingDays) user.workingDays = settings.workingDays;
      user.whatsappConnection = {
        ...currentEnvelope,
        profileSettings: {
          ...currentProfileSettings,
          backgroundLogoUrl:
            typeof settings.backgroundLogoUrl === "string"
              ? settings.backgroundLogoUrl
              : currentProfileSettings.backgroundLogoUrl || "",
          backgroundLogoOpacity:
            typeof settings.backgroundLogoOpacity === "string"
              ? settings.backgroundLogoOpacity
              : currentProfileSettings.backgroundLogoOpacity || "0.08",
          backgroundLogoScope: Array.isArray(settings.backgroundLogoScope)
            ? settings.backgroundLogoScope
            : currentProfileSettings.backgroundLogoScope || ["all"],
          signatureImageUrl:
            typeof settings.signatureImageUrl === "string"
              ? settings.signatureImageUrl
              : currentProfileSettings.signatureImageUrl || "",
        },
        agendaSettings: {
          ...currentAgendaSettings,
          statusLabels:
            settings.statusLabels && typeof settings.statusLabels === "object"
              ? settings.statusLabels
              : currentAgendaSettings.statusLabels || {},
        },
      };

      await user.save();
      return res.status(200).json({ message: "Dados Atualizados" });
    } catch (error) {
      console.error("Erro ao atualizar configurações:", error);
      return res
        .status(500)
        .json({ message: "Erro no servidor", error: error.message });
    }
  },
);

router.get("/settings", authenticate, async (req, res) => {
  try {
    const user = await Settings.findOne({
      where: { usersId: req.user.establishment },
      attributes: [
        "themeColor",
        "storeName",
        "logoUrl",
        "intervalClinic",
        "intervalAesthetics",
        "notifyClient",
        "openingTime",
        "closingTime",
        "breakStartTime",
        "breakEndTime",
        "textColor",
        "whatsappConnection",
        "workingDays",
      ],
    });

    if (!user) {
      return res.status(404).json({
        message: "Configurações não encontradas",
      });
    }

    return res.status(200).json({
      message: "Configurações encontradas com sucesso",
      data: user,
    });
  } catch (error) {
    console.error("Erro ao buscar configurações:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.get("/settings/extended", authenticate, async (req, res) => {
  try {
    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
    });

    if (!settings) {
      return res.status(404).json({
        message: "Configuracoes nao encontradas",
      });
    }

    const profileSettings = getProfileSettings(settings);
    const agendaSettings = getAgendaSettings(settings);

    return res.status(200).json({
      message: "Configuracoes encontradas com sucesso",
      data: {
        ...settings.toJSON(),
        backgroundLogoUrl: profileSettings.backgroundLogoUrl || "",
        backgroundLogoOpacity: profileSettings.backgroundLogoOpacity || "0.08",
        backgroundLogoScope: profileSettings.backgroundLogoScope || ["all"],
        signatureImageUrl: profileSettings.signatureImageUrl || "",
        statusLabels: agendaSettings.statusLabels || {},
      },
    });
  } catch (error) {
    console.error("Erro ao buscar configuracoes estendidas:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.get("/settings/account", authenticate, async (req, res) => {
  try {
    const establishmentId = getEstablishmentId(req);
    const [settings, user] = await Promise.all([
      Settings.findOne({ where: { usersId: establishmentId } }),
      Users.findByPk(establishmentId),
    ]);

    return res.status(200).json({
      message: "Configuracoes da conta encontradas com sucesso",
      data: buildAccountPayload(user, settings),
    });
  } catch (error) {
    console.error("Erro ao buscar configuracoes da conta:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.post("/settings/account", authenticate, async (req, res) => {
  try {
    const establishmentId = getEstablishmentId(req);
    const {
      establishmentName,
      naming,
      contactEmail,
      contactPhone,
      crmAccessWhatsapp,
      supportWhatsapp,
      driverWhatsappRecipients,
      electronicSignatureUrl,
      electronicSignatureName,
    } = req.body || {};

    const [user, settingsFound] = await Promise.all([
      Users.findByPk(establishmentId),
      Settings.findOne({ where: { usersId: establishmentId } }),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "Usuario do estabelecimento nao encontrado",
      });
    }

    let settings = settingsFound;
    if (!settings) {
      settings = await Settings.create({
        usersId: establishmentId,
      });
    }

    if (typeof establishmentName === "string") {
      const cleanName = establishmentName.trim();
      settings.storeName = cleanName || settings.storeName || user.name;
    }

    if (typeof contactEmail === "string") {
      user.email = contactEmail.trim() || user.email;
    }

    if (typeof contactPhone === "string") {
      user.phone = contactPhone.trim();
    }

    settings.whatsappConnection = {
      ...(settings.whatsappConnection || {}),
      accountSettings: {
        ...getAccountSettings(settings),
        naming: typeof naming === "string" ? naming : "Pet e Responsavel",
        crmAccessWhatsapp:
          typeof crmAccessWhatsapp === "string"
            ? crmAccessWhatsapp
            : typeof supportWhatsapp === "string"
              ? supportWhatsapp
              : "551120977579",
        supportWhatsapp:
          typeof crmAccessWhatsapp === "string"
            ? crmAccessWhatsapp
            : typeof supportWhatsapp === "string"
              ? supportWhatsapp
              : "551120977579",
        driverWhatsappRecipients:
          typeof driverWhatsappRecipients === "string" ? driverWhatsappRecipients : "",
        bankName:
          typeof req.body?.bankName === "string"
            ? req.body.bankName
            : getAccountSettings(settings).bankName || "",
        debitFee:
          typeof req.body?.debitFee === "string"
            ? req.body.debitFee
            : getAccountSettings(settings).debitFee || "1,99",
        creditFee:
          typeof req.body?.creditFee === "string"
            ? req.body.creditFee
            : getAccountSettings(settings).creditFee || "3,49",
        installmentFee:
          typeof req.body?.installmentFee === "string"
            ? req.body.installmentFee
            : getAccountSettings(settings).installmentFee || "4,99",
        pixFee:
          typeof req.body?.pixFee === "string"
            ? req.body.pixFee
            : getAccountSettings(settings).pixFee || "0",
        cashFee:
          typeof req.body?.cashFee === "string"
            ? req.body.cashFee
            : getAccountSettings(settings).cashFee || "0",
        electronicSignatureUrl:
          typeof electronicSignatureUrl === "string"
            ? electronicSignatureUrl
            : getAccountSettings(settings).electronicSignatureUrl || "",
        electronicSignatureName:
          typeof electronicSignatureName === "string"
            ? electronicSignatureName
            : getAccountSettings(settings).electronicSignatureName || "",
      },
    };

    await Promise.all([user.save(), settings.save()]);

    return res.status(200).json({
      message: "Configuracoes da conta salvas com sucesso",
      data: buildAccountPayload(user, settings),
    });
  } catch (error) {
    console.error("Erro ao salvar configuracoes da conta:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.get("/settings/resources", authenticate, async (req, res) => {
  try {
    const establishmentId = getEstablishmentId(req);
    const settings = await Settings.findOne({ where: { usersId: establishmentId } });
    return res.status(200).json({
      message: "Configuracoes de recursos carregadas com sucesso",
      data: buildResourcesPayload(settings),
    });
  } catch (error) {
    console.error("Erro ao buscar configuracoes de recursos:", error);
    return res.status(500).json({ message: "Erro no servidor", error: error.message });
  }
});

router.post("/settings/resources", authenticate, async (req, res) => {
  try {
    const establishmentId = getEstablishmentId(req);
    const selected = Array.isArray(req.body?.selected) ? req.body.selected : [];
    let settings = await Settings.findOne({ where: { usersId: establishmentId } });
    if (!settings) {
      settings = await Settings.create({ usersId: establishmentId });
    }
    settings.whatsappConnection = {
      ...getSettingsEnvelope(settings),
      resources: {
        selected,
      },
    };
    await settings.save();
    return res.status(200).json({
      message: "Configuracoes de recursos salvas com sucesso",
      data: buildResourcesPayload(settings),
    });
  } catch (error) {
    console.error("Erro ao salvar configuracoes de recursos:", error);
    return res.status(500).json({ message: "Erro no servidor", error: error.message });
  }
});

router.get("/settings/print", authenticate, async (req, res) => {
  try {
    const establishmentId = getEstablishmentId(req);
    const settings = await Settings.findOne({ where: { usersId: establishmentId } });
    return res.status(200).json({
      message: "Configuracoes de impressao carregadas com sucesso",
      data: buildPrintPayload(settings),
    });
  } catch (error) {
    console.error("Erro ao buscar configuracoes de impressao:", error);
    return res.status(500).json({ message: "Erro no servidor", error: error.message });
  }
});

router.post("/settings/print", authenticate, async (req, res) => {
  try {
    const establishmentId = getEstablishmentId(req);
    let settings = await Settings.findOne({ where: { usersId: establishmentId } });
    if (!settings) {
      settings = await Settings.create({ usersId: establishmentId });
    }
    settings.whatsappConnection = {
      ...getSettingsEnvelope(settings),
      printSettings: {
        useCompact: req.body?.useCompact !== false,
        showHeader: req.body?.showHeader !== false,
        showFooter: req.body?.showFooter !== false,
        printerName: typeof req.body?.printerName === "string" ? req.body.printerName : "Impressora termica padrao",
        paperSize: typeof req.body?.paperSize === "string" ? req.body.paperSize : "A4",
      },
    };
    await settings.save();
    return res.status(200).json({
      message: "Configuracoes de impressao salvas com sucesso",
      data: buildPrintPayload(settings),
    });
  } catch (error) {
    console.error("Erro ao salvar configuracoes de impressao:", error);
    return res.status(500).json({ message: "Erro no servidor", error: error.message });
  }
});
// Get WhatsApp messages settings
router.get("/whatsapp-messages", authenticate, async (req, res) => {
  try {
    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
      attributes: ["whatsappMessages"],
    });

    if (!settings) {
      console.log("Erro: Configurações de mensagens não encontradas");
      return res.status(404).json({
        message: "Configurações de mensagens não encontradas",
      });
    }

    return res.status(200).json({
      message: "Configurações de mensagens encontradas com sucesso",
      data: settings.whatsappMessages,
    });
  } catch (error) {
    console.log("Erro ao buscar mensagens do WhatsApp:", error);
    console.error("Erro ao buscar mensagens do WhatsApp:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

// Update WhatsApp messages settings
router.post("/whatsapp-messages", authenticate, async (req, res) => {
  try {
    const { appointment, birthdayCustomer, birthdayPet } = req.body;

    if (!appointment || !birthdayCustomer || !birthdayPet) {
      console.log("Erro: Campos obrigatórios não preenchidos");
      return res.status(400).json({
        message: "Todas as mensagens são obrigatórias",
      });
    }

    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
    });

    if (!settings) {
      console.log("Erro: Configurações não encontradas");
      return res.status(404).json({
        message: "Configurações não encontradas",
      });
    }

    settings.whatsappMessages = {
      appointment,
      birthdayCustomer,
      birthdayPet,
    };

    await settings.save();

    return res.status(200).json({
      message: "Mensagens do WhatsApp atualizadas com sucesso",
    });
  } catch (error) {
    console.log("Erro ao atualizar mensagens do WhatsApp:", error);
    console.error("Erro ao atualizar mensagens do WhatsApp:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.get("/whatsapp-crm-config", authenticate, async (req, res) => {
  try {
    const settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
      attributes: ["whatsappConnection"],
    });

    const stored = settings?.whatsappConnection || {};
    const data = {
      provider: stored.provider || "WhatsApp Cloud API",
      phoneNumberId: stored.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      businessAccountId:
        stored.businessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
      verifyToken: stored.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || "genius",
      accessTokenPreview: stored.accessToken
        ? `${String(stored.accessToken).slice(0, 8)}...${String(stored.accessToken).slice(-4)}`
        : process.env.WHATSAPP_TOKEN
          ? "Configurado no servidor"
          : "",
      accessTokenConfigured: Boolean(
        stored.accessToken ||
        stored.accessTokenConfigured ||
          process.env.WHATSAPP_TOKEN
      ),
      defaultCountryCode: stored.defaultCountryCode || "55",
      webhookPath: "/webhook",
      webhookUrl: `${process.env.URL || ""}/webhook`,
      status:
        (stored.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID) &&
        (stored.accessTokenConfigured || process.env.WHATSAPP_TOKEN)
          ? "configured"
          : "pending",
    };

    return res.status(200).json({
      message: "Configuração do WhatsApp CRM carregada com sucesso",
      data,
    });
  } catch (error) {
    console.error("Erro ao buscar configuração do WhatsApp CRM:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.post("/whatsapp-crm-config", authenticate, async (req, res) => {
  try {
    const {
      provider,
      phoneNumberId,
      businessAccountId,
      verifyToken,
      accessToken,
      accessTokenConfigured,
      defaultCountryCode,
    } = req.body || {};

    let settings = await Settings.findOne({
      where: { usersId: req.user.establishment },
    });

    if (!settings) {
      settings = await Settings.create({
        usersId: req.user.establishment,
      });
    }

    settings.whatsappConnection = {
      ...(settings.whatsappConnection || {}),
      provider: provider || "WhatsApp Cloud API",
      phoneNumberId: phoneNumberId || "",
      businessAccountId: businessAccountId || "",
      verifyToken: verifyToken || "genius",
      accessToken:
        typeof accessToken === "string" && accessToken.trim()
          ? accessToken.trim()
          : settings.whatsappConnection?.accessToken || "",
      accessTokenConfigured: Boolean(
        (typeof accessToken === "string" && accessToken.trim()) ||
          settings.whatsappConnection?.accessToken ||
          accessTokenConfigured
      ),
      defaultCountryCode: defaultCountryCode || "55",
      updatedAt: new Date().toISOString(),
    };

    await settings.save();

    return res.status(200).json({
      message: "Configuração do WhatsApp CRM salva com sucesso",
      data: settings.whatsappConnection,
    });
  } catch (error) {
    console.error("Erro ao salvar configuração do WhatsApp CRM:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

export default router;
