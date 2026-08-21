const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const DEFAULT_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS || 30000);

function normalizeMessages(messages = []) {
  const system = messages.filter((item) => item?.role === "system").map((item) => String(item.content || "")).filter(Boolean).join("\n\n");
  const conversation = messages.filter((item) => ["user", "assistant"].includes(item?.role)).map((item) => ({ role: item.role, content: String(item.content || "") })).filter((item) => item.content);
  return { system, conversation };
}

export async function anthropicChat({ apiKey, model = DEFAULT_MODEL, messages = [], maxTokens = 1200 }) {
  if (!apiKey) throw new Error("Anthropic: API key ausente");
  const { system, conversation } = normalizeMessages(messages);
  if (!conversation.length) throw new Error("Anthropic: messages obrigatorio");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: Math.max(1, Number(maxTokens || 1200)), ...(system ? { system } : {}), messages: conversation }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}: ${String(data?.error?.message || JSON.stringify(data)).slice(0, 300)}`);
    const content = Array.isArray(data.content) ? data.content.filter((block) => block?.type === "text").map((block) => block.text).join("\n").trim() : "";
    if (!content) throw new Error("Anthropic: resposta sem texto");
    return { content, model: data.model || model, usage: { inputTokens: Number(data.usage?.input_tokens || 0), outputTokens: Number(data.usage?.output_tokens || 0), cacheReadTokens: Number(data.usage?.cache_read_input_tokens || 0), cacheCreationTokens: Number(data.usage?.cache_creation_input_tokens || 0) }, stopReason: data.stop_reason || null };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Anthropic: timeout (${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s)`);
    throw error;
  } finally { clearTimeout(timeout); }
}

export const ANTHROPIC_DEFAULT_MODEL = DEFAULT_MODEL;
