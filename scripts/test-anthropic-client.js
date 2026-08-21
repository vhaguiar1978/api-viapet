import test from "node:test";
import assert from "node:assert/strict";
import { anthropicChat } from "../service/anthropicClient.js";

test("envia Messages API no formato Anthropic e retorna uso real", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ model: "claude-sonnet-5", content: [{ type: "text", text: "Ola!" }], usage: { input_tokens: 12, output_tokens: 4 }, stop_reason: "end_turn" }) };
  };
  try {
    const result = await anthropicChat({ apiKey: "sk-ant-test", messages: [{ role: "system", content: "Sistema" }, { role: "user", content: "Oi" }] });
    assert.equal(request.url, "https://api.anthropic.com/v1/messages");
    assert.equal(request.options.headers["anthropic-version"], "2023-06-01");
    assert.equal(request.body.system, "Sistema");
    assert.deepEqual(request.body.messages, [{ role: "user", content: "Oi" }]);
    assert.equal(result.content, "Ola!");
    assert.equal(result.usage.inputTokens, 12);
  } finally { globalThis.fetch = originalFetch; }
});

test("nao expoe a chave no erro HTTP", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid x-api-key" } }) });
  try { await assert.rejects(() => anthropicChat({ apiKey: "segredo", messages: [{ role: "user", content: "Oi" }] }), /Anthropic HTTP 401/); }
  finally { globalThis.fetch = originalFetch; }
});
