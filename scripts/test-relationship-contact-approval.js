import test from "node:test";
import assert from "node:assert/strict";
import { checkRelationshipApproval, RADAR_DEFAULTS } from "../service/relationshipRadarRules.js";

const now = new Date("2026-10-06T15:00:00Z");
const settings = { ...RADAR_DEFAULTS, mode: "approval", dailyContactLimit: 2 };
const decision = { nextAction: "offer_help", signals: { contactAuthorized: true, optedOut: false, humanActive: false, confirmedPayment: false } };
const input = { decision, settings, now, senderReady: true };

test("contato elegível exige aprovação e regras válidas", () => {
  assert.equal(checkRelationshipApproval(input), null);
  assert.equal(checkRelationshipApproval({ ...input, settings: { ...settings, mode: "observe" } }), "modo_sem_aprovacao");
});

test("consentimento, humano e pagamento bloqueiam contato", () => {
  assert.equal(checkRelationshipApproval({ ...input, decision: { ...decision, signals: { ...decision.signals, contactAuthorized: false } } }), "sem_consentimento");
  assert.equal(checkRelationshipApproval({ ...input, decision: { ...decision, signals: { ...decision.signals, humanActive: true } } }), "atendimento_humano");
  assert.equal(checkRelationshipApproval({ ...input, decision: { ...decision, signals: { ...decision.signals, confirmedPayment: true } } }), "pagamento_confirmado");
});

test("sem Meta, limite diário, tentativas, horário e intervalo impedem envio", () => {
  assert.equal(checkRelationshipApproval({ ...input, senderReady: false }), "whatsapp_nao_configurado");
  assert.equal(checkRelationshipApproval({ ...input, sentToday: 2 }), "limite_diario");
  assert.equal(checkRelationshipApproval({ ...input, attempts: 3 }), "limite_tentativas");
  assert.equal(checkRelationshipApproval({ ...input, now: new Date("2026-10-06T23:00:00Z") }), "fora_do_horario");
  assert.equal(checkRelationshipApproval({ ...input, lastContactAt: new Date("2026-10-06T12:00:00Z") }), "intervalo_minimo");
});
