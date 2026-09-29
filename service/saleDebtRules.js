const DEFERRED_PAYMENT_METHODS = new Set([
  "pendente",
  "fiado",
  "a prazo",
  "prazo",
  "conta cliente",
]);

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isDeferredSalePayment(paymentMethod) {
  const method = normalize(paymentMethod);
  return !method || DEFERRED_PAYMENT_METHODS.has(method);
}

export function getInitialSaleStatus(paymentMethod) {
  return isDeferredSalePayment(paymentMethod) ? "pendente" : "pago";
}

export function isSaleOutstanding(sale = {}) {
  const status = normalize(sale.status);
  if (status === "pago" || status === "cancelado") return false;
  return isDeferredSalePayment(sale.paymentMethod);
}
