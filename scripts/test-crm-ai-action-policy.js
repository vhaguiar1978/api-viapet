import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCrmAiActionPolicy,
  hasExplicitTutorConfirmation,
} from "../service/crmAiActionPolicy.js";

function control(overrides = {}) {
  return {
    enabled: true,
    autoExecuteEnabled: false,
    capabilities: {
      createAppointment: true,
      updateAppointment: true,
      cancelAppointment: true,
      createCustomer: false,
      createPet: false,
    },
    scheduling: {
      requireHumanApproval: true,
      requireTutorConfirmation: true,
      allowNewCustomer: false,
      allowNewPet: false,
    },
    ...overrides,
  };
}

test("reconhece confirmacao explicita sem aceitar negacao", () => {
  assert.equal(hasExplicitTutorConfirmation("pode confirmar", "create_appointment"), true);
  assert.equal(hasExplicitTutorConfirmation("sim, pode cancelar", "cancel_appointment"), true);
  assert.equal(hasExplicitTutorConfirmation("nao pode cancelar", "cancel_appointment"), false);
});

test("acao mutavel aguarda aprovacao humana por padrao", () => {
  const result = evaluateCrmAiActionPolicy({
    control: control(),
    actionType: "create_appointment",
    tutorMessage: "pode confirmar",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.tutorConfirmed, true);
  assert.equal(result.executionMode, "approval");
});

test("execucao automatica exige confirmacao do tutor", () => {
  const autoControl = control({
    autoExecuteEnabled: true,
    scheduling: {
      requireHumanApproval: false,
      requireTutorConfirmation: true,
      allowNewCustomer: false,
      allowNewPet: false,
    },
  });

  const missing = evaluateCrmAiActionPolicy({
    control: autoControl,
    actionType: "create_appointment",
    tutorMessage: "quero banho amanha as 10",
  });
  assert.equal(missing.executionMode, "approval");
  assert.equal(missing.tutorConfirmed, false);

  const confirmed = evaluateCrmAiActionPolicy({
    control: autoControl,
    actionType: "create_appointment",
    tutorMessage: "sim, pode confirmar",
  });
  assert.equal(confirmed.executionMode, "automatic");
});

test("bloqueia capacidade desligada e pet novo nao autorizado", () => {
  const disabled = evaluateCrmAiActionPolicy({
    control: control({ capabilities: { createAppointment: false } }),
    actionType: "create_appointment",
    tutorMessage: "pode confirmar",
  });
  assert.equal(disabled.allowed, false);

  const newPet = evaluateCrmAiActionPolicy({
    control: control(),
    actionType: "create_appointment",
    tutorMessage: "pode confirmar",
    payload: { isNewPet: true },
  });
  assert.equal(newPet.allowed, false);
});
