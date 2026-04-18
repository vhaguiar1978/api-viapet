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
import FilterRouter from "./routes/filter.routes.js";
import appointmentComandaRouter from "./routes/appointmentComanda.js";
import vaccinePlansRouter from "./routes/vaccinePlans.js";
process.env.TZ = "America/Sao_Paulo";
const app = express();
// Aumenta o limite do body parser
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

app.use(express.json());
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
app.use(financeRouter);
app.use(personalFinanceRouter);
app.use(driversRouter);
app.use(bannersRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/crm-ai", crmAiRouter);
app.use(crmWhatsappRouter);
app.use(crmWhatsappOauthRouter);
app.use(crmConversationsRouter);
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

sequelize
  .sync()
  .then(async () => {
    await ensureAppointmentSchema();
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
