const normalized = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const STOP_WORDS = new Set(["como", "para", "quero", "fazer", "pode", "tenho", "onde", "qual", "sobre", "minha", "meu", "viapet"]);
const words = (value) => normalized(value).split(/[^a-z0-9]+/).filter((part) => part.length >= 4 && !STOP_WORDS.has(part));

function matchKnowledge(message, entries = []) {
  const query = new Set(words(message));
  const ranked = entries.map((entry) => {
    const keys = words(`${entry.title || ""} ${entry.keywords || ""} ${entry.questions || ""}`);
    const hits = keys.filter((key) => query.has(key)).length;
    return { entry, hits };
  }).filter((item) => item.hits > 0).sort((a, b) => b.hits - a.hits);
  return ranked[0]?.entry || null;
}

export function previewRelationshipResponse({ message, knowledge = [], subscription = null, payment = null }) {
  const input = normalized(message);
  if (!input.trim()) throw new Error("Digite uma mensagem para testar.");
  if (/(nao.*receber|nao.*cham|pare.*mensag|remov.*numero)/.test(input)) return { mode: "privacidade", nextAction: "stop_contact", reply: "Entendi. Não enviarei novos contatos proativos. Vou registrar sua preferência.", specialistConsulted: false, source: null, humanHandoff: false };
  if (/(ja paguei|paguei|pagamento.*feito|pix.*feito)/.test(input)) {
    const confirmed = subscription?.status === "active" && (subscription?.payment_status === "approved" || (payment?.status === "approved" && String(payment?.subscription_id) === String(subscription?.id)));
    return confirmed
      ? { mode: "financeiro", nextAction: "stop_collection", reply: "Encontrei a confirmação do pagamento. Obrigada por avisar; não há cobrança a seguir para esta mensalidade.", specialistConsulted: false, source: "pagamento_confirmado", humanHandoff: false }
      : { mode: "financeiro", nextAction: "human_review", reply: "Obrigada por avisar. Vou pedir uma verificação do pagamento antes de continuar qualquer cobrança.", specialistConsulted: false, source: "pagamento_nao_confirmado", humanHandoff: true };
  }
  if (/(cancelar|cancelamento|quero sair|vou sair|nao.*servindo)/.test(input)) return { mode: "retencao", nextAction: "human_handoff", reply: "Entendi. Posso saber o que não funcionou para você? Se preferir, encaminho seu pedido de cancelamento à equipe.", specialistConsulted: false, source: null, humanHandoff: true };
  if (/(quanto custa|preco|valor do plano|como assino|quero contratar|tem desconto)/.test(input)) return { mode: "comercial", nextAction: "human_handoff", reply: "Posso ajudar a escolher o plano adequado. Vou encaminhar sua dúvida comercial para a equipe confirmar valores e condições atuais.", specialistConsulted: false, source: null, humanHandoff: true };
  const source = matchKnowledge(message, knowledge);
  if (source) return { mode: "suporte", nextAction: "answer_from_knowledge", reply: String(source.content || "").slice(0, 1200), specialistConsulted: true, source: source.title, videoLink: source.videoLink || null, internalLink: source.internalLink || null, humanHandoff: false };
  return { mode: "suporte", nextAction: "human_handoff", reply: "Ainda não encontrei uma orientação confirmada sobre isso. Vou encaminhar sua dúvida para a equipe ViaPet.", specialistConsulted: true, source: "INFORMAÇÃO NÃO CONFIRMADA", humanHandoff: true };
}
