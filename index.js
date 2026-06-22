import express from "express";
import bodyParser from "body-parser";
import { DataTypes } from "sequelize";
import "./config/env.js"; // Carregar configurações de ambiente
import sequelize from "./database/config.js";
import loginRouter from "./routes/Users/Login.js";
import loginFuncRouter from "./routes/Users/LoginFunc.js";
import registerRouter from "./routes/Users/register.js";
import registerFuncRouter from "./routes/Users/newFuncionario.js";
import resetPassTokenRouter from "./routes/Users/ResetPassToken.js";
import resetPassRouter from "./routes/Users/resertPass.js";
import settingsRouter from "./routes/Settings.js";
import upload from "./middlewares/fileImage.js";
import establishmentGetRouter from "./routes/establishment.js";
import employeesGetRouter from "./routes/employees.js";
import editFuncRouter from "./routes/Users/editFuncionario.js";
import ProductRouter from "./routes/Product.js";
import servicesRouter from "./routes/Services.js";
import accountRouter from "./routes/Users/Account.js";
import tokenRouter from "./routes/token.js";
import agendaRouter from "./routes/Agenda.js";
import cors from "cors";
import customerRouter from "./routes/client.js";
import petRouter from "./routes/Pet.js";
import salesRouter from "./routes/sales.js";
import { setupAssociations } from "./models/associations.js";
import appointmentRouter from "./routes/Agendamento.js";
import adminRouter from "./routes/Admin.js";
import whatsappRouter from "./service/whatsapp.js";
import financeRouter from "./routes/finance.js";
import paymentMethodFeesRouter from "./routes/paymentMethodFees.js";
import bankAccountsRouter from "./routes/bankAccounts.js";
import bankReconciliationRouter from "./routes/bankReconciliation.js";
import personalFinanceRouter from "./routes/personal_finances.js";
import driversRouter from "./routes/drivers.js";
import bannersRouter from "./routes/banner.js";
import serviceRoutes from "./routes/Service.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import crmAiRouter from "./routes/crmAi.js";
import crmAiAssistantRouter from "./routes/crmAiAssistant.js";
import crmWhatsappRouter from "./routes/crmWhatsapp.js";
import crmWhatsappOauthRouter from "./routes/crmWhatsappOauth.js";
import crmConversationsRouter from "./routes/crmConversations.js";
import crmBaileysRouter from "./routes/crmBaileys.js";
import crmAutomationsRouter from "./routes/crmAutomations.js";
import crmPlanStatusRouter from "./routes/crmPlanStatus.js";
import { runAutomationsForAllUsers } from "./service/crmAutomations.js";
import BaileysService from "./service/baileys.js";
import { processPendingResponseJobs } from "./service/crmResponseQueue.js";
import cron from "node-cron";
import whatsappOfficialRouter from "./routes/whatsappOfficial.js";
import whatsappHubRouter from "./routes/whatsappHub.js";
import FilterRouter from "./routes/filter.routes.js";
import appointmentComandaRouter from "./routes/appointmentComanda.js";
import vaccinePlansRouter from "./routes/vaccinePlans.js";
import activityClientRouter from "./routes/activityClient.js";
import adminUserActivityRouter from "./routes/adminUserActivity.js";
import adminFinanceRouter from "./routes/adminFinance.js";
import adminAddonsRouter from "./routes/adminAddons.js";
import adminClientDetailRouter from "./routes/adminClientDetail.js";
import adminAuditRouter from "./routes/adminAudit.js";
import { adminAuditMiddleware } from "./middlewares/adminAudit.js";
import adminAlertsRouter from "./routes/adminAlerts.js";
import adminTutorialsRouter from "./routes/adminTutorials.js";
import adminWhatsappIaRouter from "./routes/adminWhatsappIa.js";
import { processDueInactiveAutomations, scanInactiveUsers } from "./service/adminWhatsappIa.js";
import alertEngine from "./service/alertEngine.js";
import {
  attachActivityHelper,
  activityErrorHandler,
} from "./middlewares/activityCapture.js";
import { planFeatureAccess } from "./middlewares/planFeatureAccess.js";
import net from "node:net";
process.env.TZ = "America/Sao_Paulo";
const app = express();
app.set("trust proxy", 1);

function sanitizeForwardedForHeader(value) {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== "undefined" && part.toLowerCase() !== "null")
    .filter((part) => {
      const normalized = part.includes(":") && part.startsWith("::ffff:") ? part.replace("::ffff:", "") : part;
      return net.isIP(normalized) !== 0;
    });

  if (cleaned.length === 0) return undefined;
  return cleaned.join(", ");
}

app.use((req, _res, next) => {
  const sanitized = sanitizeForwardedForHeader(req.headers["x-forwarded-for"]);
  if (sanitized) {
    req.headers["x-forwarded-for"] = sanitized;
  } else {
    delete req.headers["x-forwarded-for"];
  }
  next();
});
// Aumenta o limite do body parser
app.use(
  bodyParser.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));
app.use(
  cors({
    // MODIFIED CORS CONFIGURATION - ALLOW ALL ORIGINS FOR TESTING - INSECURE FOR PRODUCTION!
    origin: "*", // ⚠️ ALLOW ALL ORIGINS - INSECURE FOR PRODUCTION!
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // Keep or remove as needed for testing
  })
);
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "api-viapet" });
});

// Endpoint de diagnóstico DB — ajuda a depurar env vars inválidos no Render
app.get("/api/db-status", async (_req, res) => {
  const rawDbUrl = process.env.DATABASE_URL || "";
  const dbUrlSafe = rawDbUrl
    ? rawDbUrl.replace(/\/\/[^@]+@/, "//***:***@").substring(0, 60) + "..."
    : "(não definido)";

  const info = {
    NODE_ENV: process.env.NODE_ENV,
    hasDatabaseUrl: Boolean(rawDbUrl && rawDbUrl !== "undefined" && rawDbUrl !== "null"),
    DATABASE_URL_safe: dbUrlSafe,
    DB_HOST: process.env.DB_HOST || "(não definido)",
    DB_NAME: process.env.DB_NAME || "(não definido)",
    SUPABASE_POOLER_HOST: process.env.SUPABASE_POOLER_HOST || "(não definido)",
    DB_DIALECT: process.env.DB_DIALECT || "(não definido)",
  };

  try {
    await sequelize.authenticate();
    return res.json({ ok: true, db: "conectado", config: info });
  } catch (err) {
    return res.status(500).json({ ok: false, db: "erro", error: err.message, config: info });
  }
});
app.use("/uploads", express.static("uploads"));
app.use(attachActivityHelper);
app.use(loginRouter);
app.use(loginFuncRouter);
app.use(registerRouter);
app.use(registerFuncRouter);
app.use(resetPassTokenRouter);
app.use(resetPassRouter);
app.use(settingsRouter);
app.use(establishmentGetRouter);
app.use(employeesGetRouter);
app.use(editFuncRouter);
app.use(planFeatureAccess);
app.use(ProductRouter);
app.use(servicesRouter);
app.use(accountRouter);
app.use(tokenRouter);
app.use(agendaRouter);
app.use(customerRouter);
app.use(petRouter);
app.use(salesRouter);
app.use(appointmentRouter);
app.use(adminRouter);
app.use(whatsappRouter);
app.use(whatsappOfficialRouter);
app.use(whatsappHubRouter);
app.use(financeRouter);
app.use(paymentMethodFeesRouter);
app.use(bankAccountsRouter);
app.use(bankReconciliationRouter);
app.use(personalFinanceRouter);
app.use(driversRouter);
app.use(bannersRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/crm-ai", crmAiRouter);
app.use("/api/crm-ai-assistant", crmAiAssistantRouter);
app.use(crmWhatsappRouter);
app.use(crmWhatsappOauthRouter);
app.use(crmConversationsRouter);
app.use(crmBaileysRouter);
app.use(crmAutomationsRouter);
app.use(crmPlanStatusRouter);
app.use(FilterRouter);
app.use("/services", serviceRoutes);
app.use(appointmentComandaRouter);
app.use(vaccinePlansRouter);
app.use(activityClientRouter);
app.use(adminUserActivityRouter);
app.use(adminAuditMiddleware);
app.use(adminFinanceRouter);
app.use(adminAddonsRouter);
app.use(adminClientDetailRouter);
app.use(adminAuditRouter);
app.use(adminAlertsRouter);
app.use(adminTutorialsRouter);
app.use(adminWhatsappIaRouter);
// Error handler do activity logger — DEVE vir depois das rotas
app.use(activityErrorHandler);
// Configure as associações antes de sincronizar
setupAssociations();

async function ensureAppointmentSchema() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    const appointmentTable = await queryInterface.describeTable("appointments");

    if (!appointmentTable.sellerName) {
      await queryInterface.addColumn("appointments", "sellerName", {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Nome livre do responsavel exibido na agenda",
      });
      console.log("Coluna sellerName adicionada em Appointments");
    }

    if (!appointmentTable.packageGroupId) {
      await queryInterface.addColumn("appointments", "packageGroupId", {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "ID do grupo de pacote — compartilhado por todas as sessoes do mesmo pacote",
      });
      console.log("Coluna packageGroupId adicionada em Appointments");
    }

    if (!appointmentTable.automationsSent) {
      await queryInterface.addColumn("appointments", "automationsSent", {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        comment: "Registro das automacoes de WhatsApp ja disparadas para este agendamento",
      });
      console.log("Coluna automationsSent adicionada em Appointments");
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de Appointments:", error);
  }
}

async function ensureFinanceSchema() {
  const queryInterface = sequelize.getQueryInterface();
  const dialect = sequelize.getDialect();

  try {
    const financeTable = await queryInterface.describeTable("finances");

    if (!financeTable.installmentIndex) {
      await queryInterface.addColumn("finances", "installmentIndex", {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
      console.log("Coluna installmentIndex adicionada em Finances");
    }

    if (!financeTable.installmentTotal) {
      await queryInterface.addColumn("finances", "installmentTotal", {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
      console.log("Coluna installmentTotal adicionada em Finances");
    }

    if (!financeTable.purchaseGroupId) {
      await queryInterface.addColumn("finances", "purchaseGroupId", {
        type: DataTypes.UUID,
        allowNull: true,
      });
      console.log("Coluna purchaseGroupId adicionada em Finances");
    }

    if (!financeTable.parentFinanceId) {
      await queryInterface.addColumn("finances", "parentFinanceId", {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
      console.log("Coluna parentFinanceId adicionada em Finances");
    }

    if (!financeTable.vendor) {
      await queryInterface.addColumn("finances", "vendor", {
        type: DataTypes.STRING(180),
        allowNull: true,
      });
      console.log("Coluna vendor adicionada em Finances");
    }

    if (!financeTable.costCenter) {
      await queryInterface.addColumn("finances", "costCenter", {
        type: DataTypes.STRING(120),
        allowNull: true,
      });
      console.log("Coluna costCenter adicionada em Finances");
    }

    if (!financeTable.bankAccountId) {
      await queryInterface.addColumn("finances", "bankAccountId", {
        type: DataTypes.UUID,
        allowNull: true,
      });
      console.log("Coluna bankAccountId adicionada em Finances");
    }

    try {
      const indexes = await queryInterface.showIndex("finances");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("idx_finance_purchase_group")) {
        await queryInterface.addIndex("finances", ["purchaseGroupId"], { name: "idx_finance_purchase_group" });
      }
      if (!has("idx_finance_bank_account")) {
        await queryInterface.addIndex("finances", ["bankAccountId"], { name: "idx_finance_bank_account" });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indices novos em finances:", idxErr.message);
    }

    const appointmentPaymentsTable = await queryInterface.describeTable("appointment_payments");
    if (!appointmentPaymentsTable.bankAccountId) {
      await queryInterface.addColumn("appointment_payments", "bankAccountId", {
        type: DataTypes.UUID,
        allowNull: true,
      });
      console.log("Coluna bankAccountId adicionada em AppointmentPayments");
    }

    if (dialect === "postgres") {
      await sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumlabel = 'parcelado'
              AND enumtypid = (
                SELECT oid FROM pg_type WHERE typname = 'enum_finances_frequency'
              )
          ) THEN
            ALTER TYPE "enum_finances_frequency" ADD VALUE 'parcelado';
          END IF;
        END$$;
      `);
    } else if (dialect === "mysql" || dialect === "mariadb") {
      await sequelize.query(
        "ALTER TABLE `finances` MODIFY COLUMN `frequency` ENUM('unico','mensal','anual','parcelado') NULL",
      );
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de Finances:", error);
  }
}

async function ensureBankAccountsSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("bank_accounts")) {
      await queryInterface.createTable("bank_accounts", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        usersId: { type: DataTypes.UUID, allowNull: false },
        name: { type: DataTypes.STRING(120), allowNull: false },
        bank: { type: DataTypes.STRING(120), allowNull: true },
        agency: { type: DataTypes.STRING(20), allowNull: true },
        accountNumber: { type: DataTypes.STRING(40), allowNull: true },
        accountType: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "corrente" },
        pixKey: { type: DataTypes.STRING(180), allowNull: true },
        initialBalance: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        notes: { type: DataTypes.TEXT, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela bank_accounts criada");
    }

    try {
      const indexes = await queryInterface.showIndex("bank_accounts");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("idx_bank_accounts_user")) {
        await queryInterface.addIndex("bank_accounts", ["usersId"], { name: "idx_bank_accounts_user" });
      }
      if (!has("idx_bank_accounts_active")) {
        await queryInterface.addIndex("bank_accounts", ["usersId", "active"], { name: "idx_bank_accounts_active" });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indices de bank_accounts:", idxErr.message);
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de bank_accounts:", error?.message);
  }
}

async function ensureBankReconciliationSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("bank_statements")) {
      await queryInterface.createTable("bank_statements", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        usersId: { type: DataTypes.UUID, allowNull: false },
        bankAccountId: { type: DataTypes.UUID, allowNull: true },
        sourceType: { type: DataTypes.STRING(20), allowNull: false },
        fileName: { type: DataTypes.STRING(255), allowNull: true },
        startDate: { type: DataTypes.DATE, allowNull: true },
        endDate: { type: DataTypes.DATE, allowNull: true },
        totalEntries: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        totalCredits: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        totalDebits: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "imported" },
        notes: { type: DataTypes.TEXT, allowNull: true },
        createdBy: { type: DataTypes.UUID, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela bank_statements criada");
    }

    if (!normalized.includes("bank_statement_entries")) {
      await queryInterface.createTable("bank_statement_entries", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        statementId: { type: DataTypes.UUID, allowNull: false },
        usersId: { type: DataTypes.UUID, allowNull: false },
        bankAccountId: { type: DataTypes.UUID, allowNull: true },
        entryDate: { type: DataTypes.DATEONLY, allowNull: false },
        direction: { type: DataTypes.STRING(10), allowNull: false },
        amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        description: { type: DataTypes.STRING(500), allowNull: true },
        payerName: { type: DataTypes.STRING(180), allowNull: true },
        payerDocument: { type: DataTypes.STRING(20), allowNull: true },
        externalId: { type: DataTypes.STRING(120), allowNull: true },
        paymentMethodHint: { type: DataTypes.STRING(40), allowNull: true },
        rawJson: { type: DataTypes.JSON, allowNull: true },
        matchStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pending" },
        matchedFinanceId: { type: DataTypes.INTEGER, allowNull: true },
        matchedPaymentId: { type: DataTypes.UUID, allowNull: true },
        matchConfidence: { type: DataTypes.DECIMAL(4, 3), allowNull: true },
        matchedAt: { type: DataTypes.DATE, allowNull: true },
        matchedBy: { type: DataTypes.UUID, allowNull: true },
        matchSource: { type: DataTypes.STRING(20), allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela bank_statement_entries criada");
    }

    if (!normalized.includes("reconciliation_matches")) {
      await queryInterface.createTable("reconciliation_matches", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        usersId: { type: DataTypes.UUID, allowNull: false },
        entryId: { type: DataTypes.UUID, allowNull: false },
        bankAccountId: { type: DataTypes.UUID, allowNull: true },
        financeId: { type: DataTypes.INTEGER, allowNull: true },
        paymentId: { type: DataTypes.UUID, allowNull: true },
        confidence: { type: DataTypes.DECIMAL(4, 3), allowNull: true },
        source: { type: DataTypes.STRING(20), allowNull: false },
        grossAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
        feeAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
        netAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
        notes: { type: DataTypes.TEXT, allowNull: true },
        createdBy: { type: DataTypes.UUID, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela reconciliation_matches criada");
    }

    try {
      const idx = await queryInterface.showIndex("bank_statement_entries");
      const has = (name) => idx.some((i) => i.name === name);
      if (!has("idx_bse_user_status")) {
        await queryInterface.addIndex("bank_statement_entries", ["usersId", "matchStatus"], { name: "idx_bse_user_status" });
      }
      if (!has("idx_bse_statement")) {
        await queryInterface.addIndex("bank_statement_entries", ["statementId"], { name: "idx_bse_statement" });
      }
      if (!has("idx_bse_amount_date")) {
        await queryInterface.addIndex("bank_statement_entries", ["amount", "entryDate"], { name: "idx_bse_amount_date" });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indices em bank_statement_entries:", idxErr.message);
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de conciliacao bancaria:", error?.message);
  }
}

async function ensurePaymentMethodFeesSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("payment_method_fees")) {
      await queryInterface.createTable("payment_method_fees", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        usersId: { type: DataTypes.UUID, allowNull: false },
        method: { type: DataTypes.STRING(40), allowNull: false },
        label: { type: DataTypes.STRING(80), allowNull: false },
        feePercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
        feeFixed: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela payment_method_fees criada");
    }

    try {
      const indexes = await queryInterface.showIndex("payment_method_fees");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("uq_payment_method_fees_user_method")) {
        await queryInterface.addIndex("payment_method_fees", ["usersId", "method"], {
          name: "uq_payment_method_fees_user_method",
          unique: true,
        });
      }
      if (!has("idx_payment_method_fees_user")) {
        await queryInterface.addIndex("payment_method_fees", ["usersId"], {
          name: "idx_payment_method_fees_user",
        });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar indices de payment_method_fees:", idxErr.message);
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de payment_method_fees:", error?.message);
  }
}

async function ensureSettingsAutomationsSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const settingsTable = await queryInterface.describeTable("settings");
    if (!settingsTable.crmAutomations) {
      await queryInterface.addColumn("settings", "crmAutomations", {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
      });
      console.log("Coluna crmAutomations adicionada em Settings");
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de Settings (crmAutomations):", error);
  }
}

async function ensureAlertsSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));
    if (!normalized.includes("alert_rules")) {
      await queryInterface.createTable("alert_rules", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        name: { type: DataTypes.STRING(160), allowNull: false },
        kind: { type: DataTypes.STRING(60), allowNull: false },
        config_json: { type: DataTypes.JSON, allowNull: true },
        channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "in_app" },
        recipient: { type: DataTypes.STRING(180), allowNull: true },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        last_triggered_at: { type: DataTypes.DATE, allowNull: true },
        last_check_at: { type: DataTypes.DATE, allowNull: true },
        last_payload_json: { type: DataTypes.JSON, allowNull: true },
        cooldown_hours: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 24 },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela alert_rules criada");
    }
    if (!normalized.includes("alert_events")) {
      await queryInterface.createTable("alert_events", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        rule_id: { type: DataTypes.UUID, allowNull: false },
        rule_name: { type: DataTypes.STRING(160), allowNull: true },
        kind: { type: DataTypes.STRING(60), allowNull: false },
        severity: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "info" },
        title: { type: DataTypes.STRING(180), allowNull: false },
        message: { type: DataTypes.TEXT, allowNull: true },
        payload_json: { type: DataTypes.JSON, allowNull: true },
        delivery_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pending" },
        delivered_via: { type: DataTypes.STRING(20), allowNull: true },
        acknowledged_at: { type: DataTypes.DATE, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela alert_events criada");
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de alertas:", error);
  }
}

async function ensureAdminAuditSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));
    if (!normalized.includes("admin_audit_logs")) {
      await queryInterface.createTable("admin_audit_logs", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        admin_user_id: { type: DataTypes.UUID, allowNull: true },
        admin_name: { type: DataTypes.STRING(180), allowNull: true },
        action: { type: DataTypes.STRING(60), allowNull: false },
        target_type: { type: DataTypes.STRING(60), allowNull: true },
        target_id: { type: DataTypes.STRING(80), allowNull: true },
        target_label: { type: DataTypes.STRING(180), allowNull: true },
        method: { type: DataTypes.STRING(10), allowNull: true },
        path: { type: DataTypes.STRING(255), allowNull: true },
        status_code: { type: DataTypes.INTEGER, allowNull: true },
        metadata_json: { type: DataTypes.JSON, allowNull: true },
        ip: { type: DataTypes.STRING(60), allowNull: true },
        user_agent: { type: DataTypes.STRING(255), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela admin_audit_logs criada");
    }
    try {
      const indexes = await queryInterface.showIndex("admin_audit_logs");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("idx_admin_audit_admin_created")) {
        await queryInterface.addIndex("admin_audit_logs", ["admin_user_id", "created_at"], {
          name: "idx_admin_audit_admin_created",
        });
      }
      if (!has("idx_admin_audit_action")) {
        await queryInterface.addIndex("admin_audit_logs", ["action"], { name: "idx_admin_audit_action" });
      }
      if (!has("idx_admin_audit_created")) {
        await queryInterface.addIndex("admin_audit_logs", ["created_at"], { name: "idx_admin_audit_created" });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar índices de admin_audit_logs:", idxErr.message);
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de admin_audit_logs:", error);
  }
}

async function ensureAddonsSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("addons")) {
      await queryInterface.createTable("addons", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        key: { type: DataTypes.STRING(60), allowNull: false, unique: true },
        name: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        default_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        billing_cycle: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "monthly" },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela addons criada");
    }

    if (!normalized.includes("client_addons")) {
      await queryInterface.createTable("client_addons", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        client_user_id: { type: DataTypes.UUID, allowNull: false },
        addon_id: { type: DataTypes.UUID, allowNull: false },
        addon_key: { type: DataTypes.STRING(60), allowNull: false },
        status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "active" },
        amount_override: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        activated_at: { type: DataTypes.DATE, allowNull: true },
        next_billing_date: { type: DataTypes.DATE, allowNull: true },
        cancelled_at: { type: DataTypes.DATE, allowNull: true },
        last_payment_at: { type: DataTypes.DATE, allowNull: true },
        notes: { type: DataTypes.TEXT, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela client_addons criada");
    }

    try {
      const indexes = await queryInterface.showIndex("client_addons");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("idx_client_addons_user")) {
        await queryInterface.addIndex("client_addons", ["client_user_id"], { name: "idx_client_addons_user" });
      }
      if (!has("idx_client_addons_addon")) {
        await queryInterface.addIndex("client_addons", ["addon_id"], { name: "idx_client_addons_addon" });
      }
      if (!has("idx_client_addons_status")) {
        await queryInterface.addIndex("client_addons", ["status"], { name: "idx_client_addons_status" });
      }
      if (!has("uq_client_addons_user_addon")) {
        await queryInterface.addIndex("client_addons", ["client_user_id", "addon_id"], {
          name: "uq_client_addons_user_addon",
          unique: true,
        });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar índices de client_addons:", idxErr.message);
    }

    // Seed inicial: registra IA CRM como primeiro addon, se ainda não existir
    const { default: Addon } = await import("./models/Addon.js");
    const existing = await Addon.findOne({ where: { key: "ia_crm" } });
    if (!existing) {
      await Addon.create({
        key: "ia_crm",
        name: "IA CRM",
        description: "Atendimento automático no WhatsApp com IA",
        default_amount: 29.9,
        billing_cycle: "monthly",
        active: true,
        sort_order: 1,
      });
      console.log("Addon 'ia_crm' cadastrado");
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de addons:", error);
  }
}

async function ensureTutorialsSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));

    if (!normalized.includes("tutorial_categories")) {
      await queryInterface.createTable("tutorial_categories", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
        name: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        color: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "green" },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela tutorial_categories criada");
    }

    if (!normalized.includes("tutorial_videos")) {
      await queryInterface.createTable("tutorial_videos", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        category_id: { type: DataTypes.UUID, allowNull: false },
        title: { type: DataTypes.STRING(160), allowNull: false },
        youtube_url: { type: DataTypes.TEXT, allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("CURRENT_TIMESTAMP") },
      });
      console.log("Tabela tutorial_videos criada");
    }

    const categoryIndexes = await queryInterface.showIndex("tutorial_categories");
    if (!categoryIndexes.some((item) => item.name === "idx_tutorial_categories_sort")) {
      await queryInterface.addIndex("tutorial_categories", ["sort_order"], {
        name: "idx_tutorial_categories_sort",
      });
    }

    const videoIndexes = await queryInterface.showIndex("tutorial_videos");
    if (!videoIndexes.some((item) => item.name === "idx_tutorial_videos_category")) {
      await queryInterface.addIndex("tutorial_videos", ["category_id"], {
        name: "idx_tutorial_videos_category",
      });
    }
    if (!videoIndexes.some((item) => item.name === "idx_tutorial_videos_sort")) {
      await queryInterface.addIndex("tutorial_videos", ["sort_order"], {
        name: "idx_tutorial_videos_sort",
      });
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de tutoriais:", error?.message || error);
  }
}

async function ensureActivityLogsSchema() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));
    if (!normalized.includes("activity_logs")) {
      await queryInterface.createTable("activity_logs", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
        tenant_id: { type: DataTypes.UUID, allowNull: true },
        user_id: { type: DataTypes.UUID, allowNull: true },
        nome_usuario: { type: DataTypes.STRING(180), allowNull: true },
        modulo: { type: DataTypes.STRING(60), allowNull: false },
        acao: { type: DataTypes.STRING(80), allowNull: false },
        descricao: { type: DataTypes.STRING(500), allowNull: true },
        entidade_tipo: { type: DataTypes.STRING(60), allowNull: true },
        entidade_id: { type: DataTypes.STRING(60), allowNull: true },
        metadata_json: { type: DataTypes.JSON, allowNull: true },
        ip: { type: DataTypes.STRING(60), allowNull: true },
        navegador: { type: DataTypes.STRING(255), allowNull: true },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });
      console.log("Tabela activity_logs criada");
    }

    try {
      const indexes = await queryInterface.showIndex("activity_logs");
      const has = (name) => indexes.some((i) => i.name === name);
      if (!has("idx_activity_logs_tenant_created")) {
        await queryInterface.addIndex("activity_logs", ["tenant_id", "created_at"], {
          name: "idx_activity_logs_tenant_created",
        });
      }
      if (!has("idx_activity_logs_user_created")) {
        await queryInterface.addIndex("activity_logs", ["user_id", "created_at"], {
          name: "idx_activity_logs_user_created",
        });
      }
      if (!has("idx_activity_logs_modulo_acao")) {
        await queryInterface.addIndex("activity_logs", ["modulo", "acao"], {
          name: "idx_activity_logs_modulo_acao",
        });
      }
    } catch (idxErr) {
      console.warn("Aviso ao criar índices de activity_logs:", idxErr.message);
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de activity_logs:", error);
  }
}

async function ensureUsersSchema() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    const usersTable = await queryInterface.describeTable("users");

    if (!usersTable.lastAccess) {
      await queryInterface.addColumn("users", "lastAccess", {
        type: DataTypes.DATE,
        allowNull: true,
      });
      console.log("Coluna lastAccess adicionada em Users");
    }

    if (!usersTable.phone) {
      await queryInterface.addColumn("users", "phone", {
        type: DataTypes.STRING,
        allowNull: true,
      });
      console.log("Coluna phone adicionada em Users");
    }
  } catch (error) {
    console.error("Nao foi possivel validar o schema de Users:", error);
  }
}

async function ensureWhatsappHubSchema() {
  const queryInterface = sequelize.getQueryInterface();

  async function ensureColumn(tableName, tableSchema, columnName, definition) {
    if (tableSchema[columnName]) return;
    await queryInterface.addColumn(tableName, columnName, definition);
    console.log(`Coluna ${columnName} adicionada em ${tableName}`);
  }

  try {
    const connectionsTable = await queryInterface.describeTable("whatsapp_connections");
    await ensureColumn("whatsapp_connections", connectionsTable, "integrationMode", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "simple",
    });
    await ensureColumn("whatsapp_connections", connectionsTable, "businessId", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await ensureColumn("whatsapp_connections", connectionsTable, "businessName", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await ensureColumn("whatsapp_connections", connectionsTable, "connectedAt", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  } catch (error) {
    console.error("Nao foi possivel validar o schema de whatsapp_connections:", error);
  }

  try {
    const messagesTable = await queryInterface.describeTable("whatsapp_messages");
    await ensureColumn("whatsapp_messages", messagesTable, "phone", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await ensureColumn("whatsapp_messages", messagesTable, "origin", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "api",
    });
    await ensureColumn("whatsapp_messages", messagesTable, "externalMessageId", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await ensureColumn("whatsapp_messages", messagesTable, "templateName", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await ensureColumn("whatsapp_messages", messagesTable, "errorMessage", {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  } catch (error) {
    console.error("Nao foi possivel validar o schema de whatsapp_messages:", error);
  }

  try {
    const templatesTable = await queryInterface.describeTable("whatsapp_templates");
    await ensureColumn("whatsapp_templates", templatesTable, "title", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await ensureColumn("whatsapp_templates", templatesTable, "body", {
      type: DataTypes.TEXT,
      allowNull: true,
    });
    await ensureColumn("whatsapp_templates", templatesTable, "variables", {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    });
    await ensureColumn("whatsapp_templates", templatesTable, "active", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await ensureColumn("whatsapp_templates", templatesTable, "isSystem", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await ensureColumn("whatsapp_templates", templatesTable, "sortOrder", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  } catch (error) {
    console.error("Nao foi possivel validar o schema de whatsapp_templates:", error);
  }

  try {
    const webhookLogsTable = await queryInterface.describeTable("whatsapp_webhook_logs");
    await ensureColumn("whatsapp_webhook_logs", webhookLogsTable, "logType", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "event",
    });
    await ensureColumn("whatsapp_webhook_logs", webhookLogsTable, "description", {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  } catch (error) {
    console.error("Nao foi possivel validar o schema de whatsapp_webhook_logs:", error);
  }
}

async function ensureCrmConversationsSchema() {
  const queryInterface = sequelize.getQueryInterface();

  async function ensureColumn(tableName, tableSchema, columnName, definition) {
    if (tableSchema[columnName]) return;
    await queryInterface.addColumn(tableName, columnName, definition);
    console.log(`Coluna ${columnName} adicionada em ${tableName}`);
  }

  try {
    const conversationsTable = await queryInterface.describeTable("crm_conversations");
    await ensureColumn("crm_conversations", conversationsTable, "companyId", {
      type: DataTypes.UUID,
      allowNull: true,
    });
    await ensureColumn("crm_conversations", conversationsTable, "stage", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "prospectar",
    });
  } catch (error) {
    console.error("Nao foi possivel validar o schema de crm_conversations:", error);
  }

  try {
    const conversationMessagesTable = await queryInterface.describeTable("crm_conversation_messages");
    await ensureColumn("crm_conversation_messages", conversationMessagesTable, "companyId", {
      type: DataTypes.UUID,
      allowNull: true,
    });
  } catch (error) {
    console.error("Nao foi possivel validar o schema de crm_conversation_messages:", error);
  }
}

async function ensureCrmAiLearningSchema() {
  // Camada 2 de aprendizado: adiciona colunas de feedback em crm_ai_action_logs
  // (para 👍/👎 + correção humana virar exemplo de playbook) e cria a tabela
  // customer_ai_notes (anotações por cliente que viram contexto da IA).
  const queryInterface = sequelize.getQueryInterface();

  async function ensureColumn(tableName, tableSchema, columnName, definition) {
    if (tableSchema[columnName]) return;
    await queryInterface.addColumn(tableName, columnName, definition);
    console.log(`Coluna ${columnName} adicionada em ${tableName}`);
  }

  try {
    const actionLogsTable = await queryInterface.describeTable("crm_ai_action_logs");
    await ensureColumn("crm_ai_action_logs", actionLogsTable, "feedback", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await ensureColumn("crm_ai_action_logs", actionLogsTable, "correctedReply", {
      type: DataTypes.TEXT,
      allowNull: true,
    });
    await ensureColumn("crm_ai_action_logs", actionLogsTable, "feedbackBy", {
      type: DataTypes.UUID,
      allowNull: true,
    });
    await ensureColumn("crm_ai_action_logs", actionLogsTable, "feedbackAt", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await ensureColumn("crm_ai_action_logs", actionLogsTable, "appliedToPlaybook", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  } catch (error) {
    console.error("Nao foi possivel validar o schema de crm_ai_action_logs:", error?.message);
  }
}

async function reinitBaileysSessions() {
  // Apos restart, reabre as conexoes Baileys de quem ja tinha sessao salva.
  // Sem isso, os usuarios continuam recebendo "connected" no DB mas o socket
  // nao esta ativo na memoria — e mensagens entrantes sao perdidas.
  try {
    const { default: Settings } = await import("./models/Settings.js");
    const all = await Settings.findAll({ attributes: ["usersId", "whatsappConnection"], limit: 500 });
    const candidates = all.filter((s) => {
      const cfg = s?.whatsappConnection?.baileys;
      return cfg && (cfg.connectionStatus === "connected" || cfg.authState?.creds);
    });
    if (candidates.length === 0) return;
    console.log(`🔄 Reabrindo ${candidates.length} sessao(oes) Baileys salvas...`);
    for (const settings of candidates) {
      try {
        const inst = BaileysService.getInstance(settings.usersId, "default");
        await inst.initialize();
        console.log(`  ✓ Baileys reinicializado para user ${settings.usersId}`);
      } catch (err) {
        console.warn(`  ✗ Falhou para user ${settings.usersId}:`, err?.message);
      }
    }
  } catch (err) {
    console.error("Erro no auto-reinit do Baileys:", err?.message);
  }
}

sequelize
  .sync()
  .then(async () => {
    await ensureUsersSchema();
    await ensureAppointmentSchema();
    await ensureWhatsappHubSchema();
    await ensureCrmConversationsSchema();
    await ensureSettingsAutomationsSchema();
    await ensureFinanceSchema();
    await ensureBankAccountsSchema();
    await ensureBankReconciliationSchema();
    await ensurePaymentMethodFeesSchema();
    await ensureActivityLogsSchema();
    await ensureAddonsSchema();
    await ensureTutorialsSchema();
    await ensureAdminAuditSchema();
    await ensureAlertsSchema();
    await ensureCrmAiLearningSchema();
    console.log("Conectado ao banco de dados");
    // Reabre sessoes Baileys em background (nao bloqueia startup)
    if (process.env.DISABLE_BAILEYS_REINIT !== "true") {
      reinitBaileysSessions();
    } else {
      console.log("Baileys auto-reinit desativado por ambiente");
    }
    if (process.env.DISABLE_CRM_RESPONSE_QUEUE !== "true") {
      processPendingResponseJobs().catch((error) => {
        console.error("Erro ao recuperar respostas pendentes do CRM:", error.message);
      });
    } else {
      console.log("Fila de respostas CRM desativada por ambiente");
    }
  })
  .catch((erro) => {
    console.error("Houve um erro: ", erro);
  });

const PORT = process.env.PORT || 4003;

app.listen(PORT, () => {
  console.clear();
  console.log(`🚀 Servidor online na porta ${PORT}`);
  console.log("📡 Rotas de subscription corrigidas - RESTART");
  console.log("🔗 Ambiente: ", process.env.NODE_ENV);
  console.log("🔗 API_URL: ", process.env.API_URL);

  // Cron de automacoes CRM — roda a cada 5 minutos
  if (process.env.DISABLE_CRM_RESPONSE_QUEUE !== "true") {
    setInterval(async () => {
      try {
        await processPendingResponseJobs();
      } catch (error) {
        console.error("Erro na fila de respostas do CRM:", error.message);
      }
    }, 15000);
  } else {
    console.log("Fila de respostas CRM pausada neste processo");
  }

  if (process.env.DISABLE_CRM_AUTOMATIONS_CRON !== "true") {
    cron.schedule("*/5 * * * *", async () => {
      try {
        const result = await runAutomationsForAllUsers();
        if (result.totalUsers > 0) {
          console.log(`🤖 Automacoes CRM rodadas para ${result.totalUsers} usuarios`);
        }
      } catch (error) {
        console.error("❌ Erro no cron de automacoes:", error.message);
      }
    });
    console.log("🤖 Cron de automacoes CRM ativado (a cada 5 min)");
  }

  // Cron de alertas admin — roda a cada 30 minutos
  if (process.env.DISABLE_ADMIN_ALERTS_CRON !== "true") {
    cron.schedule("*/30 * * * *", async () => {
      try {
        const result = await alertEngine.runAlerts();
        if (result.fired > 0) {
          console.log(`🔔 Alertas admin: ${result.fired}/${result.processed} dispararam`);
        }
      } catch (error) {
        console.error("❌ Erro no cron de alertas admin:", error.message);
      }
    });
    console.log("🔔 Cron de alertas admin ativado (a cada 30 min)");
  }

  // Keep-alive: ping próprio a cada 14 minutos para evitar hibernação no Render
  if (process.env.WHATSAPP_IA_CRON_ENABLED === "true") {
    cron.schedule("10 9 * * *", async () => {
      try {
        const result = await scanInactiveUsers({
          days: process.env.WHATSAPP_IA_INACTIVITY_DAYS || 10,
        });
        if (result.scanned > 0) {
          console.log(`WhatsApp IA: ${result.scanned} usuarios inativos revisados`);
        }
        const processed = await processDueInactiveAutomations({ limit: 30 });
        if (processed.processed > 0) {
          console.log(`WhatsApp IA: ${processed.sent} mensagens enviadas, ${processed.blocked} bloqueadas`);
        }
      } catch (error) {
        console.error("Erro no cron do WhatsApp IA:", error.message);
      }
    });
    console.log("Cron do WhatsApp IA ativado (diario 09:10)");
  } else {
    console.log("Cron do WhatsApp IA desativado. Ative somente apos os testes controlados.");
  }

  if (process.env.NODE_ENV === "production" && process.env.API_URL) {
    const keepAliveUrl = `${process.env.API_URL}/health`;
    setInterval(async () => {
      try {
        const { default: fetch } = await import("node-fetch");
        await fetch(keepAliveUrl, { method: "GET" });
        console.log("🏓 Keep-alive ping enviado");
      } catch (e) {
        console.warn("⚠️ Keep-alive falhou:", e.message);
      }
    }, 14 * 60 * 1000); // 14 minutos
  }
});
