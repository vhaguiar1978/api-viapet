// Cliente da OpenAI Responses API.
// Modelo premium padrao: gpt-5.5, conforme docs oficiais de modelos.

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const DEFAULT_TIMEOUT_MS = 30000;

function toResponsesInput(messages = []) {
  return messages
    .filter((message) => message && message.content)
    .map((message) => ({
      role: message.role === "system" ? "developer" : message.role,
      content: String(message.content),
    }));
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text.trim();

  const output = Array.isArray(data?.output) ? data.output : [];
  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text || "")
    .join("")
    .trim();
}

export async function openaiChat({
  apiKey,
  messages,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 1200,
  jsonMode = false,
  reasoningEffort = "low",
} = {}) {
  if (!apiKey) {
    throw new Error("OpenAI: API key ausente");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("OpenAI: messages obrigatorio");
  }

  const input = toResponsesInput(messages);
  if (input.length === 0) {
    throw new Error("OpenAI: nenhuma mensagem valida");
  }

  const body = {
    model,
    input,
    max_output_tokens: maxTokens,
    reasoning: { effort: reasoningEffort },
  };

  if (Number.isFinite(Number(temperature))) {
    body.temperature = temperature;
  }

  if (jsonMode) {
    const hasDeveloperInstruction = input.some((message) => message.role === "developer");
    if (!hasDeveloperInstruction) {
      input.unshift({
        role: "developer",
        content: "Retorne apenas JSON valido, sem markdown e sem texto fora do JSON.",
      });
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
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
      throw new Error(`OpenAI HTTP ${response.status}: ${errBody.slice(0, 240)}`);
    }

    const data = await response.json();
    return {
      content: extractOutputText(data),
      usage: data?.usage || null,
      model: data?.model || model,
      finishReason: data?.status || null,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`OpenAI: timeout (${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s)`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const OPENAI_DEFAULT_MODEL = DEFAULT_MODEL;
