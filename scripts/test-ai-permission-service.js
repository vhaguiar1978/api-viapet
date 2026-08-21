import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePermissionMode } from "../service/aiPermissionService.js";

test("nega uma acao proibida", () => {
  const result = evaluatePermissionMode({ mode: "denied" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "permission_denied");
});

test("exige confirmacao explicita do cliente", () => {
  const vague = evaluatePermissionMode({
    mode: "customer_confirmation",
    payload: { confirmationText: "acho que sim" },
  });
  assert.equal(vague.executable, false);

  const confirmed = evaluatePermissionMode({
    mode: "customer_confirmation",
    payload: { confirmationText: "Sim, pode confirmar" },
  });
  assert.equal(confirmed.executable, true);
});

test("exige aprovacao humana quando configurada", () => {
  assert.equal(evaluatePermissionMode({ mode: "human_approval" }).executable, false);
  assert.equal(evaluatePermissionMode({ mode: "human_approval", humanApproved: true }).executable, true);
});

test("botao de emergencia bloqueia escrita mesmo automatica", () => {
  const result = evaluatePermissionMode({ mode: "automatic", writesPaused: true });
  assert.equal(result.executable, false);
  assert.equal(result.reason, "ai_writes_paused");
});
