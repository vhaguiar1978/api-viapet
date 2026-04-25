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
import personalFinanceRouter from "./routes/personal_finances.js";
import driversRouter from "./routes/drivers.js";
import bannersRouter from "./routes/banner.js";
import serviceRoutes from "./routes/Service.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import crmAiRouter from "./routes/crmAi.js";
import crmWhatsappRouter from "./routes/crmWhatsapp.js";
import crmWhatsappOauthRouter from "./routes/crmWhatsappOauth.js";
import crmConversationsRouter from "./routes/crmConversations.js";
import crmBaileysRouter from "./routes/crmBaileys.js";
import whatsappOfficialRouter from "./routes/whatsappOfficial.js";
import whatsappHubRouter from "./routes/whatsappHub.js";
import FilterRouter from "./routes/filter.routes.js";
import appointmentComandaRouter from "./routes/appointmentComanda.js";
import vaccinePlansRouter from "./routes/vaccinePlans.js";
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
app.use(personalFinanceRouter);
app.use(driversRouter);
app.use(bannersRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/crm-ai", crmAiRouter);
app.use(crmWhatsappRouter);
app.use(crmWhatsappOauthRouter);
app.use(crmConversationsRouter);
app.use(crmBaileysRouter);
app.use(FilterRouter);
app.use("/services", serviceRoutes);
app.use(appointmentComandaRouter);
app.use(vaccinePlansRouter);
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
  } catch (error) {
    console.error("Nao foi possivel validar o schema de Appointments:", error);
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

sequelize
  .sync()
  .then(async () => {
    await ensureUsersSchema();
    await ensureAppointmentSchema();
    await ensureWhatsappHubSchema();
    await ensureCrmConversationsSchema();
    console.log("Conectado ao banco de dados");
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

  // Keep-alive: ping próprio a cada 14 minutos para evitar hibernação no Render
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
