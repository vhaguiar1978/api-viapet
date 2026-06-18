// Diagnostico CLI da IA do CRM para uma loja.
// Mostra exatamente o que esta bloqueando a IA de responder, em ordem de
// prioridade. Espelha o endpoint GET /api/crm-ai/diagnose mas roda local
// (precisa do .env com creds do banco).
//
// Uso:
//   node diagnose-ai.js                          # primeira loja encontrada
//   node diagnose-ai.js dono@minhaloja.com       # por e-mail
//   node diagnose-ai.js dono@minhaloja.com <conversationId>  # inclui status da conversa
//
// Saida sai com codigo 0 se IA esta ok pra responder, 1 se ha bloqueio.

import "dotenv/config";
import sequelize from "./database/config.js";
import Users from "./models/Users.js";
import Settings from "./models/Settings.js";
import CrmConversation from "./models/CrmConversation.js";
import CrmAiSubscription from "./models/CrmAiSubscription.js";

const targetEmail = String(process.argv[2] || "").trim().toLowerCase();
const targetConvId = String(process.argv[3] || "").trim();

function ok(label, msg = "") {
  console.log(`  ✓ ${label}${msg ? ` — ${msg}` : ""}`);
}
function warn(label, msg = "") {
  console.log(`  ⚠ ${label}${msg ? ` — ${msg}` : ""}`);
}
function fail(label, msg = "") {
  console.log(`  ✗ ${label}${msg ? ` — ${msg}` : ""}`);
}

(async () => {
  let blockingCount = 0;
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
      console.log(`[X] User nao encontrado${targetEmail ? ` para "${targetEmail}"` : ""}`);
      process.exit(1);
    }

    console.log(`\n=== Diagnostico IA do CRM ===`);
    console.log(`Loja: ${user.name} <${user.email}>`);
    console.log(`User ID: ${user.id}\n`);

    // 1) aiControl
    console.log(`[1] aiControl no Settings.whatsappConnection`);
    const settings = await Settings.findOne({ where: { usersId: user.id } });
    const aiControl = settings?.whatsappConnection?.crmAiControl;

    if (!aiControl) {
      fail("aiControl ausente", "abra o painel da IA e clique em salvar");
      blockingCount++;
    } else {
      ok("aiControl presente");
      if (aiControl.enabled) {
        ok("enabled = true");
      } else {
        fail("enabled = false", "ative 'IA habilitada' no painel");
        blockingCount++;
      }
      if (aiControl.autoReplyEnabled) {
        ok("autoReplyEnabled = true");
      } else {
        fail("autoReplyEnabled = false", "ative 'responder automaticamente' no painel");
        blockingCount++;
      }
      if (aiControl.autoExecuteEnabled) {
        ok("autoExecuteEnabled = true (IA pode CRIAR agendamentos)");
      } else {
        warn("autoExecuteEnabled = false", "IA so PROPOE agendamento, nao cria de fato");
      }
      console.log(`    assistantName: ${aiControl.assistantName || "(padrao)"}`);
      console.log(`    instructions: ${String(aiControl.instructions || "").slice(0, 80) || "(vazio)"}${(aiControl.instructions || "").length > 80 ? "..." : ""}`);
    }

    // 2) Subscription
    console.log(`\n[2] CrmAiSubscription`);
    const sub = await CrmAiSubscription.findOne({ where: { user_id: user.id } });
    if (!sub) {
      fail("subscription nao existe", "renove em /crm-ai/subscribe no painel");
      blockingCount++;
    } else if (sub.status !== "active") {
      fail(`subscription status="${sub.status}"`, "precisa estar 'active' pra IA rodar");
      blockingCount++;
    } else {
      ok(`active`, sub.ends_at ? `expira ${new Date(sub.ends_at).toLocaleDateString("pt-BR")}` : "");
    }

    // 3) Provedor de IA
    console.log(`\n[3] Provedor de IA`);
    const openaiOnUser = String(aiControl?.openaiApiKey || "").trim();
    const openaiOnEnv = String(process.env.OPENAI_API_KEY || "").trim();
    const groqOnUser = String(aiControl?.groqApiKey || "").trim();
    const groqOnEnv = String(process.env.GROQ_API_KEY || "").trim();
    const geminiOnUser = String(aiControl?.geminiApiKey || "").trim();
    const geminiOnEnv = String(process.env.GEMINI_API_KEY || "").trim();
    if (openaiOnUser) {
      ok("OpenAI no painel do user", `prefixo ${openaiOnUser.slice(0, 7)}...`);
    } else if (openaiOnEnv) {
      ok("OpenAI no env GLOBAL", `prefixo ${openaiOnEnv.slice(0, 7)}...`);
    } else if (groqOnUser) {
      ok("Groq no painel do user", `prefixo ${groqOnUser.slice(0, 6)}...`);
    } else if (groqOnEnv) {
      ok("Groq no env GLOBAL", `prefixo ${groqOnEnv.slice(0, 6)}...`);
    } else if (geminiOnUser) {
      ok("Gemini no painel do user", "configurada");
    } else if (geminiOnEnv) {
      ok("Gemini no env GLOBAL", "configurada");
    } else {
      warn(
        "SEM OPENAI/GROQ/GEMINI API KEY",
        "IA vai cair em fallback por palavras-chave. Configure OPENAI_API_KEY no Render ou no painel da IA.",
      );
    }

    // 4) WhatsApp provider
    console.log(`\n[4] WhatsApp provider`);
    const conn = settings?.whatsappConnection || {};
    const cloudConfigured = Boolean(
      (conn.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID) &&
      (conn.accessToken || process.env.WHATSAPP_TOKEN),
    );
    const baileysCreds = Boolean(conn?.baileys?.authState?.creds);
    const baileysStatus = conn?.baileys?.connectionStatus || "nunca conectou";
    if (cloudConfigured) {
      ok("Meta Cloud API configurada", `phoneNumberId=${conn.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID}`);
    } else {
      warn("Meta Cloud API nao configurada");
    }
    if (baileysCreds) {
      ok("Baileys: tem creds salvas (escaneou QR antes)", `ultimo status: ${baileysStatus}`);
      if (baileysStatus !== "connected") {
        warn(
          "ultimo status nao e 'connected'",
          "reabra o painel WhatsApp e cheque conexao; se cair, reescaneie o QR",
        );
      }
    } else {
      warn("Baileys: sem creds (nunca conectou)");
    }
    if (!cloudConfigured && !baileysCreds) {
      fail("Nenhum provedor WhatsApp ativo", "conecte via QR (Baileys) ou configure Cloud API");
      blockingCount++;
    }

    // 5) Conversa (se fornecida)
    if (targetConvId) {
      console.log(`\n[5] Conversa ${targetConvId.slice(0, 8)}`);
      const conv = await CrmConversation.findOne({ where: { id: targetConvId, usersId: user.id } });
      if (!conv) {
        fail("conversa nao encontrada para esta loja");
      } else {
        console.log(`    status: ${conv.status} | canal: ${conv.channel} | phone: ${conv.phone}`);
        if (conv.metadata?.aiPaused) {
          fail("IA PAUSADA nesta conversa", `motivo: ${conv.metadata.escalationReason || "manual"}, desde ${conv.metadata.aiPausedAt || "?"}`);
          blockingCount++;
        } else {
          ok("IA nao pausada nesta conversa");
        }
      }
    }

    // Conversas escaladas globais (sino IA)
    const escalatedCount = await CrmConversation.count({
      where: {
        usersId: user.id,
        // Sequelize JSON query — pode variar por dialeto. Tenta os 2 mais comuns.
        [Symbol.for("op.literal") || "literal"]: undefined,
      },
    }).catch(() => null);
    if (escalatedCount !== null) {
      console.log(`\n[6] Conversas totais da loja: ${escalatedCount}`);
    }

    console.log(`\n${"═".repeat(50)}`);
    if (blockingCount === 0) {
      console.log(`✓ IA esta PRONTA pra responder. Se ainda nao responde, mande uma mensagem`);
      console.log(`  WhatsApp de teste e olhe os logs do Render (busque [CrmAutoReply]).`);
      process.exit(0);
    } else {
      console.log(`✗ ${blockingCount} bloqueio(s) encontrado(s). Corrija na ordem acima.`);
      process.exit(1);
    }
  } catch (err) {
    console.error("\nERRO no diagnostico:", err.message);
    if (err.message.includes("ECONNREFUSED") || err.message.includes("authentication")) {
      console.error("\n→ Banco nao acessivel deste ambiente. Use o endpoint web em vez:");
      console.error("  GET https://<seu-render>/api/crm-ai/diagnose (autenticado)");
    }
    process.exit(2);
  }
})();
