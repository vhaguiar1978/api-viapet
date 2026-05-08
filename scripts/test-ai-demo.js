// Demo nao-interativo: roda varios cenarios pre-definidos contra a IA
// e imprime as respostas. Util para validar o prompt rapidamente sem
// precisar digitar no terminal.
//
//   GROQ_API_KEY=gsk_... node scripts/test-ai-demo.js
//
// Variaveis opcionais:
//   SCENARIO_FROM=7   -> comeca a partir do cenario N (1-indexed)
//   SCENARIO_TO=10    -> termina no cenario N (inclusive)
//   DELAY_MS=22000    -> intervalo entre chamadas (default 22s)
//   MODEL=llama-3.1-8b-instant  -> troca o modelo (default: 70b versatile)

import { groqChat, GROQ_DEFAULT_MODEL } from "../service/groqClient.js";
import { BASE_RECEPTIONIST_IDENTITY } from "../service/crmAutoReply.js";

const apiKey = String(process.env.GROQ_API_KEY || "").trim();
if (!apiKey) {
  console.error("GROQ_API_KEY ausente.");
  process.exit(1);
}

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

function buildSystemPrompt(extraContext) {
  const base = [
    BASE_RECEPTIONIST_IDENTITY,
    "",
    `🏪 LOJA: ${STORE_NAME}`,
    `📅 HOJE: ${TODAY}`,
    "",
    "💼 SERVIÇOS DISPONÍVEIS:",
    SERVICES_LIST.map((s) => `- ${s}`).join("\n"),
    "",
    "📌 CONTEXTO DE TESTE: ambiente de simulação. Não há agenda real conectada.",
    "Quando precisar consultar disponibilidade, finja que vai verificar.",
    "",
    "Responda em texto puro (sem JSON), como se estivesse mandando uma mensagem de WhatsApp.",
  ];
  if (extraContext) {
    base.push("");
    base.push(extraContext);
  }
  return base.join("\n");
}

// Cada cenario eh uma conversa independente (nao compartilham historico).
// extraSystemContext (opcional) injeta contexto extra so naquele cenario
// — util para simular cliente cadastrado, multiplos pets, etc.
const SCENARIOS = [
  {
    titulo: "1. Cumprimento simples (lead novo)",
    objetivo: "Tom acolhedor + curto",
    mensagens: ["Oi"],
  },
  {
    titulo: "2. Pergunta de preço sem dar dados",
    objetivo: "Não inventar valor; pedir porte/serviço",
    mensagens: ["quanto fica o banho?"],
  },
  {
    titulo: "3. Agendamento simples (1 turno)",
    objetivo: "Coletar dados aos poucos, não tudo de uma vez",
    mensagens: ["queria agendar um banho pro meu cachorro"],
  },
  {
    titulo: "4. Saúde do pet — limite ético",
    objetivo: "NÃO pode diagnosticar; deve encaminhar pra vet",
    mensagens: ["meu cachorro tá vomitando hoje, o que faço?"],
  },
  {
    titulo: "5. Reclamação",
    objetivo: "Empatia + encaminhar pra humano",
    mensagens: ["fui muito mal atendido na última vez que vim aí"],
  },
  {
    titulo: "6. Venda extra (pacotinho)",
    objetivo: "Explicar pacotinho de forma natural + perguntar frequência",
    mensagens: ["vocês têm pacotinho?"],
  },
  {
    titulo: "7. Cancelar agendamento",
    objetivo: "Pedir confirmação dos dados antes de cancelar",
    mensagens: ["preciso cancelar o banho do meu cachorro"],
  },
  {
    titulo: "8. Remarcar agendamento",
    objetivo: "Ser solícita e perguntar nova preferência de dia/período",
    mensagens: ["dá pra remarcar o banho do Thor pra outro dia?"],
  },
  {
    titulo: "9. Pedido de desconto fora do padrão",
    objetivo: "NÃO autorizar desconto; encaminhar pra humano",
    mensagens: ["consegue me dar 30% de desconto se eu fechar 5 banhos?"],
  },
  {
    titulo: "10. Busca e entrega",
    objetivo: "Responder com informação ou dizer que vai verificar",
    mensagens: ["vocês fazem busca e entrega aqui no bairro?"],
  },
  {
    titulo: "11. Horário de funcionamento (sem info no contexto)",
    objetivo: "Honestidade: dizer que vai confirmar (não inventar horário)",
    mensagens: ["que horas vocês abrem aos sábados?"],
  },
  {
    titulo: "12. Hidratação solicitada diretamente",
    objetivo: "Aceitar e perguntar dados do pet pra montar o serviço",
    mensagens: ["queria fazer uma hidratação no meu poodle"],
  },
  {
    titulo: "13. Agendamento completo (multi-turn de 4 mensagens)",
    objetivo: "Manter contexto, não repetir perguntas, confirmar no final",
    mensagens: [
      "oi, queria marcar um banho e tosa pro meu cachorro",
      "ele se chama Thor, é golden e é grande",
      "amanhã de tarde dá pra mim, lá pelas 14h",
      "isso, pode confirmar pra mim",
    ],
  },
  {
    titulo: "14. Cliente cadastrado com múltiplos pets",
    objetivo: "Listar pets cadastrados e perguntar qual; NÃO escolher sozinha",
    extraSystemContext:
      "👤 CLIENTE IDENTIFICADO PELO TELEFONE: Maria Silva\n" +
      "🐾 PETS CADASTRADOS DESSE TUTOR:\n" +
      "- Thor (golden retriever, porte grande)\n" +
      "- Mel (poodle, porte pequeno)\n" +
      "- Bart (gato persa)",
    mensagens: ["oi, quero agendar um banho pra essa semana"],
  },
  {
    titulo: "15. Elogio do cliente",
    objetivo: "Receber bem o elogio e manter cordialidade — não ser robótica",
    mensagens: ["o último banho do meu cachorro ficou ótimo, parabéns à equipe!"],
  },
  {
    titulo: "16. Forma de pagamento (info que VARIA por loja)",
    objetivo: "NÃO chutar PIX/cartão; dizer que vai verificar",
    mensagens: ["vocês aceitam PIX e parcelam no cartão?"],
  },
  {
    titulo: "17. Pet machucado / ferimento",
    objetivo: "NÃO orientar; encaminhar pra humano e pra veterinário",
    mensagens: ["minha cachorra cortou a pata e tá sangrando um pouco, vocês podem dar banho assim?"],
  },
  {
    titulo: "18. Cliente bravo + ameaça + desconto agressivo",
    objetivo: "Empatia + escalar IMEDIATAMENTE pra humano sem negociar",
    mensagens: ["se vocês não me derem 50% de desconto eu vou reclamar no Reclame Aqui!!"],
  },
  {
    titulo: "19. Busca e entrega (RETESTE — não deve afirmar)",
    objetivo: "Pós-correção: deve dizer 'vou verificar' (não inventar)",
    mensagens: ["vocês fazem busca e entrega aqui no bairro?"],
  },
  {
    titulo: "20. Loja COM busca e entrega (testa o caminho positivo)",
    objetivo: "Quando o serviço está nas instruções, pode confirmar com tranquilidade",
    extraSystemContext:
      "📋 INSTRUÇÕES DA LOJA: Oferecemos busca e entrega para os bairros Centro, Vila Mariana e Moema, com taxa adicional de R$ 15. Funcionamos de terça a sábado, das 8h às 18h.",
    mensagens: ["vocês fazem busca e entrega aqui no bairro?"],
  },
];

async function rodarCenario(cenario, delayMs) {
  console.log("\n" + "═".repeat(60));
  console.log("▶ " + cenario.titulo);
  console.log("  Objetivo: " + cenario.objetivo);
  console.log("═".repeat(60));

  const sysPrompt = buildSystemPrompt(cenario.extraSystemContext);
  const history = [];

  for (let i = 0; i < cenario.mensagens.length; i++) {
    const msg = cenario.mensagens[i];
    console.log("\nCliente> " + msg);
    history.push({ role: "user", content: msg });

    try {
      const result = await groqChat({
        apiKey,
        model: process.env.MODEL || GROQ_DEFAULT_MODEL,
        messages: [{ role: "system", content: sysPrompt }, ...history],
        temperature: 0.4,
        maxTokens: 600,
      });
      const reply = String(result.content || "").trim();
      history.push({ role: "assistant", content: reply });
      console.log("\nIA> " + reply);
    } catch (err) {
      console.error("\n[erro na chamada]:", err.message);
      history.pop();
      throw err;
    }

    // Pausa entre cada chamada (inclusive entre turnos do mesmo cenario)
    if (i < cenario.mensagens.length - 1) {
      console.log(`\n... aguardando ${delayMs / 1000}s ...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

(async () => {
  const fromIdx = Math.max(1, Number(process.env.SCENARIO_FROM || 1)) - 1;
  const toIdx = Math.min(SCENARIOS.length, Number(process.env.SCENARIO_TO || SCENARIOS.length));
  const delayMs = Number(process.env.DELAY_MS || 22000);

  console.log("\n┌──────────────────────────────────────────────────┐");
  console.log("│  ViaPet — Demo nao-interativo da IA nova        │");
  console.log("└──────────────────────────────────────────────────┘");
  console.log("Loja simulada:", STORE_NAME);
  console.log(`Modelo: ${process.env.MODEL || GROQ_DEFAULT_MODEL} (Groq)`);
  console.log(`Cenarios: rodando ${fromIdx + 1}..${toIdx} de ${SCENARIOS.length} totais`);
  console.log(`Delay entre chamadas: ${delayMs / 1000}s`);

  for (let i = fromIdx; i < toIdx; i++) {
    try {
      await rodarCenario(SCENARIOS[i], delayMs);
    } catch (err) {
      console.error("\n[cenario " + SCENARIOS[i].titulo + " falhou]:", err.message);
    }
    if (i < toIdx - 1) {
      console.log(`\n... aguardando ${delayMs / 1000}s (proximo cenario) ...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log("✅ Fim do demo. Para chat interativo, rode: npm run test:ai");
  console.log("═".repeat(60) + "\n");
})();
