import test from "node:test";
import assert from "node:assert/strict";
import { previewRelationshipResponse } from "../service/relationshipAssistantPreview.js";

test("dúvida técnica utiliza apenas conhecimento publicado informado", () => {
  const result = previewRelationshipResponse({ message: "Como crio um pacotinho?", knowledge: [{ title: "Pacotinho", keywords: "pacotinho banhos", content: "Abra Pacotinhos e escolha Novo pacote.", videoLink: "https://example.org/video" }] });
  assert.equal(result.specialistConsulted, true); assert.equal(result.nextAction, "answer_from_knowledge"); assert.match(result.reply, /Novo pacote/);
});
test("sem conhecimento confirmado transfere para humano", () => {
  const result = previewRelationshipResponse({ message: "Como configuro uma função desconhecida?" });
  assert.equal(result.source, "INFORMAÇÃO NÃO CONFIRMADA"); assert.equal(result.humanHandoff, true);
});
test("pagamento informado sem confirmação interrompe cobrança e pede análise", () => {
  const result = previewRelationshipResponse({ message: "Já paguei" });
  assert.equal(result.nextAction, "human_review"); assert.equal(result.humanHandoff, true);
});
test("pagamento confirmado não gera cobrança", () => {
  const result = previewRelationshipResponse({ message: "Já paguei", subscription: { id: "sub-1", status: "active", payment_status: "approved" }, payment: { status: "approved", subscription_id: "sub-1" } });
  assert.equal(result.nextAction, "stop_collection");
});
test("pagamento antigo de assinatura cancelada não confirma dívida atual", () => {
  const result = previewRelationshipResponse({ message: "Já paguei", subscription: { id: "sub-2", status: "pending" }, payment: { status: "approved", subscription_id: "sub-1" } });
  assert.equal(result.nextAction, "human_review");
});
test("cancelamento e opt-out não viram venda", () => {
  assert.equal(previewRelationshipResponse({ message: "Quero cancelar" }).mode, "retencao");
  assert.equal(previewRelationshipResponse({ message: "Não quero receber mensagens" }).nextAction, "stop_contact");
});
