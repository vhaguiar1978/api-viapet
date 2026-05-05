import Settings from "../models/Settings.js";
import Services from "../models/Services.js";
import Products from "../models/Products.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";
import CrmAiActionLog from "../models/CrmAiActionLog.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import { groqChat } from "./groqClient.js";

function normalizeSearchable(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// ─── Detectores de intencao e entidades ──────────────────────────────────

const VERBS_AGENDAR = ["agendar", "marcar", "agendamento", "agenda", "horario para", "vaga", "disponivel", "tem vaga", "consigo", "quero agend", "quero marcar"];
const VERBS_PRECO = ["quanto", "preco", "valor", "custa", "tabela"];
const VERBS_INFO_SERVICO = ["servicos", "oferecem", "fazem", "trabalha"];
const VERBS_HORARIO = ["que horas funciona", "que horas abre", "que horas fecha", "horario de funcionamento", "abre que", "fecha que", "ate que horas"];
const VERBS_CANCELAR = ["cancelar", "desmarcar", "cancela"];
const VERBS_CUMPRIMENTO = ["ola", "oi", "ola!", "oi!", "bom dia", "boa tarde", "boa noite", "tudo bem", "td bem"];
const VERBS_LOCALIZACAO = ["endereco", "onde", "localizacao", "rua", "fica onde"];
const VERBS_TELEFONE = ["telefone", "contato", "numero"];

function detectIntent(text) {
  const n = normalizeSearchable(text);
  // ORDEM IMPORTA — intencoes mais especificas primeiro
  if (VERBS_AGENDAR.some((v) => n.includes(v))) return "agendar";
  if (VERBS_CANCELAR.some((v) => n.includes(v))) return "cancelar";
  if (VERBS_PRECO.some((v) => n.includes(v))) return "preco";
  if (VERBS_HORARIO.some((v) => n.includes(v))) return "horario";
  if (VERBS_LOCALIZACAO.some((v) => n.includes(v))) return "localizacao";
  if (VERBS_TELEFONE.some((v) => n.includes(v))) return "telefone";
  if (VERBS_INFO_SERVICO.some((v) => n.includes(v))) return "info_servico";
  if (VERBS_CUMPRIMENTO.some((v) => n === v || n.startsWith(v + " "))) return "cumprimento";
  return "indefinido";
}

function detectServico(text) {
  const n = normalizeSearchable(text);
  if (n.includes("banho e tosa") || n.includes("completo")) return "banho_tosa";
  if (n.includes("tosa")) return "tosa";
  if (n.includes("banho")) return "banho";
  if (n.includes("hidratacao")) return "hidratacao";
  if (n.includes("vacina")) return "vacina";
  if (n.includes("consulta")) return "consulta";
  return null;
}

// Detecta data simples: "hoje", "amanha", "dd/mm", "dia X"
function detectData(text) {
  const n = normalizeSearchable(text);
  if (n.includes("hoje")) return "hoje";
  if (n.includes("amanha")) return "amanha";
  if (n.includes("depois de amanha")) return "depois_amanha";
  const dataMatch = n.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dataMatch) return `${dataMatch[1]}/${dataMatch[2]}`;
  const diaMatch = n.match(/\bdia\s+(\d{1,2})\b/);
  if (diaMatch) return `dia ${diaMatch[1]}`;
  const diasSemana = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"];
  for (const d of diasSemana) if (n.includes(d)) return d;
  return null;
}

// Detecta hora: "10h", "10:00", "10 horas", "as 10"
function detectHora(text) {
  const n = normalizeSearchable(text);
  const m1 = n.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m1) return `${m1[1]}:${m1[2]}`;
  const m2 = n.match(/\b(\d{1,2})\s*h\b/);
  if (m2) return `${m2[1]}:00`;
  const m3 = n.match(/\bas\s+(\d{1,2})\b/);
  if (m3) return `${m3[1]}:00`;
  const m4 = n.match(/\b(\d{1,2})\s+horas?\b/);
  if (m4) return `${m4[1]}:00`;
  return null;
}

// ─── Helpers humanizadores ───────────────────────────────────────────────

function pickGreeting(customerName) {
  // Saudacao curta variada (sem nome todo - mais natural)
  const firstName = String(customerName || "").trim().split(/\s+/)[0] || "";
  const variants = firstName && firstName.length > 1 && firstName.length < 20
    ? [`Oi, ${firstName}!`, `${firstName}, tudo bem?`, `Olá, ${firstName}!`, "Opa!", "Oi!"]
    : ["Oi!", "Olá!", "Tudo bem?", "Opa!"];
  return variants[Math.floor(Math.random() * variants.length)];
}

function pickClose() {
  // Fechamento natural sem repetir sempre a mesma pergunta
  const variants = [
    "Posso ajudar?",
    "Posso te ajudar?",
    "Quer que eu siga?",
    "Que tal?",
    "Combinado?",
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

// ─── Construtores de resposta ────────────────────────────────────────────

function buildAgendarReply({ greeting, settings, customer, pet, services, text, history }) {
  const servico = detectServico(text);
  const data = detectData(text);
  const hora = detectHora(text);

  const opening = String(settings?.openingTime || "08:00:00").slice(0, 5);
  const closing = String(settings?.closingTime || "18:00:00").slice(0, 5);

  const servicoEncontrado = servico
    ? services.find((s) => normalizeSearchable(s.name).includes(servico.replace("_", " ")))
    : null;

  // tem servico + data + hora → propoe confirmacao
  if (servico && data && hora) {
    const precoTxt = servicoEncontrado?.price
      ? ` Fica R$ ${Number(servicoEncontrado.price).toFixed(2)}.`
      : "";
    const variants = [
      `${greeting} Perfeito! Anotei aqui: ${servico.replace("_", " e ")}${pet?.name ? ` para o ${pet.name}` : ""} no dia ${data} às ${hora}.${precoTxt} Confirmo o agendamento? 🐾`,
      `${greeting} Ótimo! Então fica ${servico.replace("_", " e ")}${pet?.name ? ` do ${pet.name}` : ""} ${data} às ${hora}.${precoTxt} Pode confirmar?`,
      `${greeting} Show! ${servico.replace("_", " e ")}${pet?.name ? ` para o ${pet.name}` : ""} ${data} às ${hora}.${precoTxt} Tudo certo? 😊`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  if (servico && data && !hora) {
    const variants = [
      `${greeting} Beleza, ${servico.replace("_", " e ")} no dia ${data}. Que horário fica melhor pra você? A gente atende das ${opening} às ${closing}.`,
      `${greeting} Anotado, ${servico.replace("_", " e ")} ${data}. Qual horário você prefere? Estamos das ${opening} às ${closing}.`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  if (servico && !data) {
    const variants = [
      `${greeting} Claro! Pra quando você quer marcar o ${servico.replace("_", " e ")}${pet?.name ? ` do ${pet.name}` : ""}?`,
      `${greeting} Vamos lá! ${servico.replace("_", " e ")}${pet?.name ? ` para o ${pet.name}` : ""}, qual dia e horário fica bom?`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  if (!servico && data && hora) {
    const opcoes = services.slice(0, 4).map((s) => s.name).join(", ");
    return `${greeting} Para ${data} às ${hora}, qual serviço você quer? A gente faz ${opcoes || "banho, tosa, hidratação"}.`;
  }

  // generico
  const opcoes = services.slice(0, 4).map((s) => s.name).join(", ");
  const variants = [
    `${greeting} Claro! Que serviço você quer marcar${pet?.name ? ` para o ${pet.name}` : ""}? A gente faz ${opcoes || "banho, tosa, hidratação"}. E pra qual dia/horário?`,
    `${greeting} Vamos agendar! Me conta: qual serviço${pet?.name ? ` para o ${pet.name}` : ""}, dia e horário?`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

function buildPrecoReply({ greeting, services, customer, pet, text }) {
  const servico = detectServico(text);
  if (servico) {
    const found = services.find((s) => normalizeSearchable(s.name).includes(servico.replace("_", " ")));
    if (found) {
      const preco = found.price != null ? Number(found.price).toFixed(2) : "varia conforme o porte";
      const variants = [
        `${greeting} O ${found.name} sai por R$ ${preco}.${pet?.name ? ` Quer que eu agende para o ${pet.name}?` : " Quer agendar?"}`,
        `${greeting} ${found.name}: R$ ${preco}.${pet?.name ? ` Posso marcar para o ${pet.name}?` : " Posso marcar pra você?"}`,
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
  }
  const list = services.length
    ? services
        .slice(0, 5)
        .map((s) => `${s.name}${s.price != null ? ` R$ ${Number(s.price).toFixed(2)}` : ""}`)
        .join(", ")
    : "banho e tosa conforme o porte";
  return `${greeting} Olha só nossos valores: ${list}. Quer que eu marque algum?`;
}

function buildHorarioReply({ greeting, settings }) {
  const opening = String(settings?.openingTime || "08:00:00").slice(0, 5);
  const closing = String(settings?.closingTime || "18:00:00").slice(0, 5);
  const variants = [
    `${greeting} A gente abre das ${opening} às ${closing}, de segunda a sábado. Quer já marcar um horário?`,
    `${greeting} Funcionamos das ${opening} às ${closing} (seg a sáb). Posso te encaixar em algum dia?`,
    `${greeting} Estamos das ${opening} às ${closing}, segunda a sábado. Vamos marcar?`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

function buildLocalizacaoReply({ greeting, settings }) {
  const addr = settings?.address || settings?.endereco;
  if (addr) return `${greeting} Estamos em: ${addr}. Quer que eu agende um horario?`;
  return `${greeting} Para te enviar a localizacao, posso pedir para o atendente humano confirmar. Enquanto isso, posso ja agendar um horario?`;
}

function buildCancelarReply({ greeting }) {
  return `${greeting} Sem problema. Me confirma a data e o horario do agendamento que voce quer cancelar, por favor.`;
}

function buildCumprimentoReply({ greeting, settings, pet, services, identifyAsAi }) {
  const opcoes = services.slice(0, 3).map((s) => s.name).join(", ");
  const intro = identifyAsAi
    ? `Sou a IA do ${settings?.storeName || "pet shop"}. `
    : "";
  // Variacoes humanizadas — escolhe aleatoria
  const variants = [
    `${greeting} ${intro}Como posso te ajudar hoje? 😊`,
    `${greeting} Tudo bem? Posso ajudar com agendamento de ${opcoes || "banho/tosa"}${pet?.name ? `, alguma duvida sobre o ${pet.name}?` : "?"}`,
    `${greeting} Que bom falar contigo! ${pet?.name ? `Como vai o ${pet.name}? ` : ""}Posso agendar ${opcoes || "um banho"}, tirar duvida de preco ou horario.`,
    `${greeting} Em que posso ajudar? Estamos com horarios disponiveis para ${opcoes || "banho e tosa"}.`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

function buildInfoServicoReply({ greeting, services, pet }) {
  const list = services.length
    ? services.slice(0, 5).map((s) => s.name).join(", ")
    : "banho, tosa, hidratacao";
  return `${greeting} Oferecemos ${list}${pet?.name ? `. Quer agendar algum para o ${pet.name}?` : ". Posso agendar para voce?"}`;
}

function buildIndefinidoReply({ greeting, services, history }) {
  // Se o cliente disse algo nao classificado, evita repetir a ultima resposta
  const lastBot = history?.[0]?.body || "";
  const opcoes = services.slice(0, 3).map((s) => s.name).join(", ");
  return `${greeting} Nao entendi direito, pode me explicar com outras palavras? Posso ajudar com: agendamento, preco, horario ou cancelamento. Servicos disponiveis: ${opcoes || "banho, tosa"}.`;
}

// ─── Builder principal: roteia para o construtor certo ───────────────────

function buildReply({ question, services, settings, customer, pet, history, identifyAsAi }) {
  const text = String(question || "");
  const greeting = pickGreeting(customer?.name);
  const intent = detectIntent(text);

  switch (intent) {
    case "agendar":
      return buildAgendarReply({ greeting, settings, customer, pet, services, text, history });
    case "preco":
      return buildPrecoReply({ greeting, services, customer, pet, text });
    case "horario":
      return buildHorarioReply({ greeting, settings });
    case "cancelar":
      return buildCancelarReply({ greeting });
    case "localizacao":
      return buildLocalizacaoReply({ greeting, settings });
    case "cumprimento":
      return buildCumprimentoReply({ greeting, settings, pet, services, identifyAsAi });
    case "info_servico":
      return buildInfoServicoReply({ greeting, services, pet });
    case "telefone":
      return `${greeting} Pode me falar por aqui mesmo! O que você precisa?`;
    default:
      return buildIndefinidoReply({ greeting, services, history });
  }
}

// ─── Integracao Groq (IA real, gratuita) ─────────────────────────────────

function buildSystemPrompt({ settings, aiControl, services, products = [], customer, pet, pets = [] }) {
  const storeName = settings?.storeName || "o pet shop";
  const opening = String(settings?.openingTime || "08:00:00").slice(0, 5);
  const closing = String(settings?.closingTime || "18:00:00").slice(0, 5);
  const identifyAsAi = Boolean(aiControl?.identifyAsAi);
  const customInstructions = String(aiControl?.instructions || "").trim();
  const escalation = (aiControl?.escalationKeywords || [])
    .filter(Boolean)
    .join(", ");
  const canCreateAppointment = Boolean(aiControl?.capabilities?.createAppointment);
  const today = new Date().toLocaleDateString("pt-BR");

  // Lista de servicos com IDs (uso INTERNO da IA, nao mostrar pro cliente)
  // Limite generoso (40) — a IA recebe lista filtrada por relevancia.
  const servicesList = services
    .slice(0, 40)
    .map((s) => {
      const price = s.price != null && Number(s.price) > 0
        ? ` (R$ ${Number(s.price).toFixed(2)})`
        : "";
      return `- ID:${s.id} | ${s.name}${price}`;
    })
    .join("\n");

  // Lista de produtos relevantes (so se a mensagem mencionar algo)
  const productsList = products.slice(0, 20).map((p) => {
    const price = p.price != null && Number(p.price) > 0
      ? ` (R$ ${Number(p.price).toFixed(2)})`
      : "";
    const stock = p.stoke != null ? ` [estoque: ${p.stoke}]` : "";
    return `- ${p.name}${price}${stock}`;
  }).join("\n");

  const customerInfo = customer
    ? `Cliente: ${customer.name} (id: ${customer.id})${customer.phone ? ` (${customer.phone})` : ""}`
    : "Cliente novo (sem cadastro)";

  // Lista de pets do cliente (pode ter mais de um)
  const petsList = (pets && pets.length > 0)
    ? pets.map((p) => {
        const detalhes = [
          p.species,
          p.breed,
          p.sex,
        ].filter(Boolean).join(", ");
        return `  - ID:${p.id} | ${p.name}${detalhes ? ` (${detalhes})` : ""}`;
      }).join("\n")
    : null;

  const petInfo = petsList
    ? `Pets cadastrados deste cliente (${pets.length}):\n${petsList}`
    : (pet
        ? `Pet: ${pet.name} (id: ${pet.id})${pet.species ? ` (${pet.species}${pet.breed ? `, ${pet.breed}` : ""})` : ""}`
        : "Cliente NAO TEM pets cadastrados ainda — pergunte o nome do pet antes de agendar");

  return `Voce e o atendente virtual do ${storeName}, um pet shop. Atende clientes pelo WhatsApp.

REGRAS DE ATENDIMENTO:
- Seja simpatica, calorosa e profissional. Fale como um humano de pet shop, nao como um robo.
- ${identifyAsAi ? "Pode dizer que e uma IA quando perguntada." : "NAO se identifique como IA. Aja como uma atendente humana."}
- Use linguagem informal brasileira (oi, beleza, show, claro, sem problema).
- Mensagens curtas e objetivas (1-3 frases).
- Pode usar emojis com moderacao 🐾 😊
- Hoje e ${today}.

⛔ NUNCA MENCIONE OS IDs DOS SERVICOS, CLIENTES OU PETS PARA O CLIENTE.
   Os IDs (formatos como "e07fd9eb-...") sao USO INTERNO seu — APENAS para preencher action.serviceId.
   Para o cliente final, sempre fale APENAS o NOME do servico (ex: "Banho", "Tosa", "Banho e Tosa").
   Se voce nao tem certeza qual servico o cliente quer, PERGUNTE pelo NOME, nunca pelo ID.

INFORMACOES DO ESTABELECIMENTO:
- Nome: ${storeName}
- Horario: ${opening} as ${closing}, segunda a sabado

SERVICOS E PRECOS (lista filtrada por relevancia):
${servicesList || "- Banho e tosa conforme o porte"}

${productsList ? `PRODUTOS RELEVANTES NA LOJA (consulte preco e estoque):\n${productsList}\n` : ""}

CONTEXTO DO CLIENTE ATUAL:
- ${customerInfo}
${petInfo}

${pets && pets.length > 1 ? `🐾 ATENCAO: Este cliente tem ${pets.length} pets cadastrados! Antes de agendar, PERGUNTE qual pet (pelo nome). Use o nome do pet que o cliente mencionar para escolher o petId correto da lista.` : ""}
${pets && pets.length === 1 ? `Cliente tem apenas 1 pet (${pets[0].name}). Pode usar direto, sem perguntar.` : ""}

O QUE VOCE NAO DEVE FAZER:
- Inventar precos ou servicos que nao estao na lista acima
- Discutir assuntos fora de pet shop
- Dar conselho veterinario serio
- Mencionar palavras: ${escalation || "urgente, reclamacao, emergencia"} → escalar pra humano

${customInstructions ? `INSTRUCOES ESPECIAIS DO DONO:\n${customInstructions}\n` : ""}

${canCreateAppointment ? `IMPORTANTE: VOCE PODE CRIAR AGENDAMENTOS DE VERDADE.
Quando o cliente confirmar um agendamento (com servico + data + hora claros), inclua a action no JSON.
Exemplos de cliente CONFIRMANDO: "pode agendar", "confirma sim", "ok pode marcar", "fechado", "tá bom".

REGRAS PARA CRIAR AGENDAMENTO (CRITICAS):
1. serviceId DEVE ser o ID EXATO do servico que o cliente pediu, da lista acima.
   - Se cliente disse "banho" → procure na lista o servico com nome "Banho" e copie o ID.
   - Se cliente disse "tosa" → procure "Tosa".
   - Se cliente nao especificou, PERGUNTE qual servico antes de criar.
2. date DEVE estar no formato YYYY-MM-DD. Hoje = ${new Date().toISOString().slice(0,10)}.
   - "amanha" = ${new Date(Date.now() + 86400000).toISOString().slice(0,10)}
3. time DEVE estar em HH:MM (24h). "16h" = "16:00", "9h da manha" = "09:00".
4. NUNCA invente IDs. Use SOMENTE os IDs que aparecem na lista de servicos acima.
5. Se nao tiver servico claro na lista, NAO crie a action — pergunte.
` : ""}

⚠️ FORMATO DE RESPOSTA OBRIGATORIO ⚠️
Voce DEVE responder SEMPRE em JSON valido com a estrutura:
{ "reply": "texto", "action": null OU objeto }

NUNCA responda com texto solto. SEMPRE JSON.

EXEMPLOS:

1) Cliente pergunta horario → action: null
Cliente: "Que horas vocês abrem?"
Resposta: {"reply": "A gente abre das 08h às 18h, segunda a sábado. Quer que eu agende?", "action": null}

2) Cliente quer agendar mas nao confirmou ainda → action: null
Cliente: "quero marcar um banho amanhã as 10h"
Resposta: {"reply": "Beleza! Banho amanhã às 10h. Confirmo o agendamento?", "action": null}

3) Cliente CONFIRMA → action com create_appointment
Cliente: "pode confirmar sim"
Resposta: {"reply": "Pronto! Agendamento confirmado para amanhã às 10h.", "action": {"type": "create_appointment", "serviceId": "9e594d8e-c4f8-4a6d-9f9d-c13b283b6b30", "petId": "9660a3ed-e565-42cb-aaac-810c5f0c3bee", "date": "2026-05-06", "time": "10:00"}}

4) Cliente confirma TUDO em uma mensagem so → action ja com tudo
Cliente: "agenda banho do bili pra amanha 14h, pode confirmar"
Resposta: {"reply": "Pronto! Banho do Bili amanhã às 14h confirmado!", "action": {"type": "create_appointment", "serviceId": "9e594d8e-...", "petId": "9660a3ed-...", "date": "2026-05-06", "time": "14:00"}}

REGRAS PRA GERAR action.create_appointment:
- Tem que ter serviceId DA LISTA acima (nao invente)
- date no formato YYYY-MM-DD
- time no formato HH:MM
- O cliente PRECISA ter confirmado (palavras: "pode", "confirma", "ok", "fechado", "ta bom", "agenda", "marca", "sim quero")
- Se faltar QUALQUER dado: action: null e PERGUNTE o que falta

REGRAS PARA o pet (use UM dos dois campos):
- Se o pet ESTA na lista cadastrada → use "petId": "<id-da-lista>"
- Se o pet NAO esta na lista (cliente disse outro nome) → use "petName": "<nome>" (NAO use petId)
- Cliente tem 0 pets cadastrados e nao disse nome → PERGUNTE primeiro
- Cliente tem 1 pet cadastrado e nao disse nome → use o petId desse pet
- Cliente tem 2+ pets cadastrados e nao disse qual → PERGUNTE qual

Exemplo (pet novo nao cadastrado):
Cliente: "agenda banho da Princesa amanha 14h pode confirmar"
Resposta: {"reply": "Pronto! Banho da Princesa amanhã às 14h confirmado!", "action": {"type": "create_appointment", "serviceId": "9e594d8e-...", "petName": "Princesa", "date": "2026-05-06", "time": "14:00"}}

TODA resposta DEVE ser JSON puro. Sem texto fora do JSON. Sem markdown.

Agora responda a proxima mensagem do cliente.`;
}

async function buildHistoryMessages(conversationId, limit = 8) {
  if (!conversationId) return [];
  try {
    const rows = await CrmConversationMessage.findAll({
      where: { conversationId },
      order: [["createdAt", "DESC"]],
      limit,
      attributes: ["body", "direction", "createdAt"],
    });
    // Inverte para ordem cronologica e mapeia para roles do chat
    return rows.reverse().map((m) => ({
      role: m.direction === "outbound" ? "assistant" : "user",
      content: String(m.body || "").slice(0, 500),
    }));
  } catch (_) {
    return [];
  }
}

async function generateGroqReply({
  apiKey,
  settings,
  aiControl,
  services,
  products,
  customer,
  pet,
  pets,
  conversation,
  body,
}) {
  const systemPrompt = buildSystemPrompt({ settings, aiControl, services, products, customer, pet, pets });
  const history = await buildHistoryMessages(conversation?.id, 8);
  const lastUserMessage = history[history.length - 1];
  if (!lastUserMessage || lastUserMessage.role !== "user" || lastUserMessage.content !== body) {
    history.push({ role: "user", content: String(body || "").slice(0, 500) });
  }
  const messages = [{ role: "system", content: systemPrompt }, ...history];

  const result = await groqChat({
    apiKey,
    messages,
    temperature: 0.5,
    maxTokens: 500,
    jsonMode: true, // forca resposta em JSON valido
  });
  return result.content;
}

// Parser robusto: tenta varias formas de extrair { reply, action } da resposta.
function parseAiReply(rawContent) {
  if (!rawContent) return { reply: "", action: null };
  const text = String(rawContent).trim();

  // Tenta extrair bloco ```json ... ``` ou primeiro {...} valido
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  let jsonText = jsonBlockMatch ? jsonBlockMatch[1] : null;
  if (!jsonText) {
    // Procura primeiro { ate o ultimo } no texto
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      jsonText = text.slice(start, end + 1);
    }
  }

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === "object" && typeof parsed.reply === "string") {
        return {
          reply: parsed.reply.trim(),
          action: parsed.action && typeof parsed.action === "object" ? parsed.action : null,
        };
      }
    } catch (_) {
      // Cai no fallback
    }
  }

  // Fallback: o texto inteiro e a resposta (sem acao)
  return { reply: text.replace(/```json|```/g, "").trim(), action: null };
}

// Executa a acao retornada pela IA (criar agendamento, etc)
async function executeAiAction({ action, usersId, conversation, customer, pet, pets = [], aiControl }) {
  if (!action || !action.type) return { executed: false, reason: "no_action" };

  if (action.type === "create_appointment") {
    if (!aiControl?.capabilities?.createAppointment) {
      return { executed: false, reason: "capability_disabled" };
    }
    if (!customer?.id) {
      return { executed: false, reason: "no_customer_id" };
    }

    // Resolve petId em ordem: 1) action.petId valido na lista
    //                          2) action.petName -> match por nome ou cria pet novo
    //                          3) primeiro pet do array
    //                          4) pet (single) do contexto
    let chosenPetId = null;
    const actionPetId = String(action.petId || "").trim();
    const actionPetName = String(action.petName || "").trim();

    if (actionPetId) {
      const found = pets.find((p) => String(p.id) === actionPetId);
      if (found) chosenPetId = found.id;
    }

    if (!chosenPetId && actionPetName) {
      // Tenta achar por nome (case-insensitive)
      const nameLower = actionPetName.toLowerCase();
      const found = pets.find((p) => String(p.name || "").toLowerCase() === nameLower);
      if (found) {
        chosenPetId = found.id;
      } else {
        // Pet nao existe — cria automaticamente
        try {
          const { default: PetsModel } = await import("../models/Pets.js");
          const { v4: uuidv4 } = await import("uuid");
          const newPet = await PetsModel.create({
            id: uuidv4(),
            usersId,
            custumerId: customer.id,
            name: actionPetName,
            species: action.petSpecies || null,
            breed: action.petBreed || null,
          });
          chosenPetId = newPet.id;
          console.log(`[CrmAutoReply] Pet criado automaticamente: ${newPet.name} (${newPet.id.slice(0,8)})`);
        } catch (err) {
          console.error("[CrmAutoReply] Erro criando pet:", err.message);
        }
      }
    }

    if (!chosenPetId && pets.length === 1) chosenPetId = pets[0].id;
    if (!chosenPetId && pet?.id) chosenPetId = pet.id;

    if (!chosenPetId) {
      return { executed: false, reason: "no_pet_id" };
    }

    const date = String(action.date || "").trim();
    const time = String(action.time || "").trim();
    const serviceId = String(action.serviceId || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { executed: false, reason: "invalid_date", details: date };
    }
    if (!/^\d{2}:\d{2}/.test(time)) {
      return { executed: false, reason: "invalid_time", details: time };
    }
    if (!serviceId) {
      return { executed: false, reason: "no_service_id" };
    }

    try {
      const { default: Appointment } = await import("../models/Appointment.js");
      const { v4: uuidv4 } = await import("uuid");
      const created = await Appointment.create({
        id: uuidv4(),
        usersId,
        customerId: customer.id,
        petId: chosenPetId,
        serviceId,
        type: "estetica",
        date,
        time: time.slice(0, 5) + ":00",
        status: "Agendado",
        observation: "Criado pela IA via WhatsApp",
        whatsapp: true,
      });
      console.log(`[CrmAutoReply] Appointment criado: ${created.id} (${date} ${time}, pet ${chosenPetId.slice(0,8)})`);
      return { executed: true, appointmentId: created.id, date, time, serviceId, petId: chosenPetId };
    } catch (err) {
      console.error("[CrmAutoReply] Erro criando appointment:", err.message);
      return { executed: false, reason: "db_error", error: err.message };
    }
  }

  return { executed: false, reason: "unknown_action_type", type: action.type };
}

// ─── Detector de escalacao ───────────────────────────────────────────────

// Palavras default que SEMPRE escalam pra humano (independente de aiControl)
// IMPORTANTE: tirei "cancelar" sozinho — eh comum em pet shop. So escala
// quando combina com palavras de reclamacao/conflito.
const ESCALATION_DEFAULT = [
  "urgente", "emergencia", "emergência",
  "sangrando", "sangue no pet",
  "convulsao", "convulsão", "convulsionando",
  "morrendo", "envenenado", "envenenamento",
  "atropelado",
  "advogado", "processo", "procon", "reclamacao", "reclamação", "denuncia", "denúncia",
  "falar com gerente", "falar com supervisor", "falar com dono", "falar com responsavel",
  "falar com humano", "falar com pessoa real", "atendente humano", "alguem real",
  "nao quero ia", "não quero ia", "nao e a ia", "não é a ia",
  "cancelar tudo", "cancelar plano", "quero cancelar tudo", "estou cancelando",
];

function detectEscalation(text, customKeywords = []) {
  const n = normalizeSearchable(text);
  const all = [...ESCALATION_DEFAULT, ...customKeywords]
    .map((k) => normalizeSearchable(k))
    .filter(Boolean);
  const trigger = all.find((k) => n.includes(k));
  return trigger || null;
}

// Marca a conversa como precisando de atendimento humano
async function escalateConversation({ conversation, customer, body, trigger, usersId }) {
  if (!conversation?.id) return;

  // Importa modelo dinamicamente para evitar circular
  const { default: CrmConversation } = await import("../models/CrmConversation.js");

  const meta = conversation.metadata || {};
  const tags = Array.isArray(meta.tags) ? [...meta.tags] : [];
  if (!tags.includes("urgente")) tags.push("urgente");

  // Pausa a IA nessa conversa especifica
  const newMeta = {
    ...meta,
    tags,
    aiPaused: true,
    aiPausedAt: new Date().toISOString(),
    escalationReason: trigger,
    escalationMessage: String(body || "").slice(0, 200),
  };

  await CrmConversation.update(
    {
      metadata: newMeta,
      status: "pending",
      unreadCount: (conversation.unreadCount || 0) + 1,
    },
    { where: { id: conversation.id } },
  );

  // Log da escalacao
  try {
    await CrmAiActionLog.create({
      usersId,
      conversationId: conversation.id,
      customerId: customer?.id || null,
      petId: null,
      authorUserId: null,
      actionType: "escalation",
      status: "executed",
      summary: `Escalado para humano (gatilho: ${trigger})`,
      assistantReply: "",
      approvalRequired: false,
      approvedByHuman: false,
      executed: true,
      payload: { trigger, message: String(body || "").slice(0, 500) },
    });
  } catch (_) {}
}

// ─── Verificacoes e disparo ──────────────────────────────────────────────

async function canAutoReply(usersId) {
  const settings = await Settings.findOne({ where: { usersId } });
  const aiControl = settings?.whatsappConnection?.crmAiControl;
  if (!aiControl?.enabled) return { ok: false, reason: "ai_disabled", settings };
  if (!aiControl?.autoReplyEnabled) return { ok: false, reason: "auto_reply_disabled", settings };

  const sub = await CrmAiSubscription.findOne({ where: { user_id: usersId } });
  if (!sub || sub.status !== "active") {
    return { ok: false, reason: "no_active_subscription", settings };
  }
  return { ok: true, settings, aiControl };
}

export async function generateAutoReply({ usersId, conversation, customer, pet, pets = [], body }) {
  const check = await canAutoReply(usersId);
  if (!check.ok) {
    return { replied: false, reason: check.reason };
  }

  // Se a conversa ja foi escalada (aiPaused), nao responde mais nessa conversa
  // ate o atendente humano "retomar" via UI.
  if (conversation?.metadata?.aiPaused) {
    return { replied: false, reason: "ai_paused_in_conversation" };
  }

  // ESCALACAO: detecta palavras-chave do CONTROLE + defaults
  const customKeywords = check.aiControl?.escalationKeywords || [];
  const escalationTrigger = detectEscalation(body, customKeywords);
  if (escalationTrigger) {
    await escalateConversation({
      conversation,
      customer,
      body,
      trigger: escalationTrigger,
      usersId,
    });
    // Manda mensagem curta avisando o cliente, mas pausa a IA
    const customerFirstName = String(customer?.name || "").trim().split(/\s+/)[0] || "";
    const msg = `${customerFirstName ? `Oi, ${customerFirstName}!` : "Oi!"} Vou chamar um atendente para te ajudar com isso agora mesmo. So um momento, por favor 🙏`;
    console.log(`[CrmAutoReply] ESCALADO para humano (gatilho: "${escalationTrigger}")`);
    return { replied: true, reply: msg, escalated: true, trigger: escalationTrigger };
  }

  // ─── Busca inteligente de servicos e produtos ────────────────────────
  // 1) Pega TODOS os servicos e produtos (limite alto)
  // 2) Filtra por relevancia conforme a mensagem do cliente
  // 3) Sempre inclui os mais comuns (banho/tosa/hidratacao) como base
  const [allServices, allProducts] = await Promise.all([
    Services.findAll({ where: { establishment: usersId }, order: [["name", "ASC"]], limit: 200 }).catch(() => []),
    Products.findAll({ where: { usersId }, order: [["name", "ASC"]], limit: 200 }).catch(() => []),
  ]);

  const PRIORITY_KEYWORDS = ["banho", "tosa", "hidrat", "pacotinho"];
  const messageLower = normalizeSearchable(body);

  function relevanceScore(name) {
    const n = normalizeSearchable(name);
    // Match direto: nome do servico aparece na mensagem do cliente
    let score = 0;
    if (messageLower && messageLower.length > 2) {
      const tokens = n.split(/\s+/).filter((t) => t.length > 2);
      for (const t of tokens) {
        if (messageLower.includes(t)) score += 10;
      }
    }
    // Bonus prioridade (estetica acima de tudo)
    const pIdx = PRIORITY_KEYWORDS.findIndex((k) => n.includes(k));
    if (pIdx !== -1) score += 5 - pIdx;
    return score;
  }

  // Ordena services por relevancia (alta primeiro), depois alfabetico
  const services = [...allServices]
    .map((s) => ({ s, score: relevanceScore(s.name) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.s.name || "").localeCompare(String(b.s.name || ""));
    })
    .map((x) => x.s);

  const products = [...allProducts]
    .map((p) => ({ p, score: relevanceScore(p.name) }))
    .filter((x) => x.score > 0) // produtos: so se houver match com a mensagem
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);

  // Pega historico recente para evitar repeticao
  let history = [];
  if (conversation?.id) {
    history = await CrmConversationMessage.findAll({
      where: { conversationId: conversation.id, direction: "outbound" },
      order: [["createdAt", "DESC"]],
      limit: 3,
      attributes: ["body", "createdAt"],
    }).catch(() => []);
  }

  // Toggle: por default a IA NAO se identifica como IA (mais humano)
  const identifyAsAi = Boolean(check.aiControl?.identifyAsAi);

  // PRIORIDADE 1: Groq (IA real). Se tem key configurada, usa.
  // PRIORIDADE 2: Fallback para resposta por keywords (sempre funciona).
  const groqApiKey = String(check.aiControl?.groqApiKey || process.env.GROQ_API_KEY || "").trim();
  let reply = null;
  let aiSource = "keywords";

  let executedAction = null;

  if (groqApiKey) {
    try {
      const rawContent = await generateGroqReply({
        apiKey: groqApiKey,
        settings: check.settings,
        aiControl: check.aiControl,
        services,
        products,
        customer,
        pet,
        pets,
        conversation,
        body,
      });
      const parsed = parseAiReply(rawContent);
      reply = parsed.reply;
      aiSource = "groq";
      console.log(`[CrmAutoReply] Groq respondeu: "${reply.slice(0, 60)}..."`);
      // Se a IA retornou uma action, executa
      if (parsed.action) {
        executedAction = await executeAiAction({
          action: parsed.action,
          usersId,
          conversation,
          customer,
          pet,
          pets,
          aiControl: check.aiControl,
        });
        console.log(`[CrmAutoReply] Action: ${JSON.stringify(executedAction)}`);
        // Se a acao foi executada, complementa o reply com confirmacao
        if (executedAction.executed) {
          reply = reply + ` ✅ Agendamento criado: ${parsed.action.date} ${parsed.action.time}.`;
        } else if (executedAction.reason === "capability_disabled") {
          reply = reply + ` (⚠ Voce ainda precisa habilitar 'Agendar atendimento' no controle da IA.)`;
        }
      }
    } catch (groqErr) {
      console.warn(`[CrmAutoReply] Groq falhou (${groqErr.message}), usando fallback keywords`);
    }
  }

  // Fallback se Groq nao foi configurado ou falhou
  if (!reply || !reply.trim()) {
    reply = buildReply({
      question: body,
      services,
      settings: check.settings,
      customer,
      pet,
      history,
      identifyAsAi,
    });
    aiSource = "keywords";
  }

  // Anti-repeticao: se a ultima resposta da IA eh igual, varia um pouco
  const lastBotBody = String(history?.[0]?.body || "").trim();
  const finalReply = lastBotBody && lastBotBody === reply.trim()
    ? `Posso te ajudar de outra forma? Tente perguntar sobre: "agendar banho amanha 10h", "quanto custa tosa" ou "que horas funciona".`
    : reply;

  try {
    await CrmAiActionLog.create({
      usersId,
      conversationId: conversation?.id || null,
      customerId: customer?.id || null,
      petId: pet?.id || null,
      authorUserId: null,
      actionType: "auto_reply",
      status: "executed",
      summary: "Resposta automatica gerada pela IA",
      assistantReply: finalReply,
      approvalRequired: false,
      approvedByHuman: false,
      executed: true,
      payload: { question: String(body || "").slice(0, 500), intent: detectIntent(body), aiSource },
    });
  } catch (err) {
    console.warn("[CrmAutoReply] Falha ao logar acao:", err.message);
  }

  return { replied: true, reply: finalReply };
}
