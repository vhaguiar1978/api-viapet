import { Op } from "sequelize";
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

function buildSystemPrompt({ settings, aiControl, services, products = [], customer, pet, pets = [], upcomingAppointments = [] }) {
  const storeName = settings?.storeName || "o pet shop";
  // PRIORIDADE: o que tem no painel da IA (scheduling) sobrepoe os horarios
  // gerais da loja (settings). Antes a IA quotava o da loja, ignorando o painel.
  const aiStart = String(aiControl?.scheduling?.allowedTimeStart || "").trim();
  const aiEnd = String(aiControl?.scheduling?.allowedTimeEnd || "").trim();
  const opening = aiStart || String(settings?.openingTime || "08:00:00").slice(0, 5);
  const closing = aiEnd || String(settings?.closingTime || "18:00:00").slice(0, 5);
  const customInstructions = String(aiControl?.instructions || "").trim();
  const customLower = customInstructions.toLowerCase();

  // Detecta o nome se o dono escreveu "se apresenta com X" / "se apresente como X"
  // / "voce e a X" nas instructions. Tem prioridade sobre assistantName do painel.
  let assistantName = String(aiControl?.assistantName || "ViaPet IA").trim();
  const nameMatch = customInstructions.match(/(?:apresenta(?:r|nta)?(?:\s+com|\s+como)?|voc[eê]\s+(?:e|é|s[eo]u)\s+a?)\s+([A-ZÁÉÍÓÚÇÃÕa-záéíóúçãõ][a-záéíóúçãõ]{2,20})/);
  if (nameMatch) {
    const detected = nameMatch[1];
    // So sobrepoe se for nome diferente do assistantName atual
    if (detected && !["ia", "iA", "atendente", "assistente", "robo", "chatbot"].includes(detected.toLowerCase())) {
      assistantName = detected;
    }
  }

  // Se o dono escreveu "nao fale que e uma ia" / "nao quero que voce fale que e ia"
  // / similar — entao identifyAsAi=false (mesmo se o painel disse true).
  let identifyAsAi = Boolean(aiControl?.identifyAsAi);
  if (
    customLower.includes("nao quero que voce fale que") ||
    customLower.includes("não quero que voce fale que") ||
    customLower.includes("nao fale que voce") ||
    customLower.includes("não fale que voce") ||
    customLower.includes("nao diga que e") ||
    customLower.includes("não diga que é") ||
    customLower.includes("aja como humana") ||
    customLower.includes("atenda como humana")
  ) {
    identifyAsAi = false;
  }

  // Se o dono escreveu "nao envie mensagem que nao entendeu" — adiciona regra extra
  const banUnclearReply =
    customLower.includes("nao envie mensagem que nao entendeu") ||
    customLower.includes("não envie mensagem que não entendeu") ||
    customLower.includes("nao quero que voce diga que nao entendeu") ||
    customLower.includes("não quero que voce diga que não entendeu");
  const escalation = (aiControl?.escalationKeywords || [])
    .filter(Boolean)
    .join(", ");
  const caps = aiControl?.capabilities || {};
  const canCreateAppointment = Boolean(caps.createAppointment);
  const canUpdateAppointment = Boolean(caps.updateAppointment);
  const canCancelAppointment = Boolean(caps.cancelAppointment);
  const canQuoteServices = caps.quoteServices !== false;
  const canQuoteProducts = caps.quoteProducts !== false;
  const canListPets = caps.listCustomerPets !== false;
  const canListHistory = caps.listCustomerHistory !== false;
  const canSendCatalog = caps.sendCatalog !== false;
  const today = new Date().toLocaleDateString("pt-BR");
  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // Playbook: pares de Q/A que o dono salvou no painel pra ensinar a IA
  // como responder em situacoes especificas. Vira "few-shot" no prompt.
  const playbook = Array.isArray(aiControl?.playbookMessages)
    ? aiControl.playbookMessages.filter((m) => m && m.text && m.role)
    : [];
  const playbookSection = playbook.length > 0
    ? "\n📚 PLAYBOOK DO DONO (exemplos de como responder em situacoes especificas):\n" +
      playbook
        .slice(-15)
        .map((m, i) => {
          const who = m.role === "assistant" ? "VOCE responde" : "Cliente diz";
          return `[${i + 1}] ${who}: ${String(m.text).slice(0, 300)}`;
        })
        .join("\n")
    : "";

  // Regras de scheduling extras
  const sched = aiControl?.scheduling || {};
  const allowedDaysList = Array.isArray(sched.allowedDays) && sched.allowedDays.length > 0
    ? sched.allowedDays.map((d) => {
        const map = { sunday: "domingo", monday: "segunda", tuesday: "terca", wednesday: "quarta", thursday: "quinta", friday: "sexta", saturday: "sabado" };
        return map[d] || d;
      }).join(", ")
    : null;
  const allowedCategoriesList = Array.isArray(sched.allowedServiceCategories) && sched.allowedServiceCategories.length > 0
    ? sched.allowedServiceCategories.join(", ")
    : null;
  const minLead = Number(sched.minimumLeadMinutes || 0);
  const maxDaily = Number(sched.maxDailyAppointments || 0);

  const schedulingRulesSection =
    (allowedDaysList || allowedCategoriesList || minLead > 0 || maxDaily > 0)
      ? "\n📅 REGRAS DE AGENDAMENTO (validadas no servidor — se voce ignorar, o sistema vai recusar):\n" +
        [
          allowedDaysList ? `- Dias permitidos: ${allowedDaysList}.` : null,
          allowedCategoriesList ? `- Categorias permitidas: ${allowedCategoriesList}.` : null,
          minLead > 0 ? `- Minimo de antecedencia: ${minLead} minutos. Nao agende mais cedo que isso.` : null,
          maxDaily > 0 ? `- Maximo ${maxDaily} agendamentos por dia (se chegou no limite, ofereca outro dia).` : null,
        ].filter(Boolean).join("\n")
      : "";

  // Filtra servicos para mostrar APENAS os relacionados a banho/tosa/hidratacao
  // (especialidade da IA). Servicos clinicos/vacinas vao ficar fora — a IA
  // encaminha pra atendente humana quando o cliente pedir.
  const SPECIALTY_KEYWORDS = [
    "banho", "tosa", "hidrat", "estetica", "estética",
    "spa", "perfume", "unha", "dente", "limpeza", "higienic", "higiênic",
    "pacotinho", "pacote", "transporte", "leva e traz", "buscar",
  ];
  const isSpecialtyService = (s) => {
    const n = normalizeSearchable(s.name || "");
    return SPECIALTY_KEYWORDS.some((kw) => n.includes(kw));
  };
  const specialtyServices = services.filter(isSpecialtyService);
  const otherServices = services.filter((s) => !isSpecialtyService(s));

  // Lista de servicos da ESPECIALIDADE (banho/tosa/hidratacao) com IDs.
  // A IA SO atende esses. Os outros (clinica/vacinas) sao listados em separado
  // SO para a IA saber que existem — mas ela NAO agenda, encaminha pra humano.
  const servicesList = specialtyServices
    .slice(0, 40)
    .map((s) => {
      const price = s.price != null && Number(s.price) > 0
        ? ` (R$ ${Number(s.price).toFixed(2)})`
        : "";
      return `- ID:${s.id} | ${s.name}${price}`;
    })
    .join("\n");

  // Servicos fora da especialidade (so para informar que existem, sem ID)
  const nonSpecialtyList = otherServices
    .slice(0, 15)
    .map((s) => `- ${s.name}`)
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

  // Lista de agendamentos futuros do cliente (para a IA poder remarcar/cancelar)
  const upcomingList = (upcomingAppointments && upcomingAppointments.length > 0)
    ? upcomingAppointments.slice(0, 5).map((a) => {
        const dateStr = a.date ? new Date(a.date).toISOString().slice(0, 10) : "";
        return `  - ID:${a.id} | ${dateStr} ${String(a.time || "").slice(0, 5)} | ${a.serviceName || a.service?.name || "servico"} (${a.status || "Agendado"})`;
      }).join("\n")
    : null;

  // Lista das capacidades ATIVAS pra a IA saber o que pode/nao pode oferecer
  const capabilitiesList = [
    canCreateAppointment ? "criar agendamentos" : null,
    canUpdateAppointment ? "remarcar agendamentos" : null,
    canCancelAppointment ? "cancelar agendamentos" : null,
    canQuoteServices ? "cotar servicos" : null,
    canQuoteProducts ? "cotar produtos" : null,
    canListPets ? "listar pets do cliente" : null,
    canListHistory ? "consultar historico de atendimentos" : null,
    canSendCatalog ? "enviar catalogo de servicos" : null,
  ].filter(Boolean).join(", ");

  return `Voce e ${assistantName}, atendente especialista em BANHO E TOSA do ${storeName}. Atende clientes pelo WhatsApp.

🎯 SUA ESPECIALIDADE (UNICA):
Banho, tosa higienica, hidratacao, pacotinhos, estetica, perfumaria, corte de unha, limpeza de dentes, leva-e-traz.

🚫 O QUE NAO E SUA ESPECIALIDADE (encaminhar pra humano):
- Tosa geral / tosa completa / tosa bebe (precisa avaliar o pet)
- Consulta veterinaria, exame, vacina, cirurgia, internacao
- Duvida medica de saude do pet
- Reclamacoes, urgencias

PERSONA E TOM:
- Voce eh ${assistantName} — ${identifyAsAi ? "uma assistente da loja (pode dizer que e IA se perguntada)" : "atende como atendente humana experiente. NAO diga que eh uma IA."}
- Apresenta-se como "${assistantName}" na primeira mensagem da conversa.
- Calorosa, simpatica, profissional. Tom informal brasileiro.
- Frases curtas e diretas (1 a 3). Sem encher o cliente de blablabla.
- Emojis com moderacao 🐾 😊 ❤️
- Hoje e ${today} (${todayIso}).

⛔ NUNCA MOSTRE IDs PARA O CLIENTE (UUIDs sao SO INTERNOS).

INFORMACOES DO ESTABELECIMENTO:
- Nome: ${storeName}
- Horario: ${opening} as ${closing}, segunda a sabado

SERVICOS QUE VOCE PODE AGENDAR (sua especialidade):
${servicesList || "- (lista vazia)"}

${nonSpecialtyList ? `SERVICOS QUE A LOJA TEM MAS VOCE NAO AGENDA (encaminha pra atendente humano):\n${nonSpecialtyList}\n` : ""}
${productsList ? `PRODUTOS NA LOJA:\n${productsList}\n` : ""}

CONTEXTO DO CLIENTE ATUAL:
- ${customerInfo}
${petInfo}
${upcomingList ? `\nAgendamentos futuros deste cliente:\n${upcomingList}` : ""}

${pets && pets.length > 1 ? `🐾 Este cliente tem ${pets.length} pets. ANTES de agendar/remarcar, identifique qual pet pelo NOME (pergunte se nao for claro).` : ""}
${pets && pets.length === 1 ? `Cliente tem 1 pet (${pets[0].name}). Pode usar direto, sem perguntar qual.` : ""}

${customInstructions ? `═══════════════════════════════════════════════════════════════
⭐⭐⭐ REGRAS INVIOLAVEIS DO DONO DA LOJA ⭐⭐⭐
   PRIORIDADE ABSOLUTA. ESTAS REGRAS SOBREPOEM TUDO ACIMA.
═══════════════════════════════════════════════════════════════
${customInstructions}
═══════════════════════════════════════════════════════════════
` : ""}${playbookSection}${schedulingRulesSection}

O QUE NAO FAZER (NUNCA):
- Inventar precos ou servicos fora da lista.
- Tentar atender consulta veterinaria, vacina, exame ou cirurgia.
- Dar diagnostico ou conselho veterinario.
${banUnclearReply ? "- ❌ NUNCA RESPONDA \"nao entendi\", \"pode explicar com outras palavras\", \"nao entendi direito\". Se a mensagem for confusa, use o contexto da conversa para inferir e perguntar UMA coisa especifica que falte (data? servico? horario? pet?). NUNCA peca pro cliente reformular a mensagem dele." : ""}
- Em caso de palavras como: ${escalation || "urgente, reclamacao, emergencia"} → escalar pra atendente humano.
- Se o cliente pedir servico que NAO seja banho/tosa/hidratacao/estetica → diga que vai chamar a atendente humana.

⚠️ FORMATO DE RESPOSTA OBRIGATORIO ⚠️
SEMPRE responda em JSON valido:
{ "reply": "texto pro cliente", "action": null OU objeto }

NUNCA texto solto. NUNCA markdown. SEMPRE JSON puro.

═══════════════════════════════════════════════════════════════
TIPOS DE ACTION DISPONIVEIS
═══════════════════════════════════════════════════════════════

${canCreateAppointment ? `▸ create_appointment — quando o cliente CONFIRMA um agendamento novo.
Campos: { type, serviceId, date (YYYY-MM-DD), time (HH:MM), petId OU petName }
- Use petId se o pet ESTA na lista cadastrada acima.
- Use petName (string) se o cliente disse um nome de pet NAO cadastrado (sera criado).
- Datas: hoje=${todayIso}, amanha=${tomorrowIso}.
- O cliente PRECISA ter confirmado: "pode", "confirma", "ok", "fechado", "ta bom", "agenda", "marca", "sim".

` : ""}${canUpdateAppointment ? `▸ reschedule_appointment — quando o cliente quer REMARCAR um agendamento existente.
Campos: { type, appointmentId, newDate (YYYY-MM-DD), newTime (HH:MM) }
- appointmentId DEVE ser de UM dos agendamentos futuros listados acima.
- So crie a action depois do cliente confirmar a nova data/hora.

` : ""}${canCancelAppointment ? `▸ cancel_appointment — quando o cliente quer CANCELAR.
Campos: { type, appointmentId, reason (opcional) }
- appointmentId DEVE ser de UM dos agendamentos futuros listados.
- Confirme com o cliente antes de cancelar.

` : ""}═══════════════════════════════════════════════════════════════
EXEMPLOS DE RESPOSTAS
═══════════════════════════════════════════════════════════════

[1] Pergunta de horario:
Cliente: "Que horas vcs abrem?"
{"reply": "A gente abre das ${opening} às ${closing}, de segunda a sábado. Quer agendar algo?", "action": null}

[2] Cotar servico:
Cliente: "quanto fica banho do meu cachorro?"
{"reply": "O banho fica R$ XX (a depender do porte). Você quer agendar pra qual dia?", "action": null}

[3] Cliente quer agendar, ainda nao confirmou:
Cliente: "queria marcar banho amanha às 10h"
{"reply": "Show! Banho amanhã às 10h. Posso confirmar?", "action": null}

[4] Cliente confirma → criar agendamento:
Cliente: "pode confirmar"
{"reply": "Pronto! Banho confirmado pra amanhã às 10h. Vou estar te esperando! 🐾", "action": {"type": "create_appointment", "serviceId": "<UUID_DA_LISTA>", "petId": "<UUID_DO_PET>", "date": "${tomorrowIso}", "time": "10:00"}}

[5] Cliente quer remarcar:
Cliente: "preciso passar o agendamento de amanha pra sexta as 15h"
${canUpdateAppointment ? `{"reply": "Tranquilo! Posso remarcar pra sexta às 15h. Confirma?", "action": null}
(depois que cliente confirmar:)
{"reply": "Remarcado pra sexta às 15h. Te espero!", "action": {"type": "reschedule_appointment", "appointmentId": "<UUID_DO_AGENDAMENTO>", "newDate": "<YYYY-MM-DD>", "newTime": "15:00"}}` : `{"reply": "Vou pedir pra atendente confirmar a remarcacao. Pode aguardar?", "action": null}`}

[6] Cliente quer cancelar:
Cliente: "preciso cancelar o banho de amanha"
${canCancelAppointment ? `{"reply": "Sem problema! Posso cancelar o banho de amanhã. Confirma?", "action": null}
(apos cliente confirmar:)
{"reply": "Cancelado. Quando precisar, eh so chamar! 🐾", "action": {"type": "cancel_appointment", "appointmentId": "<UUID>", "reason": "cliente solicitou"}}` : `{"reply": "Vou pedir pra atendente cancelar pra voce. Tudo bem?", "action": null}`}

[7] Cliente novo (sem cadastro) quer agendar:
Cliente: "oi, quero marcar banho do meu Bili pra sabado as 9h"
{"reply": "Oi! Show, banho do Bili sábado às 9h. Posso confirmar?", "action": null}
Apos confirmar:
{"reply": "Confirmado! Sábado 9h. Vou estar te esperando 🐾", "action": {"type": "create_appointment", "serviceId": "<UUID>", "petName": "Bili", "date": "<YYYY-MM-DD>", "time": "09:00"}}

[8] Cliente pede catalogo de servicos:
Cliente: "quais servicos vcs tem?"
{"reply": "A gente tem banho, tosa higienica, tosa completa, hidratacao, corte de unha. Tem algum especifico que voce quer?", "action": null}

[9] Cliente NAO especificou servico:
Cliente: "quero marcar pra amanha as 14h"
{"reply": "Show! Pra qual servico? (banho, tosa, hidratacao...)", "action": null}

═══════════════════════════════════════════════════════════════
LEMBRA: SEMPRE JSON. SEMPRE pegue serviceId/appointmentId/petId DA LISTA.
NUNCA invente UUIDs. Se nao tiver na lista, faca pergunta antes.

Responda agora a proxima mensagem.`;
}

async function buildHistoryMessages(conversationId, limit = 30) {
  if (!conversationId) return [];
  try {
    const rows = await CrmConversationMessage.findAll({
      where: { conversationId },
      order: [["createdAt", "DESC"]],
      limit,
      attributes: ["body", "direction", "createdAt"],
    });
    // Inverte para ordem cronologica e mapeia para roles do chat
    return rows
      .reverse()
      .filter((m) => String(m.body || "").trim().length > 0)
      .map((m) => ({
        role: m.direction === "outbound" ? "assistant" : "user",
        content: String(m.body || "").slice(0, 800), // mais contexto por mensagem
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
  upcomingAppointments = [],
  conversation,
  body,
}) {
  const systemPrompt = buildSystemPrompt({
    settings,
    aiControl,
    services,
    products,
    customer,
    pet,
    pets,
    upcomingAppointments,
  });
  const history = await buildHistoryMessages(conversation?.id, 30);
  const lastUserMessage = history[history.length - 1];
  if (!lastUserMessage || lastUserMessage.role !== "user" || lastUserMessage.content !== body) {
    history.push({ role: "user", content: String(body || "").slice(0, 500) });
  }
  const messages = [{ role: "system", content: systemPrompt }, ...history];

  const result = await groqChat({
    apiKey,
    messages,
    temperature: 0.4, // levemente mais conservadora — modelo 70B aguenta
    maxTokens: 600,
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

    // ─── VALIDACOES DE SCHEDULING (regras do painel) ────────────────────
    const sched = aiControl?.scheduling || {};

    // 1) Validar dia da semana permitido
    const allowedDays = Array.isArray(sched.allowedDays) ? sched.allowedDays : null;
    if (allowedDays && allowedDays.length > 0) {
      const dayOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
        new Date(`${date}T12:00:00`).getDay()
      ];
      if (!allowedDays.includes(dayOfWeek)) {
        const dayPt = { sunday: "domingo", monday: "segunda", tuesday: "terca", wednesday: "quarta", thursday: "quinta", friday: "sexta", saturday: "sabado" }[dayOfWeek];
        console.log(`[CrmAutoReply] Agendamento recusado: dia ${dayPt} nao permitido. Permitidos: ${allowedDays.join(",")}`);
        return {
          executed: false,
          reason: "day_not_allowed",
          message: `Nao agendamos em ${dayPt}. Dias disponiveis: ${allowedDays.map((d) => ({ sunday: "dom", monday: "seg", tuesday: "ter", wednesday: "qua", thursday: "qui", friday: "sex", saturday: "sab" }[d] || d)).join(", ")}.`,
        };
      }
    }

    // 2) Validar tempo minimo de antecedencia
    const minLead = Number(sched.minimumLeadMinutes || 0);
    if (minLead > 0) {
      const requestedAt = new Date(`${date}T${time.slice(0, 5)}:00`);
      const now = new Date();
      const diffMin = (requestedAt - now) / 60000;
      if (diffMin < minLead) {
        console.log(`[CrmAutoReply] Agendamento recusado: ${diffMin.toFixed(0)}min antes (minimo ${minLead}min)`);
        return {
          executed: false,
          reason: "lead_time_too_short",
          message: `Preciso de pelo menos ${minLead} minutos de antecedencia. Quer escolher outro horario?`,
        };
      }
    }

    // 3) Validar horario dentro da janela permitida
    const allowedStart = String(sched.allowedTimeStart || "").trim();
    const allowedEnd = String(sched.allowedTimeEnd || "").trim();
    if (allowedStart && allowedEnd) {
      const reqTime = time.slice(0, 5);
      if (reqTime < allowedStart || reqTime > allowedEnd) {
        console.log(`[CrmAutoReply] Agendamento recusado: ${reqTime} fora da janela ${allowedStart}-${allowedEnd}`);
        return {
          executed: false,
          reason: "time_out_of_window",
          message: `Atendemos das ${allowedStart} as ${allowedEnd}. Quer escolher um horario nessa faixa?`,
        };
      }
    }

    // 4) Validar maximo de agendamentos por dia
    const maxDaily = Number(sched.maxDailyAppointments || 0);
    if (maxDaily > 0) {
      try {
        const { default: Appointment } = await import("../models/Appointment.js");
        const dayCount = await Appointment.count({
          where: {
            usersId,
            date,
            status: { [Op.notIn]: ["Cancelado", "cancelado"] },
          },
        });
        if (dayCount >= maxDaily) {
          console.log(`[CrmAutoReply] Agendamento recusado: dia cheio (${dayCount}/${maxDaily})`);
          return {
            executed: false,
            reason: "day_at_capacity",
            message: `Esse dia ja esta cheio (${dayCount} agendamentos). Posso ver outro dia pra voce?`,
          };
        }
      } catch (_) {
        // Se falhar a query, deixa criar
      }
    }

    // 5) Validar categoria de servico permitida
    const allowedCategories = Array.isArray(sched.allowedServiceCategories) ? sched.allowedServiceCategories : null;
    if (allowedCategories && allowedCategories.length > 0) {
      try {
        const { default: ServicesModel } = await import("../models/Services.js");
        const svc = await ServicesModel.findOne({
          where: { id: serviceId, establishment: usersId },
          attributes: ["id", "name", "category"],
        });
        if (svc) {
          const cat = String(svc.category || "").toLowerCase();
          const allowedLower = allowedCategories.map((c) => String(c).toLowerCase());
          if (cat && !allowedLower.some((a) => cat.includes(a) || a.includes(cat))) {
            console.log(`[CrmAutoReply] Agendamento recusado: categoria "${svc.category}" nao permitida`);
            return {
              executed: false,
              reason: "category_not_allowed",
              message: `Esse servico nao esta na minha lista. Vou pedir pra atendente humana entrar em contato.`,
            };
          }
        }
      } catch (_) {
        // Se falhar a query, deixa criar
      }
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

  if (action.type === "reschedule_appointment") {
    if (!aiControl?.capabilities?.updateAppointment) {
      return { executed: false, reason: "capability_disabled" };
    }
    const appointmentId = String(action.appointmentId || "").trim();
    const newDate = String(action.newDate || "").trim();
    const newTime = String(action.newTime || "").trim();
    if (!appointmentId) return { executed: false, reason: "no_appointment_id" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { executed: false, reason: "invalid_date", details: newDate };
    if (!/^\d{2}:\d{2}/.test(newTime)) return { executed: false, reason: "invalid_time", details: newTime };

    // Aplica mesmas validacoes de scheduling do create_appointment
    const sched = aiControl?.scheduling || {};
    const allowedDays = Array.isArray(sched.allowedDays) ? sched.allowedDays : null;
    if (allowedDays && allowedDays.length > 0) {
      const dayOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
        new Date(`${newDate}T12:00:00`).getDay()
      ];
      if (!allowedDays.includes(dayOfWeek)) {
        const dayPt = { sunday: "domingo", monday: "segunda", tuesday: "terca", wednesday: "quarta", thursday: "quinta", friday: "sexta", saturday: "sabado" }[dayOfWeek];
        return {
          executed: false,
          reason: "day_not_allowed",
          message: `Nao atendemos em ${dayPt}. Quer escolher outro dia?`,
        };
      }
    }
    const allowedStart = String(sched.allowedTimeStart || "").trim();
    const allowedEnd = String(sched.allowedTimeEnd || "").trim();
    if (allowedStart && allowedEnd) {
      const reqTime = newTime.slice(0, 5);
      if (reqTime < allowedStart || reqTime > allowedEnd) {
        return {
          executed: false,
          reason: "time_out_of_window",
          message: `Atendemos das ${allowedStart} as ${allowedEnd}. Escolhe um horario nessa faixa?`,
        };
      }
    }

    try {
      const { default: Appointment } = await import("../models/Appointment.js");
      const found = await Appointment.findOne({ where: { id: appointmentId, usersId } });
      if (!found) {
        return {
          executed: false,
          reason: "appointment_not_found",
          message: "Nao achei esse agendamento. Pode confirmar a data e o pet?",
        };
      }
      // Seguranca: so deixa remarcar agendamentos do customer atual
      if (customer?.id && String(found.customerId) !== String(customer.id)) {
        return {
          executed: false,
          reason: "appointment_belongs_to_other_customer",
          message: "Esse agendamento nao consta vinculado a voce. Vou pedir pra atendente humana verificar.",
        };
      }
      await found.update({
        date: newDate,
        time: newTime.slice(0, 5) + ":00",
        observation: `${found.observation || ""}\n[IA remarcou via WhatsApp]`.trim(),
      });
      console.log(`[CrmAutoReply] Appointment ${appointmentId} remarcado: ${newDate} ${newTime}`);
      return { executed: true, action: "rescheduled", appointmentId, newDate, newTime };
    } catch (err) {
      console.error("[CrmAutoReply] Erro remarcando:", err.message);
      return { executed: false, reason: "db_error", error: err.message };
    }
  }

  if (action.type === "cancel_appointment") {
    if (!aiControl?.capabilities?.cancelAppointment) {
      return { executed: false, reason: "capability_disabled" };
    }
    const appointmentId = String(action.appointmentId || "").trim();
    if (!appointmentId) return { executed: false, reason: "no_appointment_id" };

    try {
      const { default: Appointment } = await import("../models/Appointment.js");
      const found = await Appointment.findOne({ where: { id: appointmentId, usersId } });
      if (!found) {
        return {
          executed: false,
          reason: "appointment_not_found",
          message: "Nao achei esse agendamento pra cancelar. Pode confirmar a data e o pet?",
        };
      }
      if (customer?.id && String(found.customerId) !== String(customer.id)) {
        return {
          executed: false,
          reason: "appointment_belongs_to_other_customer",
          message: "Esse agendamento nao consta vinculado a voce. Vou pedir pra atendente humana verificar.",
        };
      }
      const reason = String(action.reason || "Cliente cancelou via WhatsApp").slice(0, 200);
      await found.update({
        status: "Cancelado",
        observation: `${found.observation || ""}\n[IA cancelou: ${reason}]`.trim(),
      });
      console.log(`[CrmAutoReply] Appointment ${appointmentId} cancelado: ${reason}`);
      return { executed: true, action: "cancelled", appointmentId, reason };
    } catch (err) {
      console.error("[CrmAutoReply] Erro cancelando:", err.message);
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
  // 4) Tambem carrega agendamentos futuros do cliente (para remarcar/cancelar)
  const todayStartIso = new Date().toISOString().slice(0, 10);
  const [allServices, allProducts, upcomingAppointments] = await Promise.all([
    Services.findAll({ where: { establishment: usersId }, order: [["name", "ASC"]], limit: 200 }).catch(() => []),
    Products.findAll({ where: { usersId }, order: [["name", "ASC"]], limit: 200 }).catch(() => []),
    customer?.id
      ? import("../models/Appointment.js").then(async ({ default: Appointment }) =>
          Appointment.findAll({
            where: {
              usersId,
              customerId: customer.id,
              date: { [Op.gte]: todayStartIso },
              status: { [Op.notIn]: ["Cancelado", "cancelado", "Concluido", "concluido"] },
            },
            order: [["date", "ASC"], ["time", "ASC"]],
            limit: 5,
          }).catch(() => []),
        ).catch(() => [])
      : Promise.resolve([]),
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
        upcomingAppointments,
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
        // Se a acao foi executada, mantem o reply (a IA ja confirmou no texto)
        if (executedAction.executed) {
          // Sucesso — nao adiciona nada, a IA ja respondeu confirmando
        } else if (executedAction.message) {
          // Validacao falhou com motivo amigavel — SOBRESCREVE o reply
          // (a IA pode ter dito "Pronto, agendado!" mas o servidor recusou)
          reply = executedAction.message;
          console.log(`[CrmAutoReply] Reply sobrescrito por validacao: ${executedAction.reason}`);
        } else if (executedAction.reason === "capability_disabled") {
          reply = reply + ` (⚠ Voce ainda precisa habilitar essa acao no controle da IA.)`;
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
