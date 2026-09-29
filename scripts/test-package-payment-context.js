import test from "node:test";
import assert from "node:assert/strict";

import { isPrimaryPackageOccurrence } from "../service/packagePaymentContext.js";

test("agendamento comum é sempre seu próprio contexto financeiro", () => {
  assert.equal(isPrimaryPackageOccurrence({ id: "a", package: false }), true);
});

test("packageNumber 1 é a ocorrência financeira principal", () => {
  assert.equal(isPrimaryPackageOccurrence({ id: "a", packageGroupId: "g", packageNumber: 1 }), true);
  assert.equal(isPrimaryPackageOccurrence({ id: "b", packageGroupId: "g", packageNumber: 2 }), false);
});

test("pacote legado usa a ocorrência cronologicamente mais antiga", () => {
  const occurrences = [
    { id: "later", date: "2026-09-26", time: "09:00" },
    { id: "first", date: "2026-09-12", time: "09:00" },
  ];
  assert.equal(isPrimaryPackageOccurrence({ id: "first", packageGroupId: "g" }, occurrences), true);
  assert.equal(isPrimaryPackageOccurrence({ id: "later", packageGroupId: "g" }, occurrences), false);
});
