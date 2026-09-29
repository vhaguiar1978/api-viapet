import test from "node:test";
import assert from "node:assert/strict";

import {
  getInitialSaleStatus,
  isDeferredSalePayment,
  isSaleOutstanding,
} from "../service/saleDebtRules.js";

test("pagamentos imediatos entram como venda paga", () => {
  for (const method of ["Pix", "Pix pela maquina", "Dinheiro", "Debito", "Credito", "Credito parcelado", "Transferencia"]) {
    assert.equal(getInitialSaleStatus(method), "pago", method);
    assert.equal(isDeferredSalePayment(method), false, method);
  }
});

test("somente venda explicitamente fiada ou sem pagamento permanece devedora", () => {
  for (const method of ["Fiado", "A prazo", "Pendente", ""]) {
    assert.equal(getInitialSaleStatus(method), "pendente", method);
    assert.equal(isSaleOutstanding({ status: "pendente", paymentMethod: method }), true, method);
  }
});

test("registro financeiro antigo não cria dívida fantasma para venda paga no PDV", () => {
  assert.equal(isSaleOutstanding({ status: "pendente", paymentMethod: "Pix" }), false);
  assert.equal(isSaleOutstanding({ status: "pendente", paymentMethod: "Dinheiro" }), false);
  assert.equal(isSaleOutstanding({ status: "pago", paymentMethod: "Fiado" }), false);
  assert.equal(isSaleOutstanding({ status: "cancelado", paymentMethod: "A prazo" }), false);
});
