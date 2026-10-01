import test from "node:test";
import assert from "node:assert/strict";
import { countOperationalDays, evaluateRelationship, scopeRelationshipRecords, RADAR_DEFAULTS } from "../service/relationshipRadarRules.js";

const now = new Date("2026-10-06T12:00:00Z");
const user = { createdAt: "2026-10-01T12:00:00Z", lastAccess: "2026-10-05T12:00:00Z" };
const context = { user, now, settings: RADAR_DEFAULTS };

test("fim de semana e feriado não contam como abandono", () => {
  const rules = { ...RADAR_DEFAULTS, holidays: ["2026-10-05"] };
  assert.equal(countOperationalDays("2026-10-02T12:00:00Z", new Date("2026-10-07T12:00:00Z"), rules), 1);
});

test("uso normal segue em observação", () => {
  const result = evaluateRelationship({ ...context, activities: [{ modulo: "agenda", acao: "appointment_created", created_at: now }] });
  assert.equal(result.state, "engajado"); assert.equal(result.canSend, false);
});

test("dificuldade antes de três dias recomenda ajuda", () => {
  const activities = Array.from({ length: 3 }, () => ({ modulo: "navegacao", acao: "page_view", metadata_json: { path: "/agenda" }, created_at: now }));
  const result = evaluateRelationship({ ...context, activities, consent: { consentStatus: "granted" } });
  assert.equal(result.nextAction, "offer_help"); assert.equal(result.canSend, false);
});

test("pagamento confirmado interrompe aquisição", () => {
  const result = evaluateRelationship({ ...context, user: { ...user, lastAccess: "2026-09-20T12:00:00Z" }, subscription: { plan_type: "monthly", status: "active", payment_status: "approved" } });
  assert.equal(result.state, "assinante_ativo"); assert.equal(result.nextAction, "observe");
});

test("atendimento humano e opt-out prevalecem sobre inatividade", () => {
  const inactive = { ...context, user: { ...user, lastAccess: "2026-09-20T12:00:00Z" } };
  assert.equal(evaluateRelationship({ ...inactive, conversation: { attendanceMode: "human" } }).nextAction, "none");
  assert.equal(evaluateRelationship({ ...inactive, consent: { consentStatus: "opt_out" } }).nextAction, "none");
});

test("três dias operacionais sem acesso entram em avaliação, sem envio", () => {
  const result = evaluateRelationship({ ...context, user: { ...user, lastAccess: "2026-09-30T12:00:00Z" } });
  assert.equal(result.nextAction, "evaluate_reactivation"); assert.equal(result.canSend, false);
});

test("consentimento e conversa de outra empresa não entram na decisão", () => {
  const users = [{ id: "cliente-1", establishment: "empresa-certa" }];
  const rows = [
    { userId: "cliente-1", organizationId: "empresa-errada", consentStatus: "granted" },
    { userId: "cliente-1", organizationId: "empresa-certa", consentStatus: "pending" },
  ];
  assert.deepEqual(scopeRelationshipRecords(rows, users), [rows[1]]);
});
