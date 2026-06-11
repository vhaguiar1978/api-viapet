export function normalizeAiQualityText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasAny(text, words = []) {
  return words.some((word) => text.includes(word));
}

function hasConcreteTime(text) {
  return /\b\d{1,2}(?::\d{2})?\s*h\b|\b\d{1,2}:\d{2}\b/.test(text);
}

function hasNoAvailability(text) {
  return /\b(nao tenho|sem horario|agenda cheia|nao encontrei|nao temos|lotado|lotada)\b/.test(text);
}

function detectQuestionIntent(question = "") {
  const text = normalizeAiQualityText(question);

  if (hasAny(text, ["dor", "sang", "vomit", "doente", "urgente", "emerg", "machuc", "ferida", "alerg"])) {
    return "health";
  }

  if (hasAny(text, ["comprovante", "pix", "paguei", "pagamento", "transferencia", "boleto", "recibo"])) {
    return "payment_receipt";
  }

  if (hasAny(text, ["cancelar", "desmarcar", "remarcar", "trocar horario", "mudar horario"])) {
    return "schedule_change";
  }

  if (
    (/\b(que|qual|quais)\s+horas?\b/.test(text) && /\b(abre|abrem|fecha|fecham|funciona|funcionam|atende|atendem)\b/.test(text)) ||
    /\bhorario\s+(de\s+)?(funcionamento|atendimento|abre|fecha)\b/.test(text)
  ) {
    return "business_hours";
  }

  if (
    /\b(qual|quais|que)\s+horarios?\b/.test(text) ||
    (/\btem\b/.test(text) && /\b(horario|horarios|vaga|vagas|encaixe)\b/.test(text)) ||
    (/\b(horario|horarios|vaga|vagas|disponibilidade|disponivel|disponiveis)\b/.test(text) &&
      /\b(agenda|agendar|marcar|banho|tosa|hoje|amanha|manha|tarde|noite)\b/.test(text))
  ) {
    return "availability";
  }

  if (hasAny(text, ["preco", "valor", "quanto", "custa", "tabela"])) {
    return "price";
  }

  if (hasAny(text, ["endereco", "localizacao", "fica onde", "onde fica", "rua"])) {
    return "location";
  }

  if (hasAny(text, ["oi", "ola", "bom dia", "boa tarde", "boa noite", "tudo bem"])) {
    return "greeting";
  }

  return "general";
}

function detectDateConflict(question, reply) {
  const q = normalizeAiQualityText(question);
  const r = normalizeAiQualityText(reply);
  const askedToday = /\bhoje\b/.test(q);
  const askedTomorrow = /\bamanha\b/.test(q);
  const answeredToday = /\bhoje\b/.test(r);
  const answeredTomorrow = /\bamanha\b/.test(r);

  if (askedToday && answeredTomorrow && !answeredToday) return "asked_today_answered_tomorrow";
  if (askedTomorrow && answeredToday && !answeredTomorrow) return "asked_tomorrow_answered_today";
  return "";
}

function genericReplyIssue(reply) {
  const text = normalizeAiQualityText(reply);
  if (!text.trim()) return "empty_reply";

  const unclearPatterns = [
    /\bnao entendi\b/,
    /\bnao compreendi\b/,
    /\bpode reformular\b/,
    /\bpode repetir\b/,
    /\bexplicar com outras palavras\b/,
    /\bcomo assim\b/,
  ];
  if (unclearPatterns.some((pattern) => pattern.test(text))) return "asks_to_reformulate";

  const genericPatterns = [
    /\bposso te ajudar com agendamento\b/,
    /\bme conta o que voce precisa\b/,
    /\bquer marcar um horario\b.*\bsaber (o )?preco\b/,
    /\bposso agendar\b.*\bvalores\b/,
    /\bposso ajudar com banho\b.*\bhorarios\b.*\bvalores\b/,
    /\bqual desses te ajuda\b/,
  ];
  if (genericPatterns.some((pattern) => pattern.test(text))) return "generic_menu_reply";

  return "";
}

function availabilitySlotMentionIssue(reply, availableSlots) {
  if (!availableSlots || !Array.isArray(availableSlots.slots)) return "";
  const text = normalizeAiQualityText(reply);

  if (availableSlots.slots.length === 0) {
    return hasNoAvailability(text) ? "" : "empty_availability_not_explained";
  }

  const mentionsAnySlot = availableSlots.slots.some((slot) => {
    const compact = String(slot || "").slice(0, 5);
    const hour = compact.replace(":00", "h").replace(":", "h");
    return compact && (text.includes(compact) || text.includes(hour));
  });

  if (!mentionsAnySlot && !hasConcreteTime(text)) return "does_not_offer_real_slots";
  return "";
}

export function analyzeCrmAiReply({ question = "", reply = "", availableSlots = null } = {}) {
  const intent = detectQuestionIntent(question);
  const issues = [];
  const response = normalizeAiQualityText(reply);
  const questionText = normalizeAiQualityText(question);

  const generic = genericReplyIssue(reply);
  if (generic) {
    issues.push({
      code: generic,
      severity: generic === "empty_reply" ? "critical" : "high",
      message: "Resposta vazia, confusa ou generica demais para a pergunta.",
    });
  }

  const dateConflict = detectDateConflict(question, reply);
  if (dateConflict) {
    issues.push({
      code: dateConflict,
      severity: "high",
      message: "A resposta mudou a data que o cliente pediu.",
    });
  }

  if (intent === "availability") {
    const slotIssue = availabilitySlotMentionIssue(reply, availableSlots);
    if (slotIssue) {
      issues.push({
        code: slotIssue,
        severity: "high",
        message: "Cliente pediu horario, mas a resposta nao usou a agenda real.",
      });
    }

    if (!hasConcreteTime(response) && !hasNoAvailability(response) && !/\b(qual dia|para qual dia|pra qual dia)\b/.test(response)) {
      issues.push({
        code: "availability_without_next_step",
        severity: "medium",
        message: "Pergunta de horario precisa listar horarios ou pedir o dia que falta.",
      });
    }
  }

  if (intent === "payment_receipt" && !hasAny(response, ["comprovante", "pagamento", "pago", "pix", "conferir", "verificar"])) {
    issues.push({
      code: "payment_receipt_misdirected",
      severity: "high",
      message: "Cliente falou de pagamento/comprovante e a resposta saiu do assunto.",
    });
  }

  if (intent === "health" && !hasAny(response, ["veterin", "atendente", "equipe", "seguranca", "avaliar"])) {
    issues.push({
      code: "health_not_escalated",
      severity: "high",
      message: "Assunto de saude precisa orientar avaliacao humana/veterinaria.",
    });
  }

  if (intent === "price" && !hasAny(response, ["valor", "preco", "custa", "r$", "porte", "servico", "banho", "tosa"])) {
    issues.push({
      code: "price_without_price_context",
      severity: "medium",
      message: "Pergunta de preco precisa trazer valor ou pedir informacao objetiva.",
    });
  }

  if (intent === "price" && /\br\$\s*0(?:[,.]00)?\b/.test(response)) {
    issues.push({
      code: "zero_price_answer",
      severity: "high",
      message: "A IA nao deve informar R$ 0,00 como preco real.",
    });
  }

  if (intent === "business_hours" && !hasAny(response, ["abre", "funciona", "atende", "horario", "08", "18", "fecha"])) {
    issues.push({
      code: "business_hours_misdirected",
      severity: "medium",
      message: "Pergunta sobre funcionamento precisa responder horario da loja.",
    });
  }

  if (intent === "schedule_change" && !hasAny(response, ["cancel", "desmarc", "remarc", "agendamento", "horario", "data", "pet"])) {
    issues.push({
      code: "schedule_change_misdirected",
      severity: "medium",
      message: "Pedido de cancelar/remarcar precisa seguir fluxo de agenda.",
    });
  }

  const askedSpecific = hasAny(questionText, ["hoje", "amanha", "tarde", "manha", "banho", "tosa", "comprovante", "preco", "valor"]);
  if (askedSpecific && generic === "generic_menu_reply") {
    issues.push({
      code: "specific_question_got_menu",
      severity: "high",
      message: "Pergunta especifica recebeu menu generico.",
    });
  }

  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === "critical") return sum + 60;
    if (issue.severity === "high") return sum + 35;
    if (issue.severity === "medium") return sum + 18;
    return sum + 8;
  }, 0);
  const score = Math.max(0, 100 - penalty);
  const shouldRepair = issues.some((issue) => ["critical", "high"].includes(issue.severity));

  return {
    ok: score >= 80 && !shouldRepair,
    score,
    intent,
    shouldRepair,
    issues,
  };
}
