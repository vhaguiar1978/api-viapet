import test from "node:test";
import assert from "node:assert/strict";

import {
  dedupePackagePayments,
  isPrimaryPackageOccurrence,
} from "../service/packagePaymentContext.js";

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

test("pagamento repetido do pacote com ids distintos conta uma só vez", () => {
  const common = {
    paidAt: "2026-09-01T11:00:00.000Z",
    dueDate: "2026-09-01",
    paymentMethod: "Transferencia",
    grossAmount: 368,
    netAmount: 368,
    status: "paid",
  };
  const result = dedupePackagePayments([
    { ...common, id: "payment-a", financeId: "finance-a" },
    { ...common, id: "payment-b", financeId: "finance-b" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "payment-a");
});

test("pagamentos distintos do pacote continuam independentes", () => {
  const result = dedupePackagePayments([
    { paidAt: "2026-09-01", paymentMethod: "Pix", grossAmount: 100, netAmount: 100 },
    { paidAt: "2026-09-08", paymentMethod: "Pix", grossAmount: 100, netAmount: 100 },
  ]);
  assert.equal(result.length, 2);
});
