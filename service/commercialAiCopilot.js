import { openaiChat, OPENAI_DEFAULT_MODEL } from "./openaiClient.js";

const STAGES = new Set(["found", "qualified", "contact_started", "replied", "interested", "demo", "trial", "negotiation", "won", "lost"]);

function parseJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(raw); } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("A IA retornou uma resposta em formato inesperado.");
    return JSON.parse(match[0]);
  }
}

const clean = (value, limit) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);

export async function generateCommercialCopilot({ lead, objective = "primeiro_contato", tone = "consultivo" }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("A chave da OpenAI não está configurada.");

  const context = {
    empresa: clean(lead.businessName, 220), segmento: clean(lead.segment, 120),
    cidade: clean(lead.city, 120), estado: clean(lead.state, 80), site: clean(lead.website, 300),
    etapaAtual: clean(lead.stage, 32), permissaoContato: clean(lead.contactPermission, 24),
  };
  const result = await openaiChat({
    apiKey,
    model: process.env.OPENAI_COMMERCIAL_MODEL || process.env.OPENAI_CRM_MODEL || OPENAI_DEFAULT_MODEL,
    reasoningEffort: "low",
    maxTokens: 1100,
    jsonMode: true,
    messages: [
      { role: "system", content: `Você é o copiloto comercial do ViaPet.app, um SaaS brasileiro de gestão para pet shops, banho e tosa e clínicas pet. Ajude um vendedor humano a preparar uma abordagem útil, curta e verdadeira. Não invente fatos sobre a empresa. Não prometa preços, integrações ou resultados não informados. Não diga que pesquisou o site. A saída é apenas um rascunho: nunca afirme que uma mensagem foi enviada. Responda somente em JSON válido no formato {"summary":"...","qualification":"cold|warm|hot","qualificationReason":"...","suggestedStage":"found|qualified|contact_started|replied|interested|demo|trial|negotiation","openingMessage":"...","followUpMessage":"...","nextAction":"...","objections":[{"title":"...","answer":"..."}]}. As mensagens devem ser em português brasileiro, naturais, sem pressão e com no máximo 450 caracteres. Se permissaoContato não for opted_in, escreva mensagens para uso somente após obter base legal/consentimento adequado.` },
      { role: "user", content: `Objetivo: ${clean(objective, 60)}\nTom: ${clean(tone, 40)}\nDados disponíveis: ${JSON.stringify(context)}` },
    ],
  });
  const parsed = parseJson(result.content);
  const suggestedStage = STAGES.has(parsed.suggestedStage) && parsed.suggestedStage !== "lost" && parsed.suggestedStage !== "won" ? parsed.suggestedStage : lead.stage;
  return {
    summary: clean(parsed.summary, 500),
    qualification: ["cold", "warm", "hot"].includes(parsed.qualification) ? parsed.qualification : "warm",
    qualificationReason: clean(parsed.qualificationReason, 400),
    suggestedStage,
    openingMessage: clean(parsed.openingMessage, 600),
    followUpMessage: clean(parsed.followUpMessage, 600),
    nextAction: clean(parsed.nextAction, 300),
    objections: Array.isArray(parsed.objections) ? parsed.objections.slice(0, 4).map((item) => ({ title: clean(item?.title, 120), answer: clean(item?.answer, 400) })).filter((item) => item.title && item.answer) : [],
    provider: "openai", model: result.model,
  };
}
