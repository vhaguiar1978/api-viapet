// Cliente da API Groq (compativel com OpenAI Chat Completions).
// Modelo padrao: llama-3.1-8b-instant (rapido e gratuito).
// Doc: https://console.groq.com/docs/quickstart

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.1-8b-instant";
const DEFAULT_TIMEOUT_MS = 12000;

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
    const content = data?.choices?.[0]?.message?.content || "";
    return {
      content: String(content).trim(),
      usage: data?.usage || null,
      model: data?.model || model,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Groq: timeout (12s)");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const GROQ_DEFAULT_MODEL = DEFAULT_MODEL;
