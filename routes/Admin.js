import express from "express";
import Admin from "../models/Admin.js";
import adminMiddleware from "../middlewares/admin.js";
import Settings from "../models/Settings.js";
import Users from "../models/Users.js";
import bcrypt from "bcrypt";
import { Op } from "sequelize";
import validator from "validator";
import Products from "../models/Products.js";
import Services from "../models/Services.js";
import Appointments from "../models/Appointments.js";
import AppointmentItem from "../models/AppointmentItem.js";
import AppointmentPayment from "../models/AppointmentPayment.js";
import AppointmentStatusHistory from "../models/AppointmentStatusHistory.js";
import Sales from "../models/Sales.js";
import SaleItem from "../models/SaleItem.js";
import Customers from "../models/Custumers.js";
import Pets from "../models/Pets.js";
import LoginHistory from "../models/LoginHistory.js";
import Finances from "../models/Finance.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";
import CrmWhatsappMessage from "../models/CrmWhatsappMessage.js";
import Subscription from "../models/Subscription.js";
import PaymentHistory from "../models/PaymentHistory.js";
import Drivers from "../models/Drivers.js";
import Purchases from "../models/Purchases.js";
import PurchaseItems from "../models/PurchaseItems.js";
import ServiceCategories from "../models/ServiceCategories.js";
import VaccinePlan from "../models/VaccinePlan.js";
import FinancialRecords from "../models/FinancialRecords.js";
import CashClosure from "../models/CashClosure.js";
import jwt from "jsonwebtoken";
import BillingSettings from "../models/BillingSettings.js";
import ClientAccessControl from "../models/ClientAccessControl.js";
import CrmAiActionLog from "../models/CrmAiActionLog.js";
import CrmConversation from "../models/CrmConversation.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import EmailCampaign from "../models/EmailCampaign.js";
import EmailCampaignLog from "../models/EmailCampaignLog.js";
import PersonalFinance from "../models/personal_finances.js";
import WhatsappConnection from "../models/WhatsappConnection.js";
import WhatsappMessage from "../models/WhatsappMessage.js";
import WhatsappTemplate from "../models/WhatsappTemplate.js";
import WhatsappWebhookLog from "../models/WhatsappWebhookLog.js";
import { createSubscriptionPreference } from "../service/mercadopago.js";
import emailService from "../service/email.js";
import { ensureDefaultMedicalCatalog } from "../service/defaultMedicalCatalog.js";
const router = express.Router();
const SYSTEM_GENERATED_USER_EMAIL_PATTERN = "indefinido.%@sistema.com";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_REGEX.test(String(value || "").trim());
}

function buildRealEmployeeWhere(extraWhere = {}) {
  return {
    [Op.and]: [
      extraWhere,
      { role: "funcionario" },
      {
        email: {
          [Op.notLike]: SYSTEM_GENERATED_USER_EMAIL_PATTERN,
        },
      },
    ],
  };
}

async function getOrCreateAdminSettings() {
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "mercadoPagoAccessToken" TEXT',
  );
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "siteConsultantWhatsapp" VARCHAR(255) DEFAULT \'\'',
  );
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "emailSystemEnabled" BOOLEAN DEFAULT TRUE',
  );
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "emailPasswordResetEnabled" BOOLEAN DEFAULT TRUE',
  );
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "emailWelcomeEnabled" BOOLEAN DEFAULT TRUE',
  );
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "emailLoginAlertEnabled" BOOLEAN DEFAULT TRUE',
  );
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "emailEmployeeWelcomeEnabled" BOOLEAN DEFAULT TRUE',
  );
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "emailPlanReminderEnabled" BOOLEAN DEFAULT TRUE',
  );
  await Admin.sequelize.query(
    'ALTER TABLE "admin" ADD COLUMN IF NOT EXISTS "emailCampaignEnabled" BOOLEAN DEFAULT TRUE',
  );

  let settings = await Admin.findOne();

  if (!settings) {
    settings = await Admin.create({});
  }

  return settings;
}

function generateTemporaryPassword() {
  const random = Math.random().toString(36).slice(-4).toUpperCase();
  return `ViaPet@${random}`;
}

const DEFAULT_CLIENT_ACCESS_FEATURES = [
  { id: "agenda", label: "Agenda" },
  { id: "cadastros", label: "Cadastros" },
  { id: "financeiro", label: "Financeiro" },
  { id: "crm", label: "CRM e Chat" },
  { id: "crm-ai", label: "IA do CRM" },
  { id: "whatsapp", label: "WhatsApp CRM" },
  { id: "clientes", label: "Clientes e tutores" },
  { id: "pets", label: "Pets e pacientes" },
  { id: "pacotes", label: "Pacotinhos" },
  { id: "exames", label: "Exames" },
  { id: "fila", label: "Fila" },
  { id: "internacao", label: "Internacao" },
  { id: "mensagens", label: "Mensagens" },
  { id: "venda", label: "Venda PDV" },
  { id: "viacentral", label: "ViaCentral" },
  { id: "configuracoes", label: "Configuracoes" },
];

function normalizeClientAccessRecord(accessControl) {
  const enabledFeatures = Array.isArray(accessControl?.features)
    ? accessControl.features.map((item) => String(item || "").trim()).filter(Boolean)
    : DEFAULT_CLIENT_ACCESS_FEATURES.map((item) => item.id);

  return {
    status: accessControl?.status || "active",
    features: enabledFeatures,
    featureCatalog: DEFAULT_CLIENT_ACCESS_FEATURES,
    accessStartsAt: accessControl?.access_starts_at || null,
    accessEndsAt: accessControl?.access_ends_at || null,
    unlimitedAccess: Boolean(accessControl?.unlimited_access),
    notes: accessControl?.notes || "",
  };
}

async function getOrCreateClientAccessControl(userId) {
  const [accessControl] = await ClientAccessControl.findOrCreate({
    where: { user_id: userId },
    defaults: {
      user_id: userId,
      status: "active",
      features: DEFAULT_CLIENT_ACCESS_FEATURES.map((item) => item.id),
      unlimited_access: false,
    },
  });

  return accessControl;
}

function buildFirstAccessToken(user) {
  const jwtSecret = process.env.JWT_SECRET;
  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      establishment: user.establishment,
      firstaccess: true,
    },
    jwtSecret,
    { expiresIn: "7d" },
  );

  return {
    token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

function readFirstAccessState(user) {
  if (!user?.recoveryPassToken || !user?.timeRecoveryPass) {
    return { active: false };
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    const decoded = jwt.verify(user.recoveryPassToken, jwtSecret);
    const expiresAt = new Date(user.timeRecoveryPass);
    return {
      active: decoded?.firstaccess === true && expiresAt >= new Date(),
      expiresAt,
    };
  } catch {
    return { active: false };
  }
}

function readPasswordResetState(user) {
  if (!user?.recoveryPassToken || !user?.timeRecoveryPass) {
    return { active: false, requestedAt: null, expiresAt: null };
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    const decoded = jwt.verify(user.recoveryPassToken, jwtSecret);
    if (decoded?.resetpass !== true) {
      return { active: false, requestedAt: null, expiresAt: null };
    }

    const expiresAt = new Date(user.timeRecoveryPass);
    const requestedAt = new Date(expiresAt.getTime() - 60 * 60 * 1000);
    return {
      active: expiresAt >= new Date(),
      requestedAt,
      expiresAt,
    };
  } catch {
    return { active: false, requestedAt: null, expiresAt: null };
  }
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek() {
  const date = startOfToday();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function startOfMonth() {
  const date = startOfToday();
  date.setDate(1);
  return date;
}

async function getOrCreateBillingSettings() {
  let settings = await BillingSettings.findOne({
    order: [["createdAt", "DESC"]],
  });

  if (!settings) {
    settings = await BillingSettings.create({
      monthlyPrice: 69.9,
      promotionalPrice: 39.9,
      trialDays: 30,
      promotionalMonths: 3,
      reminderDays: 7,
      mercadoPagoEnabled: true,
    });
  }

  return settings;
}

function getBillingProfile(user, subscription, settings) {
  const now = new Date();
  const expirationDate = user?.expirationDate ? new Date(user.expirationDate) : null;
  const daysUntilExpiry = expirationDate
    ? Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24))
    : null;
  const planType = String(subscription?.plan_type || "").toLowerCase();
  const isFree =
    String(subscription?.notes || "").toLowerCase().includes("sem custo") ||
    (subscription?.amount != null && Number(subscription.amount) === 0 && planType !== "trial");

  let stage = "monthly";
  let nextChargeAmount = Number(settings.monthlyPrice || 69.9);
  let nextChargePlanType = "monthly";
  let reminderDue = false;

  if (isFree) {
    stage = "free";
    nextChargeAmount = 0;
    nextChargePlanType = "monthly";
  } else if (planType === "trial") {
    stage = "trial";
    nextChargeAmount = Number(settings.promotionalPrice || 39.9);
    nextChargePlanType = "promotional";
  } else if (
    planType === "promotional" &&
    Number(subscription?.promotional_months_used || 0) < Number(settings.promotionalMonths || 3)
  ) {
    stage = "promotional";
    nextChargeAmount = Number(settings.promotionalPrice || 39.9);
    nextChargePlanType = "promotional";
  }

  if (!isFree && daysUntilExpiry != null && daysUntilExpiry <= Number(settings.reminderDays || 7) && daysUntilExpiry >= 0) {
    reminderDue = true;
  }

  return {
    stage,
    daysUntilExpiry,
    overdue: !isFree && daysUntilExpiry != null && daysUntilExpiry < 0,
    reminderDue,
    nextChargeAmount,
    nextChargePlanType,
  };
}

async function ensureMainSubscription(userId) {
  let subscription = await Subscription.findOne({
    where: { user_id: userId },
    order: [["created_at", "DESC"]],
  });

  if (!subscription) {
    subscription = await Subscription.create({
      user_id: userId,
      plan_type: "monthly",
      status: "pending",
      payment_status: "pending",
      amount: 69.9,
      currency: "BRL",
      notes: "Assinatura principal do ViaPet criada automaticamente",
    });
  }

  return subscription;
}

async function registerMainPlanHistory(user, payload = {}) {
  const subscription = await ensureMainSubscription(user.id);
  const now = new Date();
  const billingPeriodStart = payload.billingPeriodStart || now;
  const billingPeriodEnd = payload.billingPeriodEnd || user.expirationDate || null;

  await subscription.update({
    plan_type: payload.planType || "monthly",
    status: payload.subscriptionStatus || "active",
    payment_status: payload.paymentStatus || "approved",
    amount: payload.amount ?? 69.9,
    currency: "BRL",
    billing_cycle_start: billingPeriodStart,
    billing_cycle_end: billingPeriodEnd,
    next_billing_date: payload.nextBillingDate ?? billingPeriodEnd,
    trial_start: payload.isTrial ? billingPeriodStart : null,
    trial_end: payload.isTrial ? billingPeriodEnd : null,
    payment_method: payload.paymentMethod || null,
    notes: payload.notes || subscription.notes,
  });

  await PaymentHistory.create({
    subscription_id: subscription.id,
    user_id: user.id,
    payment_id: payload.paymentId || null,
    external_reference: payload.externalReference || null,
    merchant_order_id: null,
    status: payload.historyStatus || "approved",
    amount: payload.amount ?? 69.9,
    currency: "BRL",
    payment_method: payload.paymentMethod || null,
    payment_type: payload.paymentType || null,
    installments: 1,
    date_created: now,
    date_approved: payload.historyStatus === "approved" ? now : null,
    date_last_updated: now,
    billing_period_start: billingPeriodStart,
    billing_period_end: billingPeriodEnd,
    plan_type: payload.planType || "monthly",
    is_trial: Boolean(payload.isTrial),
    webhook_data: null,
    notes: payload.notes || null,
  });

  return subscription;
}

router.get("/public/site-contact", async (_req, res) => {
  try {
    const settings = await getOrCreateAdminSettings();
    return res.status(200).json({
      message: "Contato publico carregado com sucesso",
      data: {
        siteConsultantWhatsapp: settings.siteConsultantWhatsapp || "551120977579",
      },
    });
  } catch (error) {
    console.error("Erro ao buscar contato publico:", error);
    return res.status(500).json({
      message: "Erro ao buscar contato publico",
      error: error.message,
    });
  }
});

router.get("/settings/admin", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateAdminSettings();

    // Retorna os dados sem a senha
    const settingsData = {
      ...settings.toJSON(),
      smtpPassword: settings.smtpPassword ? "********" : null, // Mascara a senha se existir
    };

    return res.status(200).json({
      message: "Configurações administrativas encontradas com sucesso",
      data: settingsData,
    });
  } catch (error) {
    console.error("Erro ao buscar configurações administrativas:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.post("/settings/admin", adminMiddleware, async (req, res) => {
  try {
    const {
      smtpHost,
      smtpPort,
      smtpEmail,
      smtpPassword,
      mercadoPagoAccessToken,
      siteConsultantWhatsapp,
      tiktok,
      facebook,
      instagram,
      youtube,
      emailSystemEnabled,
      emailPasswordResetEnabled,
      emailWelcomeEnabled,
      emailLoginAlertEnabled,
      emailEmployeeWelcomeEnabled,
      emailPlanReminderEnabled,
      emailCampaignEnabled,
    } = req.body;
    let settings = await getOrCreateAdminSettings();

    // Atualiza os campos existentes
    if (smtpHost !== undefined) settings.smtpHost = smtpHost;
    if (smtpPort !== undefined) settings.smtpPort = smtpPort;
    if (smtpEmail !== undefined) settings.smtpEmail = smtpEmail;
    if (smtpPassword) settings.smtpPassword = smtpPassword;
    if (mercadoPagoAccessToken !== undefined)
      settings.mercadoPagoAccessToken = mercadoPagoAccessToken;
    if (siteConsultantWhatsapp !== undefined)
      settings.siteConsultantWhatsapp = siteConsultantWhatsapp;
    if (tiktok !== undefined) settings.tiktok = tiktok;
    if (facebook !== undefined) settings.facebook = facebook;
    if (instagram !== undefined) settings.instagram = instagram;
    if (youtube !== undefined) settings.youtube = youtube;
    if (emailSystemEnabled !== undefined) settings.emailSystemEnabled = Boolean(emailSystemEnabled);
    if (emailPasswordResetEnabled !== undefined) settings.emailPasswordResetEnabled = Boolean(emailPasswordResetEnabled);
    if (emailWelcomeEnabled !== undefined) settings.emailWelcomeEnabled = Boolean(emailWelcomeEnabled);
    if (emailLoginAlertEnabled !== undefined) settings.emailLoginAlertEnabled = Boolean(emailLoginAlertEnabled);
    if (emailEmployeeWelcomeEnabled !== undefined) settings.emailEmployeeWelcomeEnabled = Boolean(emailEmployeeWelcomeEnabled);
    if (emailPlanReminderEnabled !== undefined) settings.emailPlanReminderEnabled = Boolean(emailPlanReminderEnabled);
    if (emailCampaignEnabled !== undefined) settings.emailCampaignEnabled = Boolean(emailCampaignEnabled);

    await settings.save();

    return res.status(200).json({
      message: "Configurações administrativas atualizadas com sucesso",
    });
  } catch (error) {
    console.error("Erro ao atualizar configurações administrativas:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.post("/settings/admin/test-email", adminMiddleware, async (req, res) => {
  try {
    const recipientEmail = String(req.body?.recipientEmail || "").trim();
    if (!recipientEmail || !validator.isEmail(recipientEmail)) {
      return res.status(400).json({
        message: "Informe um e-mail valido para o teste.",
      });
    }

    await emailService.sendAdminTestEmail(recipientEmail);

    return res.status(200).json({
      message: "E-mail de teste enviado com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao enviar e-mail de teste SMTP:", error);
    return res.status(500).json({
      message: "Erro ao enviar o e-mail de teste.",
      error: error.message,
    });
  }
});

router.get("/admin/access-feature-catalog", adminMiddleware, async (_req, res) => {
  return res.status(200).json({
    message: "Catalogo de acessos carregado com sucesso",
    data: DEFAULT_CLIENT_ACCESS_FEATURES,
  });
});

router.put("/admin/clients/:id/access-control", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status = "active",
      features = [],
      accessStartsAt = null,
      accessEndsAt = null,
      unlimitedAccess = false,
      notes = "",
    } = req.body || {};

    const user = await Users.findOne({
      where: { id, role: "proprietario" },
      attributes: ["id", "name", "email"],
    });

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    const validFeatureIds = new Set(DEFAULT_CLIENT_ACCESS_FEATURES.map((item) => item.id));
    const normalizedFeatures = Array.isArray(features)
      ? features.map((item) => String(item || "").trim()).filter((item) => validFeatureIds.has(item))
      : [];

    const accessControl = await getOrCreateClientAccessControl(id);
    await accessControl.update({
      status: String(status || "active").toLowerCase() === "blocked" ? "blocked" : "active",
      features: normalizedFeatures.length
        ? normalizedFeatures
        : DEFAULT_CLIENT_ACCESS_FEATURES.map((item) => item.id),
      access_starts_at: accessStartsAt ? new Date(accessStartsAt) : null,
      access_ends_at:
        !unlimitedAccess && accessEndsAt ? new Date(accessEndsAt) : null,
      unlimited_access: Boolean(unlimitedAccess),
      notes: notes || "",
    });

    return res.status(200).json({
      message: "Controle de acesso salvo com sucesso",
      data: normalizeClientAccessRecord(accessControl),
    });
  } catch (error) {
    console.error("Erro ao salvar controle de acesso:", error);
    return res.status(500).json({
      message: "Erro ao salvar controle de acesso",
      error: error.message,
    });
  }
});

router.get("/admin/email-campaigns", adminMiddleware, async (_req, res) => {
  try {
    const campaigns = await EmailCampaign.findAll({
      order: [["updated_at", "DESC"]],
    });
    const logs = await EmailCampaignLog.findAll({
      limit: 80,
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      message: "Campanhas de e-mail carregadas com sucesso",
      data: {
        campaigns: campaigns.map((campaign) => campaign.toJSON()),
        logs: logs.map((log) => log.toJSON()),
      },
    });
  } catch (error) {
    console.error("Erro ao carregar campanhas de e-mail:", error);
    return res.status(500).json({
      message: "Erro ao carregar campanhas de e-mail",
      error: error.message,
    });
  }
});

router.post("/admin/email-campaigns", adminMiddleware, async (req, res) => {
  try {
    const {
      name,
      subject,
      previewText = "",
      contentHtml = "",
      contentText = "",
      targetMode = "all",
      selectedClientIds = [],
      automaticEnabled = false,
      scheduleType = "weekly",
      sendDaysOfWeek = [],
      sendTime = "09:00",
      frequencyDays = 7,
      status = "draft",
    } = req.body || {};

    if (!String(name || "").trim() || !String(subject || "").trim()) {
      return res.status(400).json({
        message: "Informe nome e assunto para a campanha.",
      });
    }

    const campaign = await EmailCampaign.create({
      name: String(name || "").trim(),
      subject: String(subject || "").trim(),
      previewText: String(previewText || ""),
      contentHtml: String(contentHtml || ""),
      contentText: String(contentText || ""),
      targetMode: String(targetMode || "all").toLowerCase() === "selected" ? "selected" : "all",
      selectedClientIds: Array.isArray(selectedClientIds) ? selectedClientIds : [],
      automaticEnabled: Boolean(automaticEnabled),
      scheduleType: String(scheduleType || "weekly").toLowerCase() === "interval" ? "interval" : "weekly",
      sendDaysOfWeek: Array.isArray(sendDaysOfWeek) ? sendDaysOfWeek : [],
      sendTime: String(sendTime || "09:00"),
      frequencyDays: Math.max(1, Number(frequencyDays || 7)),
      status: ["draft", "active", "paused"].includes(String(status || "").toLowerCase())
        ? String(status).toLowerCase()
        : "draft",
      createdByUserId: req.user?.id || null,
    });

    const nextRunAt = emailService.computeNextCampaignRun(campaign, new Date());
    await campaign.update({
      nextRunAt,
    });

    return res.status(201).json({
      message: "Campanha criada com sucesso",
      data: campaign,
    });
  } catch (error) {
    console.error("Erro ao criar campanha de e-mail:", error);
    return res.status(500).json({
      message: "Erro ao criar campanha de e-mail",
      error: error.message,
    });
  }
});

router.put("/admin/email-campaigns/:id", adminMiddleware, async (req, res) => {
  try {
    const campaign = await EmailCampaign.findByPk(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        message: "Campanha nao encontrada",
      });
    }

    const payload = req.body || {};
    await campaign.update({
      name: payload.name !== undefined ? String(payload.name || "").trim() : campaign.name,
      subject: payload.subject !== undefined ? String(payload.subject || "").trim() : campaign.subject,
      previewText: payload.previewText !== undefined ? String(payload.previewText || "") : campaign.previewText,
      contentHtml: payload.contentHtml !== undefined ? String(payload.contentHtml || "") : campaign.contentHtml,
      contentText: payload.contentText !== undefined ? String(payload.contentText || "") : campaign.contentText,
      targetMode:
        payload.targetMode !== undefined
          ? String(payload.targetMode || "all").toLowerCase() === "selected"
            ? "selected"
            : "all"
          : campaign.targetMode,
      selectedClientIds:
        payload.selectedClientIds !== undefined
          ? Array.isArray(payload.selectedClientIds)
            ? payload.selectedClientIds
            : []
          : campaign.selectedClientIds,
      automaticEnabled:
        payload.automaticEnabled !== undefined
          ? Boolean(payload.automaticEnabled)
          : campaign.automaticEnabled,
      scheduleType:
        payload.scheduleType !== undefined
          ? String(payload.scheduleType || "weekly").toLowerCase() === "interval"
            ? "interval"
            : "weekly"
          : campaign.scheduleType,
      sendDaysOfWeek:
        payload.sendDaysOfWeek !== undefined
          ? Array.isArray(payload.sendDaysOfWeek)
            ? payload.sendDaysOfWeek
            : []
          : campaign.sendDaysOfWeek,
      sendTime: payload.sendTime !== undefined ? String(payload.sendTime || "09:00") : campaign.sendTime,
      frequencyDays:
        payload.frequencyDays !== undefined
          ? Math.max(1, Number(payload.frequencyDays || 7))
          : campaign.frequencyDays,
      status:
        payload.status !== undefined
          ? ["draft", "active", "paused"].includes(String(payload.status || "").toLowerCase())
            ? String(payload.status).toLowerCase()
            : campaign.status
          : campaign.status,
    });

    await campaign.update({
      nextRunAt: emailService.computeNextCampaignRun(campaign, new Date()),
    });

    return res.status(200).json({
      message: "Campanha atualizada com sucesso",
      data: campaign,
    });
  } catch (error) {
    console.error("Erro ao atualizar campanha de e-mail:", error);
    return res.status(500).json({
      message: "Erro ao atualizar campanha de e-mail",
      error: error.message,
    });
  }
});

router.delete("/admin/email-campaigns/:id", adminMiddleware, async (req, res) => {
  try {
    const campaign = await EmailCampaign.findByPk(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        message: "Campanha nao encontrada",
      });
    }

    await EmailCampaignLog.destroy({
      where: { campaignId: campaign.id },
    });
    await campaign.destroy();

    return res.status(200).json({
      message: "Campanha removida com sucesso",
    });
  } catch (error) {
    console.error("Erro ao remover campanha de e-mail:", error);
    return res.status(500).json({
      message: "Erro ao remover campanha de e-mail",
      error: error.message,
    });
  }
});

router.post("/admin/email-campaigns/:id/send-now", adminMiddleware, async (req, res) => {
  try {
    const result = await emailService.sendEmailCampaignNow(req.params.id);
    return res.status(200).json({
      message: `Campanha enviada. ${result.sentCount} enviados e ${result.failedCount} falharam.`,
      data: result,
    });
  } catch (error) {
    console.error("Erro ao disparar campanha de e-mail:", error);
    return res.status(500).json({
      message: "Erro ao disparar campanha de e-mail",
      error: error.message,
    });
  }
});

// Rota para listar todos os clientes do ViaPet
router.get("/admin/clients", adminMiddleware, async (req, res) => {
  try {
    const clients = await Users.findAll({
      where: {
        role: "proprietario",
      },
      attributes: [
        "id",
        "name",
        "email",
        "phone",
        "status",
        "plan",
        "expirationDate",
        "lastAccess",
        "createdAt",
        "recoveryPassToken",
        "timeRecoveryPass",
      ],
      include: [
        {
          model: Users,
          as: "employees",
          attributes: ["id", "name", "email", "status", "createdAt", "lastAccess"],
          where: buildRealEmployeeWhere(),
          required: false,
        },
        {
          model: Settings,
          as: "settings",
          attributes: ["id", "usersId", "storeName", "themeColor", "textColor", "logoUrl"],
          required: false,
        },
      ],
    });

    // Enriquecer os dados com estatísticas
    const enrichedClients = await Promise.all(
      clients.map(async (client) => {
        const clientData = client.toJSON();

        // Buscar estatísticas adicionais
        const [appointments, sales, customers, accessControl] = await Promise.all([
          Appointments.count({ where: { usersId: client.id } }),
          Sales.count({ where: { usersId: client.id } }),
          Customers.count({ where: { usersId: client.id } }),
          getOrCreateClientAccessControl(client.id),
        ]);

        const [productsCount, servicesCount] = await Promise.all([
          Products.count({ where: { usersId: client.id } }),
          Services.count({ where: { establishment: client.id } }),
        ]);

        // Calcular faturamento total
        const totalRevenue =
          (await Sales.sum("total", {
            where: { usersId: client.id },
          })) || 0;

        // Adicionar estatísticas ao objeto do cliente
        return {
          ...clientData,
          accessControl: normalizeClientAccessRecord(accessControl),
          passwordResetActive: readPasswordResetState(client).active,
          passwordResetRequestedAt: readPasswordResetState(client).requestedAt,
          passwordResetExpiresAt: readPasswordResetState(client).expiresAt,
          statistics: {
            totalEmployees: clientData.employees?.length || 0,
            totalProducts: productsCount,
            totalServices: servicesCount,
            totalAppointments: appointments,
            totalSales: sales,
            totalCustomers: customers,
            totalRevenue: totalRevenue,
          },
          settings: clientData.settings || {},
          createdAt: client.createdAt,
          lastAccess: client.lastAccess,
          phone: client.phone,
          status: client.status,
          plan: client.plan,
          expirationDate: client.expirationDate,
          firstAccessRequired: readFirstAccessState(client).active,
          firstAccessExpiresAt: client.timeRecoveryPass || null,
        };
      }),
    );

    res.json({
      message: "Clientes encontrados com sucesso",
      data: enrichedClients,
    });
  } catch (error) {
    console.error("Erro ao buscar clientes:", error);
    res.status(500).json({
      message: "Erro ao buscar clientes",
      error: error.message,
    });
  }
});

// Rota para obter detalhes específicos de um cliente
router.get("/admin/clients/:id/details", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Users.findOne({
      where: { id, role: "proprietario" },
      attributes: [
        "id",
        "name",
        "email",
        "phone",
        "status",
        "plan",
        "expirationDate",
        "lastAccess",
        "recoveryPassToken",
        "timeRecoveryPass",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: Users,
          as: "employees",
          where: buildRealEmployeeWhere(),
          attributes: ["id", "name", "email", "status", "createdAt", "lastAccess"],
          required: false,
        },
        {
          model: Settings,
          as: "settings",
          attributes: ["id", "usersId", "storeName", "themeColor", "textColor", "logoUrl"],
          required: false,
        },
      ],
    });

    if (!client) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    // Buscar estatísticas detalhadas
    const [
      appointments,
      sales,
      customers,
      recentAppointments,
      recentSales,
      recentLogins,
      subscription,
      paymentHistory,
      productsCount,
      servicesCount,
      accessControl,
    ] = await Promise.all([
      Appointments.count({ where: { usersId: id } }),
      Sales.count({ where: { usersId: id } }),
      Customers.count({ where: { usersId: id } }),
      Appointments.findAll({
        where: { usersId: id },
        limit: 5,
        order: [["createdAt", "DESC"]],
      }),
      Sales.findAll({
        where: { usersId: id },
        limit: 5,
        order: [["createdAt", "DESC"]],
      }),
      LoginHistory.findAll({
        where: { userId: id },
        limit: 5,
        order: [["createdAt", "DESC"]],
      }),
      Subscription.findOne({
        where: { user_id: id },
        order: [["created_at", "DESC"]],
      }),
      PaymentHistory.findAll({
        where: { user_id: id },
        limit: 8,
        order: [["created_at", "DESC"]],
      }),
      Products.count({ where: { usersId: id } }),
      Services.count({ where: { establishment: id } }),
      getOrCreateClientAccessControl(id),
    ]);

    // Calcular faturamento total e mensal
    const totalRevenue =
      (await Sales.sum("total", {
        where: { usersId: id },
      })) || 0;

    const monthlyRevenue =
      (await Sales.sum("total", {
        where: {
          usersId: id,
          createdAt: {
            [Op.gte]: new Date(new Date().setDate(1)), // Primeiro dia do mês atual
          },
        },
      })) || 0;

    const clientData = {
      ...client.toJSON(),
      firstAccess: {
        required: readFirstAccessState(client).active,
        expiresAt: client.timeRecoveryPass || null,
      },
      passwordReset: readPasswordResetState(client),
      statistics: {
        totalEmployees: client.employees?.length || 0,
        totalProducts: productsCount,
        totalServices: servicesCount,
        totalAppointments: appointments,
        totalSales: sales,
        totalCustomers: customers,
        totalRevenue,
        monthlyRevenue,
      },
      recentActivity: {
        appointments: recentAppointments,
        sales: recentSales,
        logins: recentLogins,
      },
      userAccess: [
        {
          id: client.id,
          name: client.name,
          email: client.email,
          role: "proprietario",
          status: client.status,
          createdAt: client.createdAt,
          lastAccess: client.lastAccess,
        },
        ...((client.employees || []).map((employee) => ({
          id: employee.id,
          name: employee.name,
          email: employee.email,
          role: employee.role || "funcionario",
          status: employee.status,
          createdAt: employee.createdAt,
          lastAccess: employee.lastAccess,
        }))),
      ],
      billing: {
        subscription: subscription || null,
        paymentHistory: paymentHistory || [],
      },
      accessControl: normalizeClientAccessRecord(accessControl),
    };

    res.json({
      message: "Detalhes do cliente encontrados com sucesso",
      data: clientData,
    });
  } catch (error) {
    console.error("Erro ao buscar detalhes do cliente:", error);
    res.status(500).json({
      message: "Erro ao buscar detalhes do cliente",
      error: error.message,
    });
  }
});

router.post("/admin/clients/:id/send-reset-link", adminMiddleware, async (req, res) => {
  try {
    const user = await Users.findOne({
      where: { id: req.params.id, role: "proprietario" },
    });

    if (!user) {
      return res.status(404).json({ message: "Cliente nao encontrado" });
    }

    if (!user.email || !validator.isEmail(String(user.email))) {
      return res.status(400).json({
        message: "Este usuario nao possui um email valido para envio do link.",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        resetpass: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await user.update({
      recoveryPassToken: token,
      timeRecoveryPass: expiresAt,
    });

    await emailService.sendPasswordResetEmail(user.email, token);

    const resetUrl = emailService.buildPasswordResetLink(token);

    return res.json({
      message: "Link de redefinicao enviado com sucesso por e-mail.",
      data: {
        email: user.email,
        resetUrl,
        requestedAt: new Date(),
        expiresAt,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Nao foi possivel reenviar o link de redefinicao.",
      error: error.message,
    });
  }
});

// Rota para obter links de redes sociais
router.get("/admin/social-links", adminMiddleware, async (req, res) => {
  try {
    const settings = await Admin.findOne();

    res.json({
      message: "Links obtidos com sucesso",
      data: {
        instagramUrl: settings.instagram || "",
        facebookUrl: settings.facebook || "",
        tiktokUrl: settings.tiktok || "",
        youtubeUrl: settings.youtube || "",
      },
    });
  } catch (error) {
    console.error("Erro ao buscar links de redes sociais:", error);
    res.status(500).json({
      message: "Erro ao buscar links de redes sociais",
      error: error.message,
    });
  }
});

router.get("/admin/billing/settings", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateBillingSettings();
    return res.json({
      message: "Configuracoes de cobranca carregadas com sucesso",
      data: settings,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao carregar configuracoes de cobranca",
      error: error.message,
    });
  }
});

router.post("/admin/billing/settings", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateBillingSettings();
    const {
      monthlyPrice,
      promotionalPrice,
      trialDays,
      promotionalMonths,
      reminderDays,
      mercadoPagoEnabled,
      mercadoPagoPublicKey,
      notes,
    } = req.body;

    await settings.update({
      monthlyPrice: monthlyPrice ?? settings.monthlyPrice,
      promotionalPrice: promotionalPrice ?? settings.promotionalPrice,
      trialDays: trialDays ?? settings.trialDays,
      promotionalMonths: promotionalMonths ?? settings.promotionalMonths,
      reminderDays: reminderDays ?? settings.reminderDays,
      mercadoPagoEnabled: mercadoPagoEnabled ?? settings.mercadoPagoEnabled,
      mercadoPagoPublicKey: mercadoPagoPublicKey ?? settings.mercadoPagoPublicKey,
      notes: notes ?? settings.notes,
    });

    return res.json({
      message: "Configuracoes de cobranca salvas com sucesso",
      data: settings,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao salvar configuracoes de cobranca",
      error: error.message,
    });
  }
});

router.get("/admin/billing/overview", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateBillingSettings();
    const users = await Users.findAll({
      where: { role: "proprietario" },
      order: [["createdAt", "DESC"]],
    });

    const overview = await Promise.all(
      users.map(async (user) => {
        const subscription = await Subscription.findOne({
          where: { user_id: user.id },
          order: [["created_at", "DESC"]],
        });
        const billingProfile = getBillingProfile(user, subscription, settings);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          plan: user.plan,
          expirationDate: user.expirationDate,
          stage: billingProfile.stage,
          daysUntilExpiry: billingProfile.daysUntilExpiry,
          overdue: billingProfile.overdue,
          reminderDue: billingProfile.reminderDue,
          nextChargeAmount: billingProfile.nextChargeAmount,
          nextChargePlanType: billingProfile.nextChargePlanType,
          promotionalMonthsUsed: Number(subscription?.promotional_months_used || 0),
        };
      }),
    );

    return res.json({
      message: "Visao de cobranca carregada com sucesso",
      data: {
        settings,
        overview,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao carregar visao de cobranca",
      error: error.message,
    });
  }
});

router.get("/admin/dashboard-summary", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateBillingSettings();
    const [users, approvedPayments, crmAiSubscriptions] = await Promise.all([
      Users.findAll({
        where: { role: "proprietario" },
        attributes: ["id", "name", "email", "plan", "status", "expirationDate", "createdAt"],
        order: [["createdAt", "DESC"]],
      }),
      PaymentHistory.findAll({
        where: {
          status: {
            [Op.in]: ["approved", "authorized"],
          },
        },
        attributes: ["id", "user_id", "amount", "created_at", "date_approved", "payment_method"],
        order: [["created_at", "DESC"]],
      }),
      CrmAiSubscription.findAll({
        attributes: [
          "id",
          "user_id",
          "status",
          "payment_status",
          "amount",
          "created_at",
          "activated_at",
          "next_billing_date",
        ],
        order: [["created_at", "DESC"]],
      }),
    ]);

    const today = startOfToday();
    const week = startOfWeek();
    const month = startOfMonth();

    const registrations = {
      today: users.filter((item) => item.createdAt && new Date(item.createdAt) >= today).length,
      week: users.filter((item) => item.createdAt && new Date(item.createdAt) >= week).length,
      month: users.filter((item) => item.createdAt && new Date(item.createdAt) >= month).length,
    };

    const mainPaymentsWeek = approvedPayments.filter((item) => new Date(item.date_approved || item.created_at) >= week);
    const mainPaymentsMonth = approvedPayments.filter((item) => new Date(item.date_approved || item.created_at) >= month);

    const latestCrmAiByUser = new Map();
    crmAiSubscriptions.forEach((subscription) => {
      if (!latestCrmAiByUser.has(subscription.user_id)) {
        latestCrmAiByUser.set(subscription.user_id, subscription);
      }
    });

    const paidCrmAiSubscriptions = crmAiSubscriptions.filter((subscription) => {
      const paymentStatus = String(subscription.payment_status || "").toLowerCase();
      const status = String(subscription.status || "").toLowerCase();
      const createdAt = new Date(subscription.created_at);
      const amount = Number(subscription.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) return false;
      if (["manual_free", "manual_trial", "manual_blocked"].includes(paymentStatus)) return false;
      return ["active", "pending", "approved"].includes(status) || paymentStatus.includes("paid") || paymentStatus === "approved";
    });

    const crmAiWeek = paidCrmAiSubscriptions.filter((item) => new Date(item.created_at) >= week);
    const crmAiMonth = paidCrmAiSubscriptions.filter((item) => new Date(item.created_at) >= month);

    const crmAiRows = await Promise.all(
      users.map(async (user) => {
        const latestSubscription = latestCrmAiByUser.get(user.id) || null;
        const lastMessage = await CrmWhatsappMessage.findOne({
          where: { usersId: user.id },
          attributes: ["createdAt", "direction"],
          order: [["createdAt", "DESC"]],
        });
        const messageCount = await CrmWhatsappMessage.count({ where: { usersId: user.id } });
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
          crmAiStatus: latestSubscription?.status || "inactive",
          crmAiPaymentStatus: latestSubscription?.payment_status || null,
          crmAiAmount: Number(latestSubscription?.amount || 0),
          crmAiPurchasedAt: latestSubscription?.created_at || null,
          crmAiActivatedAt: latestSubscription?.activated_at || null,
          crmAiNextBillingDate: latestSubscription?.next_billing_date || null,
          crmAiLastMessageAt: lastMessage?.createdAt || null,
          crmAiMessageCount: messageCount,
        };
      }),
    );

    const crmAiActiveCount = crmAiRows.filter((item) => item.crmAiStatus === "active").length;
    const crmAiBlockedCount = crmAiRows.filter((item) => ["cancelled", "expired", "suspended"].includes(item.crmAiStatus)).length;
    const crmAiExpiringCount = crmAiRows.filter((item) => {
      if (!item.crmAiNextBillingDate || item.crmAiStatus !== "active") return false;
      const diff = new Date(item.crmAiNextBillingDate).getTime() - Date.now();
      const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
      return days >= 0 && days <= 7;
    }).length;
    const crmAiInUseCount = crmAiRows.filter((item) => item.crmAiMessageCount > 0).length;

    const billingOverview = await Promise.all(
      users.map(async (user) => {
        const subscription = await Subscription.findOne({
          where: { user_id: user.id },
          order: [["created_at", "DESC"]],
        });
        const profile = getBillingProfile(user, subscription, settings);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          stage: profile.stage,
          nextChargeAmount: Number(profile.nextChargeAmount || 0),
          daysUntilExpiry: profile.daysUntilExpiry,
          overdue: profile.overdue,
          reminderDue: profile.reminderDue,
        };
      }),
    );

    return res.json({
      message: "Resumo administrativo carregado com sucesso",
      data: {
        registrations,
        clients: {
          total: users.length,
          active: users.filter((item) => Boolean(item.plan)).length,
          blocked: users.filter((item) => !item.plan).length,
        },
        payments: {
          weekCount: mainPaymentsWeek.length,
          weekAmount: mainPaymentsWeek.reduce((total, item) => total + Number(item.amount || 0), 0),
          monthCount: mainPaymentsMonth.length,
          monthAmount: mainPaymentsMonth.reduce((total, item) => total + Number(item.amount || 0), 0),
        },
        crmAi: {
          activeCount: crmAiActiveCount,
          blockedCount: crmAiBlockedCount,
          expiringCount: crmAiExpiringCount,
          inUseCount: crmAiInUseCount,
          weekCount: crmAiWeek.length,
          weekAmount: crmAiWeek.reduce((total, item) => total + Number(item.amount || 0), 0),
          monthCount: crmAiMonth.length,
          monthAmount: crmAiMonth.reduce((total, item) => total + Number(item.amount || 0), 0),
        },
        recentClients: users.slice(0, 8).map((item) => ({
          id: item.id,
          name: item.name,
          email: item.email,
          createdAt: item.createdAt,
        })),
        billingWatchlist: billingOverview
          .filter((item) => item.overdue || item.reminderDue)
          .sort((left, right) => {
            if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
            return Number(left.daysUntilExpiry || 999) - Number(right.daysUntilExpiry || 999);
          })
          .slice(0, 8),
        crmAiRoster: crmAiRows
          .sort((left, right) => {
            const leftActive = left.crmAiStatus === "active" ? 1 : 0;
            const rightActive = right.crmAiStatus === "active" ? 1 : 0;
            if (rightActive !== leftActive) return rightActive - leftActive;
            return String(left.name || "").localeCompare(String(right.name || ""), "pt-BR");
          }),
      },
    });
  } catch (error) {
    console.error("Erro ao carregar resumo administrativo:", error);
    return res.status(500).json({
      message: "Erro ao carregar resumo administrativo",
      error: error.message,
    });
  }
});

router.post("/admin/clients/:id/mark-manual-paid", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: "Cliente nao encontrado" });
    }

    const settings = await getOrCreateBillingSettings();
    const latestSubscription = await Subscription.findOne({
      where: { user_id: id },
      order: [["created_at", "DESC"]],
    });
    const billingProfile = getBillingProfile(user, latestSubscription, settings);
    const nextPlanType = billingProfile.stage === "free" ? "monthly" : billingProfile.nextChargePlanType;
    const nextAmount =
      nextPlanType === "promotional"
        ? Number(settings.promotionalPrice || 39.9)
        : Number(settings.monthlyPrice || 69.9);

    const cycleStart = user.expirationDate && new Date(user.expirationDate) > new Date()
      ? new Date(user.expirationDate)
      : new Date();
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setDate(cycleEnd.getDate() + 30);

    await user.update({
      plan: true,
      expirationDate: cycleEnd,
      status: true,
    });

    const subscription = await registerMainPlanHistory(user, {
      amount: nextAmount,
      planType: nextPlanType,
      billingPeriodStart: cycleStart,
      billingPeriodEnd: cycleEnd,
      paymentMethod: "manual",
      paymentType: "manual",
      notes:
        nextPlanType === "promotional"
          ? "Pagamento manual registrado pelo admin em valor promocional"
          : "Pagamento manual registrado pelo admin",
      historyStatus: "approved",
      subscriptionStatus: "active",
      paymentStatus: "approved",
      nextBillingDate: cycleEnd,
    });

    if (subscription && nextPlanType === "promotional") {
      await subscription.update({
        promotional_months_used: Number(subscription.promotional_months_used || 0) + 1,
      });
    }

    return res.json({
      message: "Pagamento manual registrado com sucesso",
      data: {
        plan: user.plan,
        expirationDate: user.expirationDate,
        amount: nextAmount,
        planType: nextPlanType,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao registrar pagamento manual",
      error: error.message,
    });
  }
});

router.post("/admin/clients/:id/create-billing-charge", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: "Cliente nao encontrado" });
    }

    const settings = await getOrCreateBillingSettings();
    if (!settings.mercadoPagoEnabled) {
      return res.status(400).json({ message: "Mercado Pago desativado nas configuracoes de cobranca." });
    }

    const latestSubscription = await Subscription.findOne({
      where: { user_id: id },
      order: [["created_at", "DESC"]],
    });
    const billingProfile = getBillingProfile(user, latestSubscription, settings);

    if (billingProfile.stage === "free") {
      return res.status(400).json({
        message: "Este cliente esta marcado como sem custo. Remova o acesso gratuito antes de gerar cobranca.",
      });
    }

    let subscription = await Subscription.findOne({
      where: {
        user_id: id,
        status: { [Op.in]: ["pending", "active", "expired", "cancelled", "suspended"] },
      },
      order: [["created_at", "DESC"]],
    });

    const externalReference = `main_${id}_${Date.now()}`;
    const chargeTitle =
      billingProfile.nextChargePlanType === "promotional"
        ? "ViaPet - Mensalidade Promocional"
        : "ViaPet - Mensalidade";

    const preference = await createSubscriptionPreference({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      planType: billingProfile.nextChargePlanType,
      amount: billingProfile.nextChargeAmount,
      title: chargeTitle,
      description:
        billingProfile.nextChargePlanType === "promotional"
          ? `Cobranca promocional do ViaPet por R$ ${Number(billingProfile.nextChargeAmount).toFixed(2).replace(".", ",")}`
          : `Cobranca mensal do ViaPet por R$ ${Number(billingProfile.nextChargeAmount).toFixed(2).replace(".", ",")}`,
      externalReference,
    });

    if (!preference.success) {
      return res.status(400).json({
        message: "Nao foi possivel gerar a cobranca no Mercado Pago.",
        error: preference.error,
      });
    }

    if (!subscription) {
      subscription = await Subscription.create({
        user_id: id,
        plan_type: billingProfile.nextChargePlanType,
        status: "pending",
        payment_status: "pending",
        amount: billingProfile.nextChargeAmount,
        currency: "BRL",
        payment_preference_id: preference.id,
        notes: "Cobranca criada manualmente pelo admin",
      });
    } else {
      await subscription.update({
        plan_type: billingProfile.nextChargePlanType,
        status: "pending",
        payment_status: "pending",
        amount: billingProfile.nextChargeAmount,
        currency: "BRL",
        payment_preference_id: preference.id,
        notes: "Cobranca criada manualmente pelo admin",
      });
    }

    return res.json({
      message: "Cobranca criada com sucesso",
      data: {
        checkoutUrl: preference.checkout_url || preference.init_point,
        preferenceId: preference.id,
        amount: billingProfile.nextChargeAmount,
        planType: billingProfile.nextChargePlanType,
        stage: billingProfile.stage,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao criar cobranca",
      error: error.message,
    });
  }
});

// Rota para adicionar novo cliente
router.post("/admin/clients", adminMiddleware, async (req, res) => {
  try {
    const { name, email, password, plan } = req.body;
    if (!name || !email) {
      return res.status(400).json({
        message: "Nome e email sao obrigatorios para criar um novo usuario",
      });
    }

    if (!validator.isEmail(String(email))) {
      return res.status(400).json({
        message: "Informe um email valido para o novo usuario",
      });
    }

    // Verificar se já existe um usuário com este email
    const existingUser = await Users.findOne({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({
        message: "Já existe um usuário com este email",
      });
    }

    const temporaryPassword = password || generateTemporaryPassword();

    // Criptografar a senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(temporaryPassword, salt);

    // Calcular data de expiração se tiver plano
    const expirationDate = plan
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      : null;

    // Criar novo usuário
    const newUser = await Users.create({
      name,
      email,
      password: hashedPassword,
      role: "proprietario",
      status: true,
      plan: false,
      expirationDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // 6 meses
    });

    const firstAccess = buildFirstAccessToken({
      ...newUser.toJSON(),
      establishment: newUser.id,
    });

    await newUser.update({
      recoveryPassToken: firstAccess.token,
      timeRecoveryPass: firstAccess.expiresAt,
    });
    // Atualizar o establishment do usuário para seu próprio ID
    await Users.update(
      { establishment: newUser.id },
      { where: { id: newUser.id } },
    );

    await ensureDefaultMedicalCatalog(newUser.id);

    // Criar configurações do estabelecimento com o mesmo ID do usuário
    await Settings.create({
      usersId: newUser.id,
      storeName: "Nome do Estabelecimento",
      intervalClinic: 30,
      intervalAesthetics: 30,
      openingTime: "08:00",
      closingTime: "18:00",
      breakStartTime: "12:00",
      breakEndTime: "13:00",
      notifyClient: true,
      themeColor: "#2196F3",
    });

    // Remover a senha do objeto de resposta
    const userData = newUser.toJSON();
    delete userData.password;

    res.status(201).json({
      message: "Cliente criado com sucesso",
      data: {
        ...userData,
        temporaryPassword,
        firstAccessRequired: true,
        firstAccessExpiresAt: firstAccess.expiresAt,
      },
    });
  } catch (error) {
    console.error("Erro ao criar cliente:", error);
    res.status(500).json({
      message: "Erro ao criar cliente",
      error: error.message,
    });
  }
});

// Rota para editar cliente
router.put("/admin/clients/:id", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, status, plan, expirationDate, phone } = req.body;

    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    // Verificar se o novo email já está em uso por outro usuário
    if (email !== user.email) {
      const existingUser = await Users.findOne({
        where: {
          email,
          id: { [Op.ne]: id },
        },
      });

      if (existingUser) {
        return res.status(400).json({
          message: "Email já está em uso por outro usuário",
        });
      }
    }

    // Se está ativando o plano, calcular nova data de expiração
    let newExpirationDate = expirationDate;
    if (plan && !user.plan) {
      newExpirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    const wasPlanEnabled = Boolean(user.plan);

    // Atualizar dados
    await user.update({
      name,
      email,
      status,
      plan,
      phone,
      expirationDate: plan ? newExpirationDate : null,
    });

    if (plan !== undefined && plan !== wasPlanEnabled) {
      if (plan) {
        await registerMainPlanHistory(user, {
          amount: 0,
          paymentMethod: "manual",
          paymentStatus: "approved",
          subscriptionStatus: "active",
          historyStatus: "approved",
          planType: "monthly",
          billingPeriodStart: new Date(),
          billingPeriodEnd: user.expirationDate,
          notes: "Plano principal ativado manualmente pelo admin",
        });
      } else {
        await registerMainPlanHistory(user, {
          amount: 0,
          paymentMethod: "manual",
          paymentStatus: "cancelled",
          subscriptionStatus: "cancelled",
          historyStatus: "cancelled",
          planType: "monthly",
          billingPeriodStart: new Date(),
          billingPeriodEnd: null,
          notes: "Plano principal bloqueado manualmente pelo admin",
        });
      }
    }

    // Remover a senha do objeto de resposta
    const userData = user.toJSON();
    delete userData.password;

    res.json({
      message: "Cliente atualizado com sucesso",
      data: userData,
    });
  } catch (error) {
    console.error("Erro ao atualizar cliente:", error);
    res.status(500).json({
      message: "Erro ao atualizar cliente",
      error: error.message,
    });
  }
});

router.post("/admin/clients/:id/reset-first-access", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    const temporaryPassword = generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    const firstAccess = buildFirstAccessToken(user);

    await user.update({
      password: hashedPassword,
      recoveryPassToken: firstAccess.token,
      timeRecoveryPass: firstAccess.expiresAt,
    });

    return res.status(200).json({
      message: "Primeiro acesso resetado com sucesso.",
      data: {
        temporaryPassword,
        firstAccessRequired: true,
        firstAccessExpiresAt: firstAccess.expiresAt,
      },
    });
  } catch (error) {
    console.error("Erro ao resetar primeiro acesso:", error);
    return res.status(500).json({
      message: "Erro ao resetar primeiro acesso",
      error: error.message,
    });
  }
});

router.delete("/admin/clients/:id", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const currentAdminId = String(req.user?.id || "");
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    if (String(user.id) === currentAdminId) {
      return res.status(400).json({
        message: "Nao e permitido excluir o proprio usuario administrador logado.",
      });
    }

    if (String(user.role || "").toLowerCase() === "admin") {
      return res.status(400).json({
        message: "Nao e permitido excluir contas administrativas por esta rota.",
      });
    }

    const employeeUsers = await Users.findAll({
      where: { establishment: id },
      attributes: ["id"],
    });
    const employeeIds = employeeUsers
      .map((item) => String(item.id || ""))
      .filter((employeeId) => employeeId && employeeId !== String(id));
    const relatedUserIds = [String(id), ...employeeIds];
    const relatedUuidUserIds = relatedUserIds.filter((item) => isUuid(item));
    const transaction = await Users.sequelize.transaction();

    try {
      const safeDestroy = async (label, model, where, optional = false) => {
        try {
          await model.destroy({ where, transaction });
        } catch (destroyError) {
          if (optional) return;
          throw new Error(`${label}: ${destroyError.message}`);
        }
      };

      await safeDestroy(
        "AppointmentStatusHistory",
        AppointmentStatusHistory,
        { usersId: { [Op.in]: relatedUserIds } },
      );
      await safeDestroy("AppointmentPayment", AppointmentPayment, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("AppointmentItem", AppointmentItem, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("SaleItem", SaleItem, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("PurchaseItems", PurchaseItems, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("CashClosure", CashClosure, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("ClientAccessControl", ClientAccessControl, { user_id: { [Op.in]: relatedUuidUserIds } });
      await safeDestroy("CrmAiActionLog", CrmAiActionLog, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("CrmConversationMessage", CrmConversationMessage, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("CrmConversation", CrmConversation, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("PersonalFinance", PersonalFinance, { usersId: { [Op.in]: relatedUserIds } }, true);
      await safeDestroy("FinancialRecords", FinancialRecords, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("CrmWhatsappMessage", CrmWhatsappMessage, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy(
        "WhatsappConnection",
        WhatsappConnection,
        {
          [Op.or]: [
            { usersId: { [Op.in]: relatedUserIds } },
            { companyId: { [Op.in]: relatedUserIds } },
          ],
        },
      );
      await safeDestroy(
        "WhatsappMessage",
        WhatsappMessage,
        {
          [Op.or]: [
            { usersId: { [Op.in]: relatedUserIds } },
            { companyId: { [Op.in]: relatedUserIds } },
          ],
        },
      );
      await safeDestroy(
        "WhatsappTemplate",
        WhatsappTemplate,
        {
          [Op.or]: [
            { usersId: { [Op.in]: relatedUserIds } },
            { companyId: { [Op.in]: relatedUserIds } },
          ],
        },
      );
      await safeDestroy(
        "WhatsappWebhookLog",
        WhatsappWebhookLog,
        {
          [Op.or]: [
            { usersId: { [Op.in]: relatedUserIds } },
            { companyId: { [Op.in]: relatedUserIds } },
          ],
        },
      );
      await safeDestroy("PaymentHistory", PaymentHistory, { user_id: { [Op.in]: relatedUuidUserIds } });
      await safeDestroy("CrmAiSubscription", CrmAiSubscription, { user_id: { [Op.in]: relatedUuidUserIds } });
      await safeDestroy("Subscription", Subscription, { user_id: { [Op.in]: relatedUuidUserIds } });
      await safeDestroy("LoginHistory", LoginHistory, { userId: { [Op.in]: relatedUserIds } });
      await safeDestroy(
        "Finances",
        Finances,
        {
          [Op.or]: [
            { usersId: { [Op.in]: relatedUserIds } },
            { createdBy: { [Op.in]: relatedUserIds } },
          ],
        },
      );
      await safeDestroy("Appointments", Appointments, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("Sales", Sales, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("Purchases", Purchases, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("Pets", Pets, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("Customers", Customers, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy(
        "Drivers",
        Drivers,
        {
          [Op.or]: [
            { usersId: { [Op.in]: relatedUserIds } },
            { establishment: id },
          ],
        },
      );
      await safeDestroy(
        "VaccinePlan",
        VaccinePlan,
        {
          [Op.or]: [
            { usersId: { [Op.in]: relatedUserIds } },
            { establishment: id },
          ],
        },
      );
      await safeDestroy("ServiceCategories", ServiceCategories, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("Products", Products, { usersId: { [Op.in]: relatedUserIds } });
      await safeDestroy("Services", Services, { establishment: id });
      await safeDestroy("Settings", Settings, { usersId: { [Op.in]: relatedUserIds } });

      if (employeeIds.length) {
        await Users.destroy({
          where: { id: { [Op.in]: employeeIds } },
          transaction,
        });
      }

      await user.destroy({ transaction });
      await transaction.commit();
    } catch (deleteError) {
      await transaction.rollback();
      throw deleteError;
    }

    return res.json({
      message: "Cliente e todos os dados relacionados excluidos com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir cliente:", error);
    return res.status(500).json({
      message: "Erro ao excluir cliente",
      error: error.message,
    });
  }
});

// Rota legada (desativada) para excluir cliente
router.delete("/admin/clients/:id/legacy-delete-disabled", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    // Excluir todos os registros relacionados
    await Promise.all([
      // Excluir configurações
      Settings.destroy({ where: { usersId: id } }),

      // Excluir produtos
      Products.destroy({ where: { usersId: id } }),

      // Excluir serviços
      Services.destroy({ where: { establishment: id } }),

      // Excluir agendamentos
      Appointments.destroy({ where: { usersId: id } }),

      // Excluir vendas
      Sales.destroy({ where: { usersId: id } }),

      // Excluir clientes
      Customers.destroy({ where: { usersId: id } }),

      // Excluir histórico de login
      LoginHistory.destroy({ where: { userId: id } }),

      // Excluir finanças
      Finances.destroy({ where: { createdBy: id } }),
    ]);

    // Por fim, excluir o usuário
    await user.destroy();

    res.json({
      message: "Cliente e todos os dados relacionados excluídos com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir cliente:", error);
    res.status(500).json({
      message: "Erro ao excluir cliente",
      error: error.message,
    });
  }
});

// Rota para gerenciar plano do cliente
router.patch("/admin/clients/:id/plan", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { hasPlan, planExpirationDate } = req.body;

    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    await user.update({
      hasPlan,
      planExpirationDate: hasPlan ? planExpirationDate : null,
    });

    res.json({
      message: "Plano atualizado com sucesso",
      data: {
        hasPlan: user.hasPlan,
        planExpirationDate: user.planExpirationDate,
      },
    });
  } catch (error) {
    console.error("Erro ao atualizar plano:", error);
    res.status(500).json({
      message: "Erro ao atualizar plano",
      error: error.message,
    });
  }
});

// Rota para renovar plano do cliente
router.post("/admin/clients/:id/renew-plan", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    // Calcular nova data de expiração (30 dias a partir de agora)
    const newExpirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await user.update({
      plan: true,
      expirationDate: newExpirationDate,
    });

    await registerMainPlanHistory(user, {
      amount: 69.9,
      paymentMethod: "pix",
      paymentStatus: "approved",
      subscriptionStatus: "active",
      historyStatus: "approved",
      planType: "monthly",
      billingPeriodStart: new Date(),
      billingPeriodEnd: newExpirationDate,
      notes: "Renovacao paga do ViaPet registrada pelo admin",
    });

    res.json({
      message: "Plano renovado com sucesso",
      data: {
        plan: user.plan,
        expirationDate: user.expirationDate,
      },
    });
  } catch (error) {
    console.error("Erro ao renovar plano:", error);
    res.status(500).json({
      message: "Erro ao renovar plano",
      error: error.message,
    });
  }
});

router.post("/admin/clients/:id/grant-trial", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { days = 7 } = req.body || {};
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    const expirationDate = new Date(Date.now() + Number(days || 7) * 24 * 60 * 60 * 1000);
    await user.update({
      plan: true,
      expirationDate,
    });

    await registerMainPlanHistory(user, {
      amount: 0,
      paymentMethod: "manual",
      paymentStatus: "approved",
      subscriptionStatus: "active",
      historyStatus: "approved",
      planType: "trial",
      billingPeriodStart: new Date(),
      billingPeriodEnd: expirationDate,
      isTrial: true,
      notes: `Trial principal liberado por ${Number(days || 7)} dias`,
    });

    return res.status(200).json({
      message: "Trial principal liberado com sucesso",
      data: {
        plan: user.plan,
        expirationDate: user.expirationDate,
      },
    });
  } catch (error) {
    console.error("Erro ao liberar trial principal:", error);
    return res.status(500).json({
      message: "Erro ao liberar trial principal",
      error: error.message,
    });
  }
});

router.post("/admin/clients/:id/grant-free", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    const expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 10);

    await user.update({
      plan: true,
      expirationDate,
    });

    await registerMainPlanHistory(user, {
      amount: 0,
      paymentMethod: "manual",
      paymentStatus: "approved",
      subscriptionStatus: "active",
      historyStatus: "approved",
      planType: "promotional",
      billingPeriodStart: new Date(),
      billingPeriodEnd: expirationDate,
      notes: "Plano principal liberado sem custo pelo admin",
    });

    return res.status(200).json({
      message: "Plano principal liberado sem custo",
      data: {
        plan: user.plan,
        expirationDate: user.expirationDate,
      },
    });
  } catch (error) {
    console.error("Erro ao liberar plano principal sem custo:", error);
    return res.status(500).json({
      message: "Erro ao liberar plano principal sem custo",
      error: error.message,
    });
  }
});

router.post("/admin/clients/:id/block-plan", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    await user.update({
      plan: false,
      expirationDate: null,
    });

    await registerMainPlanHistory(user, {
      amount: 0,
      paymentMethod: "manual",
      paymentStatus: "cancelled",
      subscriptionStatus: "cancelled",
      historyStatus: "cancelled",
      planType: "monthly",
      billingPeriodStart: new Date(),
      billingPeriodEnd: null,
      notes: "Plano principal bloqueado manualmente pelo admin",
    });

    return res.status(200).json({
      message: "Plano principal bloqueado com sucesso",
      data: {
        plan: user.plan,
        expirationDate: user.expirationDate,
      },
    });
  } catch (error) {
    console.error("Erro ao bloquear plano principal:", error);
    return res.status(500).json({
      message: "Erro ao bloquear plano principal",
      error: error.message,
    });
  }
});

router.get("/admin/crm-ai/subscriptions", adminMiddleware, async (req, res) => {
  try {
    const users = await Users.findAll({
      where: {
        role: "proprietario",
      },
      attributes: ["id", "name", "email", "phone", "status", "plan", "expirationDate"],
      order: [["name", "ASC"]],
    });

    const subscriptions = await Promise.all(
      users.map(async (user) => {
        const subscription = await CrmAiSubscription.findOne({
          where: { user_id: user.id },
          order: [["created_at", "DESC"]],
        });
        const lastMessage = await CrmWhatsappMessage.findOne({
          where: { usersId: user.id },
          attributes: ["createdAt"],
          order: [["createdAt", "DESC"]],
        });
        const messageCount = await CrmWhatsappMessage.count({ where: { usersId: user.id } });

        return {
          userId: user.id,
          user: user.toJSON(),
          subscription: subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                payment_status: subscription.payment_status,
                amount: Number(subscription.amount || 0),
                currency: subscription.currency,
                activated_at: subscription.activated_at,
                next_billing_date: subscription.next_billing_date,
                cancelled_at: subscription.cancelled_at,
                notes: subscription.notes,
                created_at: subscription.created_at,
                updated_at: subscription.updated_at,
                last_message_at: lastMessage?.createdAt || null,
                message_count: messageCount,
              }
            : null,
        };
      }),
    );

    return res.json({
      message: "Assinaturas da IA CRM encontradas com sucesso",
      data: subscriptions,
    });
  } catch (error) {
    console.error("Erro ao buscar assinaturas da IA CRM:", error);
    return res.status(500).json({
      message: "Erro ao buscar assinaturas da IA CRM",
      error: error.message,
    });
  }
});

router.post("/admin/crm-ai/:id/grant-trial", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { days = 7 } = req.body;
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    const now = new Date();
    const nextBillingDate = new Date();
    nextBillingDate.setDate(nextBillingDate.getDate() + Number(days || 7));

    let subscription = await CrmAiSubscription.findOne({
      where: { user_id: id },
      order: [["created_at", "DESC"]],
    });

    if (!subscription) {
      subscription = await CrmAiSubscription.create({
        user_id: id,
        status: "active",
        payment_status: "manual_trial",
        amount: 0,
        currency: "BRL",
        activated_at: now,
        next_billing_date: nextBillingDate,
        notes: `Trial manual liberado por ${Number(days || 7)} dias`,
      });
    } else {
      await subscription.update({
        status: "active",
        payment_status: "manual_trial",
        amount: 0,
        activated_at: now,
        next_billing_date: nextBillingDate,
        cancelled_at: null,
        notes: `Trial manual liberado por ${Number(days || 7)} dias`,
      });
    }

    return res.json({
      message: "Trial da IA CRM liberado com sucesso",
      data: subscription,
    });
  } catch (error) {
    console.error("Erro ao liberar trial da IA CRM:", error);
    return res.status(500).json({
      message: "Erro ao liberar trial da IA CRM",
      error: error.message,
    });
  }
});

router.post("/admin/crm-ai/:id/grant-free", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    let subscription = await CrmAiSubscription.findOne({
      where: { user_id: id },
      order: [["created_at", "DESC"]],
    });

    if (!subscription) {
      subscription = await CrmAiSubscription.create({
        user_id: id,
        status: "active",
        payment_status: "manual_free",
        amount: 0,
        currency: "BRL",
        activated_at: new Date(),
        next_billing_date: null,
        notes: "Acesso gratuito manual liberado pelo admin",
      });
    } else {
      await subscription.update({
        status: "active",
        payment_status: "manual_free",
        amount: 0,
        activated_at: new Date(),
        next_billing_date: null,
        cancelled_at: null,
        notes: "Acesso gratuito manual liberado pelo admin",
      });
    }

    return res.json({
      message: "Acesso gratuito da IA CRM liberado com sucesso",
      data: subscription,
    });
  } catch (error) {
    console.error("Erro ao liberar acesso gratuito da IA CRM:", error);
    return res.status(500).json({
      message: "Erro ao liberar acesso gratuito da IA CRM",
      error: error.message,
    });
  }
});

router.post("/admin/crm-ai/:id/activate-paid", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { days = 30, amount = 49.9, notes = "" } = req.body || {};
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    const now = new Date();
    const nextBillingDate = new Date();
    nextBillingDate.setDate(nextBillingDate.getDate() + Number(days || 30));

    let subscription = await CrmAiSubscription.findOne({
      where: { user_id: id },
      order: [["created_at", "DESC"]],
    });

    const mergedNotes = notes || `IA CRM liberada manualmente por ${Number(days || 30)} dias`;

    if (!subscription) {
      subscription = await CrmAiSubscription.create({
        user_id: id,
        status: "active",
        payment_status: "manual_paid",
        amount: Number(amount || 49.9),
        currency: "BRL",
        activated_at: now,
        next_billing_date: nextBillingDate,
        notes: mergedNotes,
      });
    } else {
      await subscription.update({
        status: "active",
        payment_status: "manual_paid",
        amount: Number(amount || 49.9),
        activated_at: now,
        next_billing_date: nextBillingDate,
        cancelled_at: null,
        notes: mergedNotes,
      });
    }

    return res.json({
      message: "IA CRM liberada como paga com sucesso",
      data: subscription,
    });
  } catch (error) {
    console.error("Erro ao liberar IA CRM paga:", error);
    return res.status(500).json({
      message: "Erro ao liberar IA CRM paga",
      error: error.message,
    });
  }
});

router.post("/admin/crm-ai/:id/block", adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findByPk(id);

    if (!user) {
      return res.status(404).json({
        message: "Cliente nao encontrado",
      });
    }

    let subscription = await CrmAiSubscription.findOne({
      where: { user_id: id },
      order: [["created_at", "DESC"]],
    });

    if (!subscription) {
      subscription = await CrmAiSubscription.create({
        user_id: id,
        status: "cancelled",
        payment_status: "manual_blocked",
        amount: 0,
        currency: "BRL",
        cancelled_at: new Date(),
        notes: "Acesso bloqueado manualmente pelo admin",
      });
    } else {
      await subscription.update({
        status: "cancelled",
        payment_status: "manual_blocked",
        cancelled_at: new Date(),
        notes: "Acesso bloqueado manualmente pelo admin",
      });
    }

    return res.json({
      message: "Acesso da IA CRM bloqueado com sucesso",
      data: subscription,
    });
  } catch (error) {
    console.error("Erro ao bloquear IA CRM:", error);
    return res.status(500).json({
      message: "Erro ao bloquear IA CRM",
      error: error.message,
    });
  }
});

export default router;
