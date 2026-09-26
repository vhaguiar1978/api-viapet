import test from "node:test";
import assert from "node:assert/strict";
import { generateCommercialCopilot } from "../service/commercialAiCopilot.js";

const originalFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_COMMERCIAL_MODEL;

test.afterEach(() => {
  global.fetch = originalFetch;
  process.env.OPENAI_API_KEY = originalKey;
  process.env.OPENAI_COMMERCIAL_MODEL = originalModel;
});

test("gera rascunho comercial estruturado sem enviar mensagem", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_COMMERCIAL_MODEL = "gpt-5-test";
  let request;
  global.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: "gpt-5-test",
      status: "completed",
      output_text: JSON.stringify({
        summary: "Pet shop com potencial para organizar agenda e atendimento.",
        qualification: "hot",
        qualificationReason: "Está no segmento atendido pelo ViaPet.",
        suggestedStage: "qualified",
        openingMessage: "Olá! Posso apresentar uma forma simples de organizar a rotina do seu pet shop?",
        followUpMessage: "Oi! Posso separar alguns minutos para mostrar como funciona?",
        nextAction: "Confirmar interesse e sugerir uma demonstração.",
        objections: [{ title: "Já uso outro sistema", answer: "Entendo. Podemos comparar somente os pontos que mais tomam tempo hoje." }],
      }),
      usage: { input_tokens: 100, output_tokens: 120 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await generateCommercialCopilot({
    lead: { businessName: "Pet Feliz", segment: "Pet shop", city: "Campinas", state: "SP", stage: "found", contactPermission: "unknown" },
    objective: "primeiro_contato",
    tone: "consultivo",
  });

  assert.equal(result.qualification, "hot");
  assert.equal(result.suggestedStage, "qualified");
  assert.match(result.openingMessage, /organizar a rotina/);
  assert.equal(result.objections.length, 1);
  assert.equal(request.model, "gpt-5-test");
  assert.equal(request.input.some((item) => item.content.includes("permissaoContato")), true);
});

test("não permite que a IA marque venda ou perda automaticamente", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => new Response(JSON.stringify({
    output_text: JSON.stringify({ qualification: "warm", suggestedStage: "won", openingMessage: "Rascunho", followUpMessage: "Retorno", nextAction: "Revisar" }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const result = await generateCommercialCopilot({ lead: { businessName: "Clínica Pet", stage: "interested", contactPermission: "opted_in" } });
  assert.equal(result.suggestedStage, "interested");
});

test("falha com mensagem clara quando não há chave configurada", async () => {
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(
    () => generateCommercialCopilot({ lead: { businessName: "Pet Shop", stage: "found" } }),
    /chave da OpenAI não está configurada/i,
  );
});
