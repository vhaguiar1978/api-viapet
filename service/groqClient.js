// Cliente da API Groq (compativel com OpenAI Chat Completions).
// Modelo padrao: llama-3.1-8b-instant (limites grátis bem mais altos:
// ~30k tokens/min e ~500k tokens/dia, vs 12k/min e 100k/dia do 70B).
// Pra atendimento de WhatsApp de pet shop a qualidade do 8B e suficiente.
// Doc: https://console.groq.com/docs/quickstart

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.1-8b-instant";
const FAST_MODEL = "llama-3.1-8b-instant";
const SMART_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_TIMEOUT_MS = 18000;

/**
 * Chama Groq Chat Completions.
 *
 * @param {Object} opts
 * @param {string} opts.apiKey - API key (gsk_...)
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{content: string, usage?: Object}>}
 */
export async function groqChat({
  apiKey,
  messages,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 400,
  jsonMode = false,
} = {}) {
  if (!apiKey) {
    throw new Error("Groq: API key ausente");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Groq: messages obrigatorio");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  // Forca o modelo a retornar APENAS JSON valido (evita texto livre)
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Groq HTTP ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const choice = data?.choices?.[0] || {};
    const content = choice?.message?.content || "";
    const finishReason = choice?.finish_reason || null;
    // Aviso visivel quando o modelo cortou no meio por limite de tokens.
    // Isso causa JSON truncado quando jsonMode=true e resposta partida pro
    // usuario. Quem chamou deve aumentar maxTokens ou encurtar o prompt.
    if (finishReason === "length") {
      console.warn(
        `[Groq] finish_reason=length — resposta CORTADA por max_tokens=${maxTokens} (modelo=${data?.model || model}). Aumente maxTokens ou diminua o contexto.`,
      );
    }
    return {
      content: String(content).trim(),
      usage: data?.usage || null,
      model: data?.model || model,
      finishReason,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Groq: timeout (${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s)`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const GROQ_DEFAULT_MODEL = DEFAULT_MODEL;
export const GROQ_FAST_MODEL = FAST_MODEL;
export const GROQ_SMART_MODEL = SMART_MODEL;
