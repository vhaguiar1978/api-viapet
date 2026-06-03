// Cliente da API Google Gemini.
// Free tier de gemini-2.0-flash: 15 RPM, 1M TPM, 1.500 RPD.
// Usado como FALLBACK quando Groq estoura limite ou cai.
// Doc: https://ai.google.dev/gemini-api/docs/text-generation

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Converte mensagens no formato OpenAI/Groq para o formato Gemini.
 * - role "system" vira systemInstruction (campo separado)
 * - role "assistant" vira "model"
 * - role "user" continua "user"
 */
function convertMessages(messages) {
  const systemParts = [];
  const contents = [];

  for (const msg of messages) {
    if (!msg || !msg.content) continue;
    if (msg.role === "system") {
      systemParts.push({ text: String(msg.content) });
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [{ text: String(msg.content) }] });
  }

  // Gemini exige que a conversa comece com role "user". Se a primeira mensagem
  // for "model" (raro), descarta — não faz sentido sem contexto anterior.
  while (contents.length > 0 && contents[0].role !== "user") {
    contents.shift();
  }

  return {
    contents,
    systemInstruction: systemParts.length > 0 ? { parts: systemParts } : undefined,
  };
}

/**
 * Chama Gemini Generate Content (compatível com a interface do groqChat).
 *
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {boolean} [opts.jsonMode]
 * @returns {Promise<{content: string, usage?: Object, model: string, finishReason: string|null}>}
 */
export async function geminiChat({
  apiKey,
  messages,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 1200,
  jsonMode = false,
} = {}) {
  if (!apiKey) {
    throw new Error("Gemini: API key ausente");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Gemini: messages obrigatorio");
  }

  const { contents, systemInstruction } = convertMessages(messages);
  if (contents.length === 0) {
    throw new Error("Gemini: nenhuma mensagem do user encontrada apos conversao");
  }

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Gemini HTTP ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0] || {};
    const parts = candidate?.content?.parts || [];
    const content = parts.map((p) => p?.text || "").join("").trim();
    const finishReason = candidate?.finishReason || null;

    if (finishReason === "MAX_TOKENS") {
      console.warn(
        `[Gemini] finishReason=MAX_TOKENS — resposta CORTADA por maxOutputTokens=${maxTokens} (modelo=${model}). Aumente maxTokens ou diminua o contexto.`,
      );
    }

    return {
      content,
      usage: data?.usageMetadata || null,
      model,
      finishReason,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Gemini: timeout (${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s)`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Chama Gemini com um arquivo inline para tarefas de visao/leitura de documento.
 *
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {Buffer|string} opts.fileData Buffer ou base64 do arquivo
 * @param {string} opts.mimeType MIME do arquivo
 * @param {string} opts.prompt Instrucao textual
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {boolean} [opts.jsonMode]
 * @returns {Promise<{content: string, usage?: Object, model: string, finishReason: string|null}>}
 */
export async function geminiFilePrompt({
  apiKey,
  fileData,
  mimeType,
  prompt,
  model = DEFAULT_MODEL,
  temperature = 0.1,
  maxTokens = 900,
  jsonMode = true,
} = {}) {
  if (!apiKey) {
    throw new Error("Gemini: API key ausente");
  }
  if (!fileData) {
    throw new Error("Gemini: fileData obrigatorio");
  }
  if (!mimeType) {
    throw new Error("Gemini: mimeType obrigatorio");
  }
  if (!prompt) {
    throw new Error("Gemini: prompt obrigatorio");
  }

  const base64Data = Buffer.isBuffer(fileData)
    ? fileData.toString("base64")
    : String(fileData || "");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Gemini HTTP ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0] || {};
    const parts = candidate?.content?.parts || [];
    const content = parts.map((p) => p?.text || "").join("").trim();
    const finishReason = candidate?.finishReason || null;

    return {
      content,
      usage: data?.usageMetadata || null,
      model,
      finishReason,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Gemini: timeout (${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s)`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const GEMINI_DEFAULT_MODEL = DEFAULT_MODEL;
