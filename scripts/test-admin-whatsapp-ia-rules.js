import assert from "node:assert/strict";
import {
  calculateInactivityDays,
  canContactInactiveUser,
  getCadenceStep,
  isOptOutMessage,
  renderTemplate,
} from "../service/adminWhatsappIa.js";

const now = new Date("2026-06-16T12:00:00-03:00");

assert.equal(calculateInactivityDays(new Date("2026-06-06T12:00:00-03:00"), now), 10);
assert.equal(calculateInactivityDays(new Date("2026-06-07T12:00:00-03:00"), now), 9);
assert.equal(getCadenceStep(9), 0);
assert.equal(getCadenceStep(10), 1);
assert.equal(getCadenceStep(13), 2);
assert.equal(getCadenceStep(25), 4);

assert.equal(isOptOutMessage("Pare"), true);
assert.equal(isOptOutMessage("Nao quero receber mensagens"), true);
assert.equal(isOptOutMessage("Preciso de ajuda na agenda"), false);

const baseUser = { phone: "11 99999-0000", name: "Marina" };
const baseSettings = {
  automationEnabled: true,
  maxAttempts: 4,
  contactStart: "09:00",
  contactEnd: "18:00",
};

assert.deepEqual(
  canContactInactiveUser({
    user: baseUser,
    consent: { consentStatus: "granted" },
    automation: { attempts: 1, status: "pending" },
    settings: baseSettings,
    now,
  }).allowed,
  true,
);

assert.equal(
  canContactInactiveUser({
    user: baseUser,
    consent: null,
    automation: { attempts: 1, status: "pending" },
    settings: baseSettings,
    now,
  }).reason,
  "sem_consentimento",
);

assert.equal(
  canContactInactiveUser({
    user: baseUser,
    consent: { consentStatus: "opt_out", optOutAt: now },
    automation: { attempts: 1, status: "pending" },
    settings: baseSettings,
    now,
  }).reason,
  "opt_out",
);

assert.equal(
  canContactInactiveUser({
    user: { phone: "" },
    consent: { consentStatus: "granted" },
    automation: { attempts: 1, status: "pending" },
    settings: baseSettings,
    now,
  }).reason,
  "telefone_invalido",
);

assert.equal(
  canContactInactiveUser({
    user: baseUser,
    consent: { consentStatus: "granted" },
    automation: { attempts: 4, status: "pending" },
    settings: baseSettings,
    now,
  }).reason,
  "limite_tentativas",
);

assert.equal(renderTemplate("Ola, {{nome}}!", { name: "Marina" }), "Ola, Marina!");

console.log("adminWhatsappIa rules: ok");
