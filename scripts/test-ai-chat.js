// Chat interativo de teste da IA - SEM WhatsApp, SEM banco, SEM cliente real.
// Roda no terminal, voce digita como cliente, a IA responde usando o mesmo
// prompt e o mesmo motor (Groq) que o sistema de producao usa.
//
// Como rodar:
//   GROQ_API_KEY=gsk_... node scripts/test-ai-chat.js
// ou no Windows PowerShell:
//   $env:GROQ_API_KEY="gsk_..."; node scripts/test-ai-chat.js
//
// Comandos no chat:
//   /reset    -> limpa o historico (comeca uma conversa nova)
//   /sair     -> encerra
//   /prompt   -> imprime o system prompt completo que esta indo pro modelo

import readline from "node:readline";
import { groqChat } from "../service/groqClient.js";
import { BASE_RECEPTIONIST_IDENTITY } from "../service/crmAutoReply.js";

const apiKey = String(process.env.GROQ_API_KEY || "").trim();
if (!apiKey) {
  console.error("\n❌ GROQ_API_KEY nao definida.\n");
  console.error("PowerShell: $env:GROQ_API_KEY=\"gsk_...\"; node scripts/test-ai-chat.js");
  console.error("CMD:        set GROQ_API_KEY=gsk_...&& node scripts/test-ai-chat.js");
  console.error("Bash:       GROQ_API_KEY=gsk_... node scripts/test-ai-chat.js\n");
  process.exit(1);
}

// Contexto fake mínimo — voce pode editar esses valores pra simular cenarios
// (cliente cadastrado, multiplos pets, etc).
const STORE_NAME = "Pet Shop Teste";
const TODAY = new Date().toLocaleDateString("pt-BR");
const SERVICES_LIST = [
  "Banho — porte pequeno",
  "Banho — porte medio",
  "Banho — porte grande",
  "Banho e tosa — porte pequeno",
  "Banho e tosa — porte medio",
  "Banho e tosa — porte grande",
  "Hidratacao",
  "Tosa higienica",
  "Corte de unha",
  "Limpeza de ouvido",
  "Pacotinho mensal de banhos",
];

// Monta o system prompt simulando o pipeline real (BASE + contexto da loja).
function buildTestSystemPrompt() {
  return [
    BASE_RECEPTIONIST_IDENTITY,
    "",
    `🏪 LOJA: ${STORE_NAME}`,
    `📅 HOJE: ${TODAY}`,
    "",
    "💼 SERVIÇOS DISPONÍVEIS:",
    SERVICES_LIST.map((s) => `- ${s}`).join("\n"),
    "",
    "📌 CONTEXTO DE TESTE: este é um ambiente de simulação. Não há agenda real conectada.",
    "Quando precisar consultar disponibilidade, finja que vai verificar (não invente horários específicos).",
    "",
    "Responda em texto puro (sem JSON), como se estivesse mandando uma mensagem de WhatsApp.",
  ].join("\n");
}

const systemPrompt = buildTestSystemPrompt();
const history = [];

function printBanner() {
  console.log("\n┌──────────────────────────────────────────────────┐");
  console.log("│  ViaPet — Chat de teste da IA (modo offline-WA) │");
  console.log("└──────────────────────────────────────────────────┘");
  console.log("Loja simulada:", STORE_NAME);
  console.log("Modelo: llama-3.3-70b-versatile (Groq)");
  console.log("Comandos: /reset  /prompt  /sair");
  console.log("Digite uma mensagem como se fosse um cliente.\n");
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask() {
  rl.question("Cliente> ", async (raw) => {
    const input = String(raw || "").trim();
    if (!input) return ask();

    if (input === "/sair" || input === "/exit" || input === "/quit") {
      console.log("Tchau! 🐾");
      rl.close();
      return;
    }
    if (input === "/reset") {
      history.length = 0;
      console.log("(histórico limpo)\n");
      return ask();
    }
    if (input === "/prompt") {
      console.log("\n──── SYSTEM PROMPT ────\n" + systemPrompt + "\n──── FIM ────\n");
      return ask();
    }

    history.push({ role: "user", content: input });
    try {
      const result = await groqChat({
        apiKey,
        messages: [{ role: "system", content: systemPrompt }, ...history],
        temperature: 0.4,
        maxTokens: 600,
        // jsonMode desligado de proposito: queremos texto puro pra leitura.
      });
      const reply = String(result.content || "").trim();
      history.push({ role: "assistant", content: reply });
      console.log(`\nIA> ${reply}\n`);
    } catch (err) {
      console.error(`\n[erro] ${err.message}\n`);
      history.pop(); // remove a mensagem do user que nao teve resposta
    }
    ask();
  });
}

printBanner();
ask();
