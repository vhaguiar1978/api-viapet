import "dotenv/config";
import sequelize from "../database/config.js";
import Users from "../models/Users.js";
import Settings from "../models/Settings.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";
import { openaiChat } from "../service/openaiClient.js";
import { groqChat } from "../service/groqClient.js";
import { geminiChat } from "../service/geminiClient.js";

const targetEmail = String(process.argv[2] || "").trim().toLowerCase();

function maskStatus(value) {
  return value ? "configurada" : "ausente";
}

function summarizeProviderError(error) {
  const message = String(error?.message || error || "");
  if (/quota|billing|exceeded your current quota/i.test(message)) {
    return "quota_exceeded";
  }
  if (/401|unauthorized|invalid api key/i.test(message)) {
    return "invalid_key";
  }
  if (/timeout/i.test(message)) {
    return "timeout";
  }
  if (/unsupported parameter/i.test(message)) {
    return "unsupported_parameter";
  }
  if (/unable to verify|certificate|fetch failed/i.test(message)) {
    return "tls_or_network";
  }
  return message.slice(0, 160) || "unknown_error";
}

async function testOpenAi(apiKey, model) {
  if (!apiKey) return { ok: false, status: "missing_key" };
  try {
    const result = await openaiChat({
      apiKey,
      model,
      messages: [{ role: "user", content: "Responda apenas pong." }],
      maxTokens: 20,
      temperature: 0.2,
    });
    return {
      ok: true,
      status: "ready",
      model: result.model || model,
    };
  } catch (error) {
    return {
      ok: false,
      status: summarizeProviderError(error),
      model,
    };
  }
}

async function testGroq(apiKey) {
  if (!apiKey) return { ok: false, status: "missing_key" };
  try {
    const result = await groqChat({
      apiKey,
      messages: [{ role: "user", content: "Responda apenas pong." }],
      maxTokens: 20,
      temperature: 0.2,
    });
    return {
      ok: true,
      status: "ready",
      model: result.model,
    };
  } catch (error) {
    return { ok: false, status: summarizeProviderError(error) };
  }
}

async function testGemini(apiKey) {
  if (!apiKey) return { ok: false, status: "missing_key" };
  try {
    const result = await geminiChat({
      apiKey,
      messages: [{ role: "user", content: "Responda apenas pong." }],
      maxTokens: 20,
      temperature: 0.2,
    });
    return {
      ok: true,
      status: "ready",
      model: result.model,
    };
  } catch (error) {
    return { ok: false, status: summarizeProviderError(error) };
  }
}

try {
  await sequelize.authenticate();

  const user = targetEmail
    ? await Users.findOne({
        where: sequelize.where(
          sequelize.fn("LOWER", sequelize.col("email")),
          targetEmail,
        ),
      })
    : await Users.findOne({ where: { role: "admin" }, order: [["createdAt", "ASC"]] });

  if (!user) {
    console.log(JSON.stringify({ ok: false, block: "user_not_found" }, null, 2));
    process.exit(1);
  }

  const [settings, subscription] = await Promise.all([
    Settings.findOne({ where: { usersId: user.id } }),
    CrmAiSubscription.findOne({ where: { user_id: user.id } }),
  ]);

  const conn = settings?.whatsappConnection || {};
  const aiControl = conn.crmAiControl || {};
  const openaiKey = String(aiControl.openaiApiKey || process.env.OPENAI_API_KEY || "").trim();
  const groqKey = String(aiControl.groqApiKey || process.env.GROQ_API_KEY || "").trim();
  const geminiKey = String(aiControl.geminiApiKey || process.env.GEMINI_API_KEY || "").trim();
  const model = process.env.OPENAI_CRM_MODEL || process.env.OPENAI_MODEL || "gpt-5.5";

  const providerResults = {
    openai: await testOpenAi(openaiKey, model),
    groq: await testGroq(groqKey),
    gemini: await testGemini(geminiKey),
  };

  const whatsappReady = Boolean(
    (conn.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID) &&
      (conn.accessToken || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN),
  ) || Boolean(conn?.baileys?.authState?.creds);

  const blocks = [];
  if (!aiControl.enabled) blocks.push("ai_disabled");
  if (!aiControl.autoReplyEnabled) blocks.push("auto_reply_disabled");
  if (subscription?.status !== "active") blocks.push("crm_ai_subscription_inactive");
  if (!whatsappReady) blocks.push("whatsapp_provider_missing");
  if (!Object.values(providerResults).some((item) => item.ok)) blocks.push("no_live_ai_provider");

  const result = {
    ok: blocks.length === 0,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    ai: {
      enabled: Boolean(aiControl.enabled),
      autoReplyEnabled: Boolean(aiControl.autoReplyEnabled),
      autoExecuteEnabled: Boolean(aiControl.autoExecuteEnabled),
      assistantName: aiControl.assistantName || "ViaPet IA",
    },
    subscription: {
      status: subscription?.status || "missing",
    },
    providers: {
      configured: {
        openai: maskStatus(openaiKey),
        groq: maskStatus(groqKey),
        gemini: maskStatus(geminiKey),
      },
      live: providerResults,
    },
    whatsapp: {
      cloudApiConfigured: Boolean(
        (conn.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID) &&
          (conn.accessToken || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN),
      ),
      baileysConfigured: Boolean(conn?.baileys?.authState?.creds),
    },
    blocks,
  };

  console.log(JSON.stringify(result, null, 2));
  await sequelize.close();
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.log(JSON.stringify({ ok: false, block: "check_failed", error: summarizeProviderError(error) }, null, 2));
  await sequelize.close().catch(() => {});
  process.exit(2);
}
