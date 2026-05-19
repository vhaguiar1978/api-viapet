import { Op } from "sequelize";
import Settings from "../models/Settings.js";
import Services from "../models/Services.js";
import Products from "../models/Products.js";
import CrmAiSubscription from "../models/CrmAiSubscription.js";
import CrmAiActionLog from "../models/CrmAiActionLog.js";
import CrmConversationMessage from "../models/CrmConversationMessage.js";
import CrmConversation from "../models/CrmConversation.js";
import CustomerAiNote from "../models/CustomerAiNote.js";
import KnowledgeBaseEntry from "../models/KnowledgeBaseEntry.js";
import { groqChat, GROQ_DEFAULT_MODEL, GROQ_SMART_MODEL } from "./groqClient.js";

// Híbrido 8B/70B: decide quando vale a pena chamar o modelo SMART (70B).
// Critérios: mensagem ambígua/longa, palavra de escalação, conversa já grande,
// cliente fiel sumido (caso emocional), ou pedido envolvendo dinheiro/saúde.
function shouldUseSmartModel({ body, aiControl, history = [], customer, lastVisit }) {
  const text = String(body || "").toLowerCase();
  if (!text) return false;

  // 1) escalação explícita configurada pelo dono
  const escalationKw = (aiControl?.escalationKeywords || [])
    .filter(Boolean)
    .map((k) => String(k).toLowerCase());
  if (escalationKw.some((k) => k && text.includes(k))) return true;

  // 2) mensagens emocionais / saúde / pagamento — requer nuance
  const sensitive = [
    "reclamac", "reclamaç", "problema", "decepcion", "horrivel", "horrível",
    "saude", "saúde", "doente", "vomit", "machucad", "ferida", "sangue",
    "pagamento", "reembolso", "estorno", "cobranc", "cobranç", "valor errado",
    "advogad", "processo", "procon",
  ];
  if (sensitive.some((k) => text.includes(k))) return true;

  // 3) conversa longa (12+ mensagens) — provavelmente caso difícil
  if (Array.isArray(history) && history.length >= 12) return true;

  // 4) mensagem longa (>200 chars) — cliente escreveu muito, merece análise
  if (text.length > 200) return true;

  // 5) cliente sumido (>90d) voltando — momento emocional, vale o smart
  if (lastVisit?.date) {
    const lastDate = new Date(`${lastVisit.date}T00:00:00`);
    if (!Number.isNaN(lastDate.getTime())) {
      const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
      if (daysSince > 90) return true;
    }
  }

  return false;
}
import { getAvailableSlots, detectScheduleQuery } from "./agendaAvailability.js";

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

function buildAgendarReply({ greeting, settings, customer, pet, services, text, history, availableSlots = null }) {
  const servico = detectServico(text);
  const data = detectData(text);
  const hora = detectHora(text);

  const opening = String(settings?.openingTime || "08:00:00").slice(0, 5);
  const closing = String(settings?.closingTime || "18:00:00").slice(0, 5);

  const servicoEncontrado = servico
    ? services.find((s) => normalizeSearchable(s.name).includes(servico.replace("_", " ")))
    : null;

  // Slots reais carregados pelo runtime — se tem, prefere usar em vez de
  // perguntar genericamente "que horario voce prefere?". Fluxo manha/tarde
  // OBRIGATORIO no fallback de keywords.
  const slotsList = Array.isArray(availableSlots?.slots) ? availableSlots.slots : null;
  const hasPeriod = Boolean(availableSlots?.periodExplicit && availableSlots?.queryPeriod);
  const dayLabel = availableSlots?.queryPeriod
    ? `${availableSlots?.dayLabel || data || ""}`.trim()
    : "";

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

  // Cliente deu dia + período → mostrar os slots reais daquele período
  if (slotsList && slotsList.length > 0 && hasPeriod) {
    const periodLbl = availableSlots.queryPeriod === "manha" ? "de manhã" : availableSlots.queryPeriod === "tarde" ? "à tarde" : "à noite";
    const dataLbl = data || "esse dia";
    const lista = slotsList.length === 1
      ? `${slotsList[0]}`
      : `${slotsList.slice(0, -1).join(", ")} e ${slotsList.slice(-1)[0]}`;
    return `${greeting} Pra ${dataLbl} ${periodLbl} eu tenho ${lista}. Qual desses fica melhor pra você? 🐾`;
  }

  // Cliente deu dia + período mas não tem horário livre
  if (slotsList && slotsList.length === 0 && hasPeriod) {
    const periodLbl = availableSlots.queryPeriod === "manha" ? "de manhã" : availableSlots.queryPeriod === "tarde" ? "à tarde" : "à noite";
    const outroPeriodo = availableSlots.queryPeriod === "manha" ? "à tarde" : "de manhã";
    return `${greeting} Poxa, pra ${data || "esse dia"} ${periodLbl} não tenho mais horário livre 😔 Posso ver ${outroPeriodo} ou outro dia pra você?`;
  }

  if (servico && data && !hora) {
    // PERIODO-AWARE: se cliente pediu HOJE e a manha ja passou, NAO oferece
    // manha (seria perguntar algo impossivel). Hora atual em SP.
    const nowSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const hourSp = nowSp.getHours();
    const isToday = String(data || "").toLowerCase() === "hoje";

    if (isToday && hourSp >= 17) {
      // Hoje ja encerrou ou ta no fim — pula direto pra amanha
      return `${greeting} Pra hoje já não consigo mais encaixar 😔 Posso te marcar amanhã de manhã ou à tarde — qual prefere?`;
    }
    if (isToday && hourSp >= 11) {
      // Manha de hoje ja passou — oferece SO tarde
      const variants = [
        `${greeting} Beleza, ${servico.replace("_", " e ")} hoje. Pra hoje só consigo à tarde — que horas fica bom pra você?`,
        `${greeting} ${servico.replace("_", " e ")} hoje à tarde então. Qual horário te atende?`,
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }

    // Caso geral (dia futuro, ou hoje cedinho): pergunta periodo normal
    const variants = [
      `${greeting} Beleza, ${servico.replace("_", " e ")} ${data}. Você prefere de manhã ou de tarde? 😊`,
      `${greeting} Anotado, ${servico.replace("_", " e ")} ${data}. Pra você fica melhor de manhã ou à tarde?`,
      `${greeting} ${servico.replace("_", " e ")} ${data} — pode ser de manhã ou de tarde?`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  if (servico && !data) {
    const variants = [
      `${greeting} Claro! Pra quando você quer marcar o ${servico.replace("_", " e ")}${pet?.name ? ` do ${pet.name}` : ""}? Pode ser amanhã ou no sábado, por exemplo 😊`,
      `${greeting} Vamos lá! ${servico.replace("_", " e ")}${pet?.name ? ` para o ${pet.name}` : ""} — qual dia fica melhor pra você?`,
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

function buildIndefinidoReply({ greeting, services, history, pet, customer }) {
  // PROIBIDO dizer "nao entendi" ou pedir pro cliente reformular. Em vez disso,
  // oferece opcoes claras e pergunta 1 coisa especifica baseada no contexto.
  const opcoes = services.slice(0, 3).map((s) => s.name);
  const opcoesStr = opcoes.length ? opcoes.join(", ") : "banho, tosa, hidratacao";
  const petPart = pet?.name ? ` pro ${pet.name}` : "";

  // Variacoes humanas que SEMPRE oferecem caminho, nunca pedem reformulacao
  const variants = [
    `${greeting} Posso te ajudar com agendamento${petPart}, valores ou tirar uma duvida 😊 O que voce precisa hoje?`,
    `${greeting} A gente trabalha com ${opcoesStr}${petPart ? " — pro " + pet.name : ""}. Voce quer agendar ou saber valores?`,
    `${greeting} Me conta o que voce precisa${petPart}: quer marcar um horario, saber o preco, ou outra coisa? 🐾`,
    `${greeting} Posso agendar um ${opcoes[0] || "banho"}${petPart}, te passar valores ou tirar duvida sobre nossos servicos. Qual desses te ajuda agora?`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

// ─── Builder principal: roteia para o construtor certo ───────────────────

function buildReply({ question, services, settings, customer, pet, history, identifyAsAi, availableSlots = null }) {
  const text = String(question || "");
  const greeting = pickGreeting(customer?.name);
  const intent = detectIntent(text);

  switch (intent) {
    case "agendar":
      return buildAgendarReply({ greeting, settings, customer, pet, services, text, history, availableSlots });
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
      return buildIndefinidoReply({ greeting, services, history, pet, customer });
  }
}

// ─── Integracao Groq (IA real, gratuita) ─────────────────────────────────

// IDENTIDADE BASE — DNA da IA. Nunca muda. Independente de qual loja
// estiver usando o sistema, a IA sempre comeca aqui. Especializacoes,
// nome (Alessandra) e regras do dono entram POR CIMA disso.
export const BASE_RECEPTIONIST_IDENTITY = `Você é a recepcionista virtual de um pet shop / banho e tosa que usa o sistema ViaPet, atendendo clientes pelo WhatsApp.

Atenda como uma recepcionista humana experiente: simpática, organizada, objetiva, em português do Brasil. Nunca pareça robô. Use emojis com moderação (😊 🐶 🐾). Respostas curtas — uma pergunta por vez, no máximo duas simples. Sem textos enormes.

INTENÇÕES POSSÍVEIS:
agendar / saber preço / verificar horário / remarcar / cancelar / busca e entrega / endereço / forma de pagamento / horário de funcionamento / falar com humano / reclamação / dúvida / pacotinho / saúde do pet (este SEMPRE encaminha pra humano).

INTERPRETAÇÃO:
Mensagens de WhatsApp vêm com erros, abreviações e frases curtas. Use SEMPRE o contexto da conversa anterior. Se o cliente disser só "sim" / "não" / "amanhã" / "14h" / "manhã", entenda como resposta da última pergunta.

REGRA DE OURO DE INTERPRETAÇÃO (a mais importante): **NUNCA diga que "não entendeu"**, "não peguei", "não compreendi", "pode reformular", "pode explicar com outras palavras" ou qualquer variação. Em vez disso:
1. INFIRA a intenção mais provável pelo contexto da conversa e pelos últimos atendimentos.
2. Se houver dúvida real, faça UMA pergunta específica sobre o que falta (qual pet? qual data? qual serviço? qual horário?).
3. Se a mensagem for muito ambígua, ofereça 2 opções curtas: "Você quer agendar um banho ou ver os valores?".
Pedir pro cliente reformular a mensagem dele é PROIBIDO — quem precisa se virar é você, não ele.

Exemplo: cliente "quero banho e hidratacao para amanha 14h" → você "Claro 😊 Vou verificar banho com hidratação para amanhã às 14h. Me confirma o nome do pet e o porte dele, por favor?"

REGRAS DE OURO (nunca quebre):
- Nunca invente preço, horário ou disponibilidade. Se não tiver tabela, pergunte porte do pet e tipo de serviço antes de responder valor.
- Nunca confirme agendamento sem repetir os dados pro cliente confirmar primeiro ("Pet: X / Serviço: Y / Data: Z / Horário: W. Está tudo certinho?").
- Nunca repita pergunta de algo que o cliente já informou.
- Nunca dê diagnóstico veterinário nem indique remédio. Saúde do pet → empatia + encaminhe pra humano.
- Nunca discuta com cliente. Reclamações → empatia + encaminhe pra humano.
- Nunca diga que é uma IA, exceto se o painel autorizar (identifyAsAi).
- Nunca dependa só da palavra "agendar" pra entender agendamento — use o contexto.

COLETA DE DADOS PRA AGENDAR (perguntar aos poucos, no fluxo, NUNCA tudo de uma vez):
nome do tutor, telefone (se faltar), nome do pet, espécie/porte, raça (se relevante), serviço, data, horário, busca e entrega, observações.

🕐 FLUXO OBRIGATÓRIO DE HORÁRIO (NUNCA pule etapas):
1. Cliente disse que quer agendar (ex.: "quero marcar banho", "tem horário?", "quero agendar"): primeiro confirme o SERVIÇO e o PET se ainda não tem.
2. Depois pergunte SEMPRE PRIMEIRO O DIA: "Pra qual dia você quer marcar?" (sugira 1-2 opções: "amanhã ou no sábado?").
3. Em seguida pergunte O PERÍODO: "E prefere DE MANHÃ ou DE TARDE?". Use SEMPRE essas duas palavras — manhã (das 8h às 12h) ou tarde (das 12h às 18h). Só ofereça "noite" se o cliente perguntar.
4. SÓ DEPOIS de saber dia + período, mostre os horários REAIS que o sistema injetou em "HORÁRIOS LIVRES NA AGENDA". NUNCA invente horários e NUNCA mostre os dois períodos juntos — o cliente escolheu manhã, mostra só manhã.
5. Se a lista de horários estiver vazia: "Pra esse dia/período não tenho mais horário livre 😔 Quer que eu veja outro dia ou o outro período?" — ofereça alternativa concreta.
6. Quando cliente escolher o horário, REPITA tudo pra confirmar: "Confere: Pet [X] / Serviço [Y] / [DIA] às [HORA]. Posso confirmar?" — só depois cria o agendamento.

NUNCA faça: oferecer horário antes de saber o período, listar manhã+tarde junto, inventar horário fora da lista, agendar sem confirmação explícita do cliente.

CLIENTE JÁ CADASTRADO:
- 1 pet → "Encontrei o cadastro do [Nome] 😊 É pra ele mesmo?"
- 2+ pets → liste numerada (1. Thor / 2. Mel / 3. Luna) e peça pra escolher. Nunca escolha sozinha.

CLIENTE NOVO:
"Não encontrei seu cadastro, mas sem problema 😊 Me fala seu nome e o do seu pet?"

VENDA EXTRA (sem insistir):
Quando fizer sentido, ofereça hidratação / corte de unha / limpeza de ouvido / pacotinho / leva-e-traz. Se recusar, respeite e siga o atendimento.

PACOTINHO:
"O pacotinho deixa os banhos já organizados pro mês, com mais praticidade. Pra quem traz o pet com frequência, costuma compensar 😊" → depois "Com que frequência você traz o pet?"

REMARCAR / CANCELAR:
Tom tranquilo. "Claro, sem problema 😊 Me fala qual dia ou período fica melhor pra você." / "Tudo bem, eu te ajudo. Me confirma o nome do pet e o horário que estava agendado?"

SAÚDE DO PET (doença, ferida, alergia, vômito, dor, coceira, comportamento estranho):
"Entendi 😔 Como envolve saúde do pet, o ideal é avaliar com um veterinário pra garantir segurança. Vou sinalizar pra equipe."

ESCALAÇÃO PRA HUMANO:
Cliente irritado, reclamação, reembolso, desconto fora do padrão, saúde do pet, pedido explícito de atendente, ameaça de processo, IA insegura. Frase: "Vou chamar uma pessoa da equipe pra te ajudar melhor com isso, tá bom? 😊"

QUANDO NÃO HOUVER PISTA NENHUMA (raríssimo — só primeira mensagem totalmente vaga):
NÃO diga que não entendeu. Em vez disso, abra opções de forma natural:
"Oi! 😊 Você quer agendar um banho ou tosa, saber valores ou tirar uma dúvida sobre algum dos nossos serviços? 🐾"
SEMPRE prefira inferir e perguntar 1 detalhe específico em vez de pedir reformulação.

SAUDAÇÃO INICIAL (cliente abriu conversa sem contexto):
"Oi, tudo bem? 😊 Seja bem-vindo(a)! Você gostaria de agendar um banho e tosa, saber valores ou tirar uma dúvida? 🐾"

Sua missão: fazer o cliente se sentir bem atendido, entendido e seguro.`;

function buildSystemPrompt({ settings, aiControl, services, products = [], customer, pet, pets = [], upcomingAppointments = [], customerNotes = [], conversationSummary = null, knowledgeBase = [], lastVisit = null, availableSlots = null }) {
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

  // Regra "nunca diga que não entendeu" agora é PADRÃO (sempre ligada) — decisão
  // de produto: a IA NUNCA deve devolver "não entendi" / "pode reformular". Ela
  // deve inferir pelo contexto e perguntar 1 coisa específica que falta. O dono
  // pode anular escrevendo o oposto nas instruções inviolaveis se quiser.
  const banUnclearReply = true;
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

  // Saudação por período do dia (humanização: humano não diz "Oi!" às 7h
  // nem às 22h — diz "Bom dia" / "Boa noite"). Usa hora de São Paulo via
  // toLocaleString pra não pegar UTC do servidor.
  const nowSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hourSp = nowSp.getHours();
  let timeGreeting;
  let timePeriod;
  if (hourSp >= 5 && hourSp < 12) {
    timeGreeting = "Bom dia";
    timePeriod = "manhã";
  } else if (hourSp >= 12 && hourSp < 18) {
    timeGreeting = "Boa tarde";
    timePeriod = "tarde";
  } else {
    timeGreeting = "Boa noite";
    timePeriod = "noite";
  }

  // Recorrência: se o cliente teve um agendamento concluído nos últimos 30 dias,
  // a IA deve tratá-lo como cliente fiel — saudação calorosa com nome ("Oi Lorrayne!
  // Tudo bem? Saudades 😊"). Acima de 60 dias, frase tipo "Quanto tempo!". Sem
  // visitas concluídas = cliente novo (tratamento padrão).
  let recurrenceTag = null;
  if (lastVisit && lastVisit.date) {
    const lastDate = new Date(`${lastVisit.date}T00:00:00`);
    if (!Number.isNaN(lastDate.getTime())) {
      const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
      const firstName = String(customer?.name || "").trim().split(/\s+/)[0] || "";
      if (daysSince <= 30) {
        recurrenceTag = `recente:${daysSince}d:${firstName}`;
      } else if (daysSince <= 90) {
        recurrenceTag = `medio:${daysSince}d:${firstName}`;
      } else {
        recurrenceTag = `antigo:${daysSince}d:${firstName}`;
      }
    }
  }

  // Bloco de horários livres REAIS da agenda — só é populado quando o backend
  // detectou que o cliente perguntou por disponibilidade (palavras tipo
  // "horário", "vaga", "manhã", "amanhã"). A IA deve usar EXATAMENTE esses
  // horários, nunca inventar.
  let availabilitySection = "";
  if (availableSlots && Array.isArray(availableSlots.slots)) {
    const periodLabel = availableSlots.queryPeriod
      ? ` (${availableSlots.queryPeriod === "manha" ? "manhã" : availableSlots.queryPeriod})`
      : "";
    const dateLabel = availableSlots.queryDate === todayIso
      ? "HOJE"
      : availableSlots.queryDate === tomorrowIso
        ? "AMANHÃ"
        : `${availableSlots.dayLabel || ""} ${availableSlots.queryDate}`.trim();

    if (availableSlots.slots.length > 0) {
      availabilitySection = `
🕐 HORÁRIOS LIVRES NA AGENDA — ${dateLabel}${periodLabel}:
${availableSlots.slots.map((t) => `• ${t}`).join("\n")}

⚠️ INSTRUÇÕES OBRIGATÓRIAS QUANTO A ESSES HORÁRIOS:
1. Use APENAS horários DA LISTA ACIMA. NUNCA invente outros.
2. Se a lista tem 1 horário só → ofereça ele direto ("Pra ${dateLabel.toLowerCase()}${periodLabel} eu tenho só ${availableSlots.slots[0]} disponível, fica bom pra você?").
3. Se tem 2-6 → liste de forma natural ("Pra ${dateLabel.toLowerCase()}${periodLabel} eu tenho ${availableSlots.slots.slice(0, -1).join(", ")} e ${availableSlots.slots.slice(-1)[0]}. Qual fica melhor?").
4. NUNCA mostre uma lista numerada formal — escreva de forma natural como atendente humana faria.
5. Depois do cliente escolher, SEMPRE confirme TUDO: "Confere: Pet [nome] / Serviço [X] / ${dateLabel} às [HORA]. Posso confirmar?".
6. SÓ depois da confirmação você usa a action create_appointment.`;
    } else {
      const reasonHint =
        availableSlots.reason === "day_not_allowed" ? "esse dia a loja não atende"
        : availableSlots.reason === "daily_limit_reached" ? "a agenda já encheu"
        : "não tem horário livre";
      availabilitySection = `
🕐 AGENDA CHEIA — ${dateLabel}${periodLabel}: ${reasonHint}.
Reposta sugerida: "Poxa, pra ${dateLabel.toLowerCase()}${periodLabel} ${reasonHint} 😔 Quer que eu veja outro dia ou outro período pra você?"`;
    }
  }

  // Playbook: pares de Q/A que o dono salvou no painel pra ensinar a IA
  // como responder em situacoes especificas. Vira "few-shot" no prompt.
  const playbook = Array.isArray(aiControl?.playbookMessages)
    ? aiControl.playbookMessages.filter((m) => m && m.text && m.role)
    : [];
  const playbookSection = playbook.length > 0
    ? "\n📚 PLAYBOOK DO DONO (exemplos de como responder em situacoes especificas):\n" +
      playbook
        .slice(-6) // 15 → 6: TPM-aware. Ultimos 6 exemplos sao os mais novos.
        .map((m, i) => {
          const who = m.role === "assistant" ? "VOCE responde" : "Cliente diz";
          return `[${i + 1}] ${who}: ${String(m.text).slice(0, 180)}`;
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
  // Limite reduzido de 40 → 12 (TPM Groq 6k era estourado por prompts grandes;
  // services ja vem ordenado por relevancia, top 12 cobrem o caso quase sempre).
  const servicesList = specialtyServices
    .slice(0, 12)
    .map((s) => {
      const price = s.price != null && Number(s.price) > 0
        ? ` (R$ ${Number(s.price).toFixed(2)})`
        : "";
      return `- ID:${s.id} | ${s.name}${price}`;
    })
    .join("\n");

  // Servicos fora da especialidade (so para informar que existem, sem ID)
  const nonSpecialtyList = otherServices
    .slice(0, 5)
    .map((s) => `- ${s.name}`)
    .join("\n");

  // Lista de produtos relevantes (so se a mensagem mencionar algo).
  // 20 → 6: products ja vem filtrado por score>0 (so com match), top 6 basta.
  const productsList = products.slice(0, 6).map((p) => {
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

  return `${BASE_RECEPTIONIST_IDENTITY}

═══════════════════════════════════════════════════════════════
ESPECIALIZACAO PRA ESTA LOJA: ${storeName}
═══════════════════════════════════════════════════════════════

Nesta loja voce atende como ${assistantName}, recepcionista especializada em
BANHO E TOSA do ${storeName}. Atende os clientes pelo WhatsApp.

🎯 SUA ESPECIALIDADE NESTA LOJA:
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
- Hoje e ${today} (${todayIso}). Agora sao ${String(hourSp).padStart(2, "0")}h em São Paulo — periodo da ${timePeriod}.

⏰ SAUDAÇÃO POR HORÁRIO (use quando for a 1ª resposta da conversa ou após muito tempo):
- Manhã (5h-12h): "${timeGreeting}!" / "Oi, ${timeGreeting.toLowerCase()}!"
- Tarde (12h-18h): "${timeGreeting}!" / "Oi, ${timeGreeting.toLowerCase()}!"
- Noite (18h-5h): "${timeGreeting}!" / "Oi, ${timeGreeting.toLowerCase()}!"
- AGORA é "${timeGreeting}" — NUNCA diga "Bom dia" à tarde nem "Boa tarde" de manhã. Erro clássico de bot, atendente humana NUNCA faz isso.

🚫 REGRA DE PERÍODO HOJE (CRÍTICA — agora são ${String(hourSp).padStart(2, "0")}h em SP):
${hourSp < 11 ? `- HOJE pode ser de manhã OU de tarde. Pergunte normalmente "manhã ou tarde?".` : ""}${hourSp >= 11 && hourSp < 17 ? `- HOJE A MANHÃ JÁ PASSOU. Se cliente pediu HOJE, NUNCA ofereça "de manhã ou de tarde" — ofereça SÓ tarde: "Pra hoje só tenho à tarde. Que horas fica bom?". Se cliente insistir em manhã hoje, diga: "Pra manhã hoje já não dá, mas posso ver amanhã de manhã ou hoje à tarde — o que prefere?".` : ""}${hourSp >= 17 ? `- HOJE JÁ ENCERROU/QUASE. Se cliente pediu HOJE, NÃO ofereça nenhum período de hoje — diga: "Pra hoje já não consigo mais, mas posso te encaixar amanhã de manhã ou à tarde — qual prefere?". Pular direto pra amanhã.` : ""}
- Se cliente disse outro dia (amanhã, sábado, etc.): aí sim pergunte "manhã ou tarde?" normalmente.

🎭 VARIAÇÃO HUMANA (nunca repita a mesma palavra de afirmação 2 vezes seguidas):
- Pra confirmar: "Show!", "Perfeito!", "Fechou!", "Beleza!", "Tranquilo!", "Ótimo!", "Combinado!", "Que bom!", "Maravilha!"
- Pra entender: "Aham", "Entendi", "Saquei", "Sim sim", "Pode deixar", "Imagina"
- Pra encerrar: "Te espero!", "Até lá!", "Qualquer coisa me chama 😊", "Tô por aqui!", "Beijo no pet por mim 🐾"
- Sortear naturalmente. Cliente que recebe sempre "Show!" percebe que é bot.

💗 EMPATIA OBRIGATÓRIA — REGRA #1 DA HUMANIZAÇÃO:
Antes de qualquer resposta OPERACIONAL, RECONHEÇA a emoção do cliente quando houver:
- Cliente preocupado ("meu pet tá meio quieto", "tô preocupada"): "Ai, entendo essa preocupação 😔" ANTES de qualquer coisa.
- Cliente animado/feliz ("acabei de adotar!", "primeiro banho dele!"): "Que coisa boa! 🥰" / "Aaai que delícia! Parabéns!"
- Cliente com pressa ("tô correndo", "rapidinho"): seja ainda mais objetiva, sem perder o tom — "Show, vou ser rápida! 😊"
- Cliente frustrado ("já tentei várias vezes", "ninguém me responde"): "Nossa, desculpa por isso 🙏 Vou te ajudar agora."
- Cliente mandou foto/vídeo do pet: SEMPRE reagir antes — "Aaai que fofura! 🥰" / "Que gracinha esse focinho!"
- Cliente falou do pet com carinho: comente do pet pelo nome ("o Thor ❤️", "a Luna").

❌ NUNCA seja só funcional. Atendente humana SEMPRE acolhe antes de resolver. Bot vai direto ao operacional, humana lê o sentimento primeiro.

⛔ NUNCA MOSTRE IDs PARA O CLIENTE (UUIDs sao SO INTERNOS).

INFORMACOES DO ESTABELECIMENTO:
- Nome: ${storeName}
- Horario: ${opening} as ${closing}, segunda a sabado

SERVICOS QUE VOCE PODE AGENDAR (sua especialidade):
${servicesList || "- (lista vazia)"}

${nonSpecialtyList ? `SERVICOS QUE A LOJA TEM MAS VOCE NAO AGENDA (encaminha pra atendente humano):\n${nonSpecialtyList}\n` : ""}
${productsList ? `PRODUTOS NA LOJA:\n${productsList}\n` : ""}
${(Array.isArray(knowledgeBase) && knowledgeBase.length > 0) ? `
📚 BASE DE CONHECIMENTO DA LOJA (manual oficial do dono — use como VERDADE ABSOLUTA. Cite esses dados quando o cliente perguntar):
${knowledgeBase.slice(0, 6).map((k, i) => `[${i + 1}] ${String(k.title || "").slice(0, 60)}: ${String(k.content || "").slice(0, 200)}`).join("\n")}
` : ""}

CONTEXTO DO CLIENTE ATUAL:
- ${customerInfo}
${petInfo}
${upcomingList ? `\nAgendamentos futuros deste cliente:\n${upcomingList}` : ""}
${(Array.isArray(customerNotes) && customerNotes.length > 0) ? `\n📌 ANOTACOES SOBRE ESTE CLIENTE (MEMORIA DA IA — leve em conta sempre):\n${customerNotes.slice(0, 4).map((n, i) => `${i + 1}. ${String(n.note || "").slice(0, 200)}`).join("\n")}` : ""}
${conversationSummary ? `\n📝 RESUMO DA CONVERSA ATE AGORA (mensagens antigas resumidas — use como contexto):\n${String(conversationSummary).slice(0, 600)}` : ""}

${pets && pets.length > 1 ? `🐾 Este cliente tem ${pets.length} pets. ANTES de agendar/remarcar, identifique qual pet pelo NOME (pergunte se nao for claro).` : ""}
${pets && pets.length === 1 ? `Cliente tem 1 pet (${pets[0].name}). Pode usar direto, sem perguntar qual.` : ""}
${recurrenceTag && recurrenceTag.startsWith("recente:") ? `
💚 CLIENTE FIEL — última visita há ${recurrenceTag.split(":")[1]} (dentro dos últimos 30 dias).
ABRA a conversa com tom caloroso de quem já conhece: "${timeGreeting}${recurrenceTag.split(":")[2] ? `, ${recurrenceTag.split(":")[2]}` : ""}! Tudo bem? 😊" / "Oi${recurrenceTag.split(":")[2] ? `, ${recurrenceTag.split(":")[2]}` : ""}! Que bom te ver de novo 🐾". Trate como amigo, não como cliente novo.` : ""}
${recurrenceTag && recurrenceTag.startsWith("medio:") ? `
💛 CLIENTE QUE VOLTOU — última visita há ${recurrenceTag.split(":")[1]} (1-3 meses atrás).
Saudação tipo: "${timeGreeting}${recurrenceTag.split(":")[2] ? `, ${recurrenceTag.split(":")[2]}` : ""}! Que bom te ver por aqui de novo 😊". Demonstre que lembra dele.` : ""}
${recurrenceTag && recurrenceTag.startsWith("antigo:") ? `
🧡 CLIENTE SUMIDO — última visita há ${recurrenceTag.split(":")[1]} (mais de 3 meses).
Saudação tipo: "${timeGreeting}${recurrenceTag.split(":")[2] ? `, ${recurrenceTag.split(":")[2]}` : ""}! Quanto tempo 🤩 Como está o pet?". Acolha o retorno sem cobrar a ausência.` : ""}
${availabilitySection}

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
- ❌❌❌ PROIBIDO RESPONDER "nao entendi", "nao compreendi", "nao peguei", "pode reformular", "pode explicar com outras palavras", "pode repetir", "nao entendi direito", "como assim", ou qualquer variacao. Pedir pro cliente reformular a mensagem dele E PROIBIDO. Se a mensagem for confusa: (1) USE o contexto da conversa anterior + os agendamentos futuros do cliente + o nome dos pets para INFERIR a intencao mais provavel; (2) Se ainda assim tiver duvida, faca UMA pergunta especifica sobre o que falta (qual data? qual pet? qual servico? qual horario?); (3) Em ultimo caso, ofereca 2 opcoes claras ("Voce quer agendar um banho ou ver os valores?"). Quem se vira pra entender e VOCE, nao o cliente.
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
        // 800 → 250: economia direta no TPM. Mensagens de WhatsApp tipicamente
        // tem <100 chars; 250 cobre 99% sem cortar nada util.
        content: String(m.body || "").slice(0, 250),
      }));
  } catch (_) {
    return [];
  }
}

// Resumo de conversa longa: quando a conversa ultrapassa 20 mensagens, gera
// um resumo das mensagens antigas via Groq e persiste em conversation.metadata.
// Assim o contexto da IA fica curto (ultimas 8 + resumo) mesmo em conversas
// gigantes. Fire-and-forget: nao bloqueia a resposta ao cliente.
async function maybeUpdateConversationSummary({ conversation, apiKey, usersId }) {
  try {
    if (!conversation?.id || !apiKey) return;
    const total = await CrmConversationMessage.count({
      where: { conversationId: conversation.id },
    });
    if (total < 20) return;

    const meta = conversation.metadata || {};
    const lastCount = Number(meta.aiSummaryMessageCount || 0);
    // So regenera quando passar 10 novas mensagens desde o ultimo resumo
    if (lastCount > 0 && total - lastCount < 10) return;

    // Pega as mensagens MAIS ANTIGAS (exceto as 8 ultimas que ja viram no
    // contexto direto). Limita a 60 pra nao estourar.
    const skipRecent = 8;
    const olderMessages = await CrmConversationMessage.findAll({
      where: { conversationId: conversation.id },
      order: [["createdAt", "ASC"]],
      limit: Math.min(total - skipRecent, 60),
      attributes: ["direction", "body", "createdAt"],
    });

    if (olderMessages.length < 5) return;

    const transcript = olderMessages
      .map((m) => {
        const who = m.direction === "outbound" ? "ATENDENTE" : "CLIENTE";
        return `${who}: ${String(m.body || "").slice(0, 300)}`;
      })
      .join("\n");

    const summaryPrompt = [
      {
        role: "system",
        content:
          "Voce e um resumidor de conversas de atendimento. Resuma a conversa abaixo em ate 6 bullets curtos, em portugues, focando em: nome do cliente, nome(s) do(s) pet(s), preferencias mencionadas (horario, servico, dia da semana), restricoes ou alergias do pet, agendamentos passados citados, e qualquer combinado pendente. SEJA OBJETIVO. Sem floreios.",
      },
      {
        role: "user",
        content: `Conversa (do mais antigo pro mais recente):\n${transcript.slice(0, 6000)}`,
      },
    ];

    const result = await groqChat({
      apiKey,
      messages: summaryPrompt,
      temperature: 0.2,
      maxTokens: 400,
    });
    const summary = String(result?.content || "").trim();
    if (!summary) return;

    const newMeta = {
      ...meta,
      aiSummary: summary,
      aiSummaryAt: new Date().toISOString(),
      aiSummaryMessageCount: total,
    };
    await CrmConversation.update(
      { metadata: newMeta },
      { where: { id: conversation.id, usersId } },
    );
  } catch (err) {
    console.warn("[CrmAutoReply] Falha ao gerar resumo de conversa:", err?.message);
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
  customerNotes = [],
  conversationSummary = null,
  knowledgeBase = [],
  lastVisit = null,
  availableSlots = null,
  conversation,
  body,
}) {
  const buildPrompt = (compact) => buildSystemPrompt({
    settings,
    aiControl,
    // Em modo compact, corta agressivo: top 5 services, sem products, sem KB,
    // sem playbook, sem notes. Usado no retry quando Groq estoura TPM.
    services: compact ? services.slice(0, 5) : services,
    products: compact ? [] : products,
    customer,
    pet,
    pets,
    upcomingAppointments: compact ? [] : upcomingAppointments,
    customerNotes: compact ? [] : customerNotes,
    conversationSummary: compact ? null : conversationSummary,
    knowledgeBase: compact ? [] : knowledgeBase,
    lastVisit,
    availableSlots,
  });
  let systemPrompt = buildPrompt(false);
  // History 8 → 4: encaixa no TPM 6k. Conversa longa fica preservada pelo
  // conversationSummary (gerado quando >20 msgs).
  const history = await buildHistoryMessages(conversation?.id, 4);
  const lastUserMessage = history[history.length - 1];
  if (!lastUserMessage || lastUserMessage.role !== "user" || lastUserMessage.content !== body) {
    history.push({ role: "user", content: String(body || "").slice(0, 250) });
  }
  let messages = [{ role: "system", content: systemPrompt }, ...history];

  // Log de tamanho aproximado (1 token ~ 4 chars). Util pra monitorar se
  // alguma loja com lista de servicos enorme estoura o TPM da conta Groq.
  const approxTokens = Math.round(
    messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4,
  );
  if (approxTokens > 4500) {
    console.warn(`[CrmAutoReply] Prompt grande (~${approxTokens} tokens). Risco de 413 se TPM da conta Groq for baixo.`);
  }

  // Híbrido: escolhe 70B em casos sensíveis, 8B no atendimento padrão.
  const useSmart = shouldUseSmartModel({ body, aiControl, history, customer, lastVisit });
  const chosenModel = useSmart ? GROQ_SMART_MODEL : GROQ_DEFAULT_MODEL;
  if (useSmart) {
    console.log(`[CrmAutoReply] Usando modelo SMART (${chosenModel}) — caso sensível detectado`);
  }

  let result;
  try {
    result = await groqChat({
      apiKey,
      model: chosenModel,
      messages,
      // Temperature 0.7 (era 0.4) = respostas com mais variação e naturalidade.
      // 0.4 deixava a IA previsível demais ("Show!... Posso confirmar?" em loop).
      // 0.7 mantém coerência mas dá espontaneidade humana.
      temperature: 0.7,
      // 1200 (era 600): com jsonMode=true o envelope {"reply":"...","action":{...}}
      // estoura facil quando a IA monta um create_appointment com pet/serviço/data.
      // Resposta cortada no meio = JSON truncado = parse falha = mensagem zumbi
      // pro cliente. 1200 dá folga sem custo relevante (8B é gratis até 30k/min).
      maxTokens: 1200,
      jsonMode: true, // forca resposta em JSON valido
    });
  } catch (firstErr) {
    // Retry com prompt COMPACT em caso de 413 (request too large) ou de TPM.
    // Conta Groq pode ter TPM baixo (6k em vez de 30k); ai compact corta
    // services/products/KB/notes e geralmente cabe na metade do budget.
    const msg = String(firstErr?.message || "");
    const isTooBig = msg.includes("413") || msg.includes("too large") || msg.includes("tokens per minute");
    if (!isTooBig) throw firstErr;
    console.warn(`[CrmAutoReply] Groq estourou TPM/tamanho (${msg.slice(0, 100)}). Tentando de novo em modo COMPACT.`);
    systemPrompt = buildPrompt(true);
    messages = [{ role: "system", content: systemPrompt }, ...history];
    result = await groqChat({
      apiKey,
      model: chosenModel,
      messages,
      temperature: 0.7,
      maxTokens: 1200,
      jsonMode: true,
    });
    console.log("[CrmAutoReply] Retry COMPACT funcionou.");
  }
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
      // JSON truncado por max_tokens — tenta recuperar so a string "reply".
      // Padrao: "reply"\s*:\s*"...conteudo..."  (com escapes \" e \n no meio).
      // Pega tudo ate a primeira aspas-nao-escapada de fechamento OU ate o fim
      // (caso o JSON tenha sido cortado no meio da string da reply).
      const replyMatch = jsonText.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"?/);
      if (replyMatch && replyMatch[1]) {
        const recovered = replyMatch[1]
          .replace(/\\"/g, '"')
          .replace(/\\n/g, "\n")
          .replace(/\\\\/g, "\\")
          .trim();
        if (recovered) {
          console.warn(`[CrmAutoReply] JSON truncado recuperado: "${recovered.slice(0, 60)}..."`);
          return { reply: recovered, action: null };
        }
      }
    }
  }

  // Ultimo recurso: o texto vira a resposta — mas se PARECE JSON cru
  // (comeca com "{"reply":"), nao mostra isso pro cliente. Devolve generico.
  const looksLikeRawJson = /^\s*\{\s*"reply"/.test(text);
  if (looksLikeRawJson) {
    console.warn("[CrmAutoReply] Resposta veio como JSON cru irrecuperavel — devolvendo generico.");
    return {
      reply: "Oi! 😊 Pode me confirmar de novo, por favor? Quero garantir que entendi direitinho o que voce precisa.",
      action: null,
    };
  }
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
  const tag = `[CrmAutoReply] user=${String(usersId).slice(0, 8)}`;
  if (!aiControl) {
    console.warn(`${tag} BLOQUEIO: aiControl ausente no Settings.whatsappConnection (painel nunca foi salvo). Abra o painel da IA e clique em salvar.`);
    return { ok: false, reason: "ai_control_missing", settings };
  }
  if (!aiControl?.enabled) {
    console.warn(`${tag} BLOQUEIO: aiControl.enabled=false. Ative a IA no painel.`);
    return { ok: false, reason: "ai_disabled", settings };
  }
  if (!aiControl?.autoReplyEnabled) {
    console.warn(`${tag} BLOQUEIO: aiControl.autoReplyEnabled=false. Ative "responder automaticamente" no painel.`);
    return { ok: false, reason: "auto_reply_disabled", settings };
  }

  const sub = await CrmAiSubscription.findOne({ where: { user_id: usersId } });
  if (!sub || sub.status !== "active") {
    console.warn(`${tag} BLOQUEIO: CrmAiSubscription ${sub ? `status="${sub.status}"` : "inexistente"}. Renove a assinatura da IA.`);
    return { ok: false, reason: "no_active_subscription", settings };
  }
  return { ok: true, settings, aiControl };
}

export async function generateAutoReply({ usersId, conversation, customer, pet, pets = [], body }) {
  const check = await canAutoReply(usersId);
  if (!check.ok) {
    return { replied: false, reason: check.reason };
  }

  // Se a conversa ja foi escalada (aiPaused), normalmente nao responde mais
  // nessa conversa ate o atendente humano "retomar" via UI.
  // EXCECAO: auto-despausa por inatividade — se passou X horas desde aiPausedAt,
  // a IA volta a responder. Default 6h, configuravel em aiControl.autoResumeAfterHours.
  // Defina como 0 (ou false) para desativar a auto-despausa.
  if (conversation?.metadata?.aiPaused) {
    const autoResumeHoursRaw = check.aiControl?.autoResumeAfterHours;
    const autoResumeHours =
      autoResumeHoursRaw === undefined || autoResumeHoursRaw === null
        ? 6
        : Number(autoResumeHoursRaw);
    const pausedAtIso = conversation.metadata?.aiPausedAt;
    const pausedAt = pausedAtIso ? new Date(pausedAtIso) : null;
    const elapsedMs = pausedAt && !Number.isNaN(pausedAt.getTime())
      ? Date.now() - pausedAt.getTime()
      : null;
    const shouldAutoResume =
      autoResumeHours > 0 &&
      elapsedMs !== null &&
      elapsedMs >= autoResumeHours * 60 * 60 * 1000;

    if (!shouldAutoResume) {
      return { replied: false, reason: "ai_paused_in_conversation" };
    }

    // Despausa e segue. Persiste no banco para o painel refletir.
    const nextMeta = { ...(conversation.metadata || {}) };
    nextMeta.aiPaused = false;
    delete nextMeta.aiPausedAt;
    delete nextMeta.escalationReason;
    delete nextMeta.escalationMessage;
    nextMeta.aiAutoResumedAt = new Date().toISOString();
    try {
      await CrmConversation.update(
        { metadata: nextMeta },
        { where: { id: conversation.id } },
      );
      conversation.metadata = nextMeta;
      console.log(`[CrmAutoReply] Auto-despausa: conversa ${String(conversation.id).slice(0, 8)} ociosa ha ${Math.round(elapsedMs / 3600000)}h`);
    } catch (err) {
      console.warn("[CrmAutoReply] Falha ao auto-despausar conversa:", err.message);
    }
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
  // 4) Tambem carrega: agendamentos futuros, anotacoes do cliente (memoria
  // da IA) e o resumo persistido da conversa (se existir).
  const todayStartIso = new Date().toISOString().slice(0, 10);
  const [allServices, allProducts, upcomingAppointments, customerNotes, knowledgeBase, lastVisit] = await Promise.all([
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
    customer?.id
      ? CustomerAiNote.findAll({
          where: { usersId, customerId: customer.id },
          order: [["pinned", "DESC"], ["createdAt", "DESC"]],
          limit: 10,
        }).catch(() => [])
      : Promise.resolve([]),
    KnowledgeBaseEntry.findAll({
      where: { usersId },
      order: [["pinned", "DESC"], ["order", "ASC"], ["createdAt", "DESC"]],
      limit: 20,
    }).catch(() => []),
    // Última visita concluída (humanização: detecta cliente recorrente pra
    // saudação calorosa "Oi Fulana, saudades! 😊"). Pega o agendamento
    // concluído mais recente — se for < 30 dias, cliente é recorrente.
    customer?.id
      ? import("../models/Appointment.js").then(async ({ default: Appointment }) =>
          Appointment.findOne({
            where: {
              usersId,
              customerId: customer.id,
              status: { [Op.in]: ["Concluido", "concluido", "Finalizado", "finalizado"] },
            },
            order: [["date", "DESC"], ["time", "DESC"]],
            attributes: ["date", "time"],
          }).catch(() => null),
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Disponibilidade real da agenda — se o cliente perguntou "tem horário?",
  // "amanhã de manhã?", etc., consulta os slots realmente livres e injeta no
  // contexto da IA. Sem isso a IA inventa horários ou só pergunta "qual prefere?".
  // Só dispara quando detectScheduleQuery encontra sinais claros (palavras de
  // agenda OU referência de data/período).
  let availableSlots = null;
  try {
    const scheduleQuery = detectScheduleQuery(body);
    if (scheduleQuery) {
      const slotsResult = await getAvailableSlots({
        usersId,
        date: scheduleQuery.date,
        period: scheduleQuery.period,
        type: "estetica",
        settings: check.settings,
        aiControl: check.aiControl,
        maxSlots: 6,
      });
      availableSlots = { ...slotsResult, queryDate: scheduleQuery.date, queryPeriod: scheduleQuery.period };
      console.log(`[CrmAutoReply] Slots livres ${scheduleQuery.date}${scheduleQuery.period ? ` (${scheduleQuery.period})` : ""}: ${slotsResult.slots.join(", ") || "nenhum"}`);
    }
  } catch (err) {
    console.warn("[CrmAutoReply] Falha buscando slots:", err?.message);
  }

  // Resumo da conversa: persistido em conversation.metadata.aiSummary quando o
  // historico passa de 20 mensagens. Veja maybeUpdateConversationSummary().
  const conversationSummary = conversation?.metadata?.aiSummary || null;

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

  // Historico de saida (so usado pelo fallback de keywords). Lazy-load
  // pra economizar uma query DB quando o Groq tem sucesso (caminho normal).
  let history = null;
  const lazyHistory = async () => {
    if (history !== null) return history;
    if (!conversation?.id) {
      history = [];
      return history;
    }
    history = await CrmConversationMessage.findAll({
      where: { conversationId: conversation.id, direction: "outbound" },
      order: [["createdAt", "DESC"]],
      limit: 3,
      attributes: ["body", "createdAt"],
    }).catch(() => []);
    return history;
  };

  // Toggle: por default a IA NAO se identifica como IA (mais humano)
  const identifyAsAi = Boolean(check.aiControl?.identifyAsAi);

  // PRIORIDADE 1: Groq (IA real). Se tem key configurada, usa.
  // PRIORIDADE 2: Fallback para resposta por keywords (sempre funciona).
  const groqApiKey = String(check.aiControl?.groqApiKey || process.env.GROQ_API_KEY || "").trim();
  let reply = null;
  let aiSource = "keywords";

  let executedAction = null;

  if (!groqApiKey) {
    console.warn(
      `[CrmAutoReply] user=${String(usersId).slice(0, 8)} SEM GROQ_API_KEY — IA respondendo em modo FALLBACK (keywords). Respostas serao curtas e repetitivas. Configure aiControl.groqApiKey no painel OU defina GROQ_API_KEY no env do Render.`,
    );
  }

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
        customerNotes,
        conversationSummary,
        knowledgeBase,
        lastVisit,
        availableSlots,
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
      // Falha aqui = IA "burra" pra usuario final (cai em keywords pobre).
      // Sobe pra error pra ficar visivel em monitoramento e logs em arquivo.
      const status = groqErr?.response?.status || groqErr?.status || "n/a";
      console.error(
        `[CrmAutoReply] Groq FALHOU (status=${status}, msg="${groqErr?.message || groqErr}") — caindo em fallback de keywords. Verifique GROQ_API_KEY, rate limit ou timeout.`,
      );
      try {
        await CrmAiActionLog.create({
          usersId,
          conversationId: conversation?.id || null,
          customerId: customer?.id || null,
          petId: pet?.id || null,
          authorUserId: null,
          actionType: "groq_failure",
          status: "failed",
          summary: `Groq falhou (status=${status}): ${String(groqErr?.message || groqErr).slice(0, 200)}`,
          assistantReply: "",
          approvalRequired: false,
          approvedByHuman: false,
          executed: false,
          payload: { status, message: String(groqErr?.message || groqErr).slice(0, 500) },
        });
      } catch (_) {}
    }
  }

  // Fallback se Groq nao foi configurado ou falhou
  if (!reply || !reply.trim()) {
    const histForFallback = await lazyHistory();
    reply = buildReply({
      question: body,
      services,
      settings: check.settings,
      customer,
      pet,
      history: histForFallback,
      identifyAsAi,
      availableSlots,
    });
    aiSource = "keywords";
  }

  // Anti-repeticao: so checa se ja carregou history (caminho fallback).
  // No caminho Groq normal, o proprio modelo ja varia naturalmente.
  const histForCheck = history; // null se Groq teve sucesso (nao foi carregado)
  const lastBotBody = String(histForCheck?.[0]?.body || "").trim();
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

  // Fire-and-forget: atualiza resumo da conversa se ja passou de 20 mensagens.
  // Nao bloqueia o retorno ao cliente.
  if (groqApiKey && conversation?.id) {
    maybeUpdateConversationSummary({ conversation, apiKey: groqApiKey, usersId }).catch(() => {});
  }

  return { replied: true, reply: finalReply };
}

// Geracao de resposta para o "Chat de teste" do painel da IA: nao salva nada
// no banco, nao cria/altera agendamento, nao loga acao. Pega o mesmo system
// prompt que rodaria em producao (BASE + servicos da loja + instrucoes do
// dono) e chama o Groq com o historico que o painel mantem em memoria.
export async function testAiReply({ usersId, messages = [] }) {
  if (!usersId) throw new Error("usersId obrigatorio para teste");
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages vazio");
  }

  const settings = await Settings.findOne({ where: { usersId } });
  if (!settings) throw new Error("Settings nao encontrado");

  const whatsappConnection = settings.whatsappConnection || {};
  const aiControl = whatsappConnection.crmAiControl || {};

  const groqApiKey = String(aiControl.groqApiKey || process.env.GROQ_API_KEY || "").trim();
  if (!groqApiKey) {
    throw new Error("Groq API key nao configurada — preencha o campo no painel da IA ou defina GROQ_API_KEY no servidor.");
  }

  // Carrega servicos da loja (mesmo filtro que o pipeline real)
  const allServices = await Services.findAll({
    where: { establishment: usersId },
    order: [["name", "ASC"]],
    limit: 60,
  });
  const SPECIALTY_KEYWORDS = [
    "banho", "tosa", "hidrat", "estetica", "estética",
    "perfume", "unha", "ouvido", "pacote", "pacotinho",
  ];
  const filteredServices = allServices.filter((s) => {
    const n = normalizeSearchable(s.name);
    return SPECIALTY_KEYWORDS.some((k) => n.includes(k));
  });
  const services = filteredServices.length > 0 ? filteredServices : allServices.slice(0, 20);

  const systemPrompt = buildSystemPrompt({
    settings,
    aiControl,
    services,
    products: [],
    customer: null,
    pet: null,
    pets: [],
    upcomingAppointments: [],
  });

  // Sanitiza historico: so user/assistant, content em string, max 8 turnos
  const cleanMessages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) }));

  if (cleanMessages.length === 0 || cleanMessages[cleanMessages.length - 1].role !== "user") {
    throw new Error("ultima mensagem precisa ser do usuario (role=user)");
  }

  const groqMessages = [{ role: "system", content: systemPrompt }, ...cleanMessages];

  // Híbrido também no chat de teste: detecta caso sensível e troca pro smart.
  const lastUserBody = cleanMessages[cleanMessages.length - 1]?.content || "";
  const useSmart = shouldUseSmartModel({
    body: lastUserBody,
    aiControl,
    history: cleanMessages,
    customer: null,
    lastVisit: null,
  });
  const chosenModel = useSmart ? GROQ_SMART_MODEL : GROQ_DEFAULT_MODEL;

  const result = await groqChat({
    apiKey: groqApiKey,
    model: chosenModel,
    messages: groqMessages,
    temperature: 0.4,
    maxTokens: 600,
  });

  const rawContent = String(result.content || "").trim();
  // Se a IA respondeu em JSON (modo padrao do prompt de producao), extrai o reply.
  // Senao, devolve o texto cru.
  let reply = rawContent;
  try {
    const start = rawContent.indexOf("{");
    const end = rawContent.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(rawContent.slice(start, end + 1));
      if (parsed && typeof parsed.reply === "string" && parsed.reply.trim()) {
        reply = parsed.reply.trim();
      }
    }
  } catch (_) {
    // mantem rawContent
  }

  return {
    reply,
    model: result.model || "groq",
    promptLength: systemPrompt.length,
  };
}
