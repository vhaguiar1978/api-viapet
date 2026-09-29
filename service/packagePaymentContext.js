function occurrenceKey(occurrence = {}) {
  return [
    String(occurrence.date || ""),
    String(occurrence.time || ""),
    String(occurrence.createdAt || ""),
    String(occurrence.id || ""),
  ].join("|");
}

export function isPrimaryPackageOccurrence(appointment = {}, occurrences = []) {
  const packageGroupId = String(appointment.packageGroupId || "").trim();
  const isPackage = packageGroupId || (appointment.package && Number(appointment.packageMax || 0) > 1);
  if (!isPackage) return true;

  const packageNumber = Number(appointment.packageNumber || 0) || 0;
  if (packageNumber > 0) return packageNumber === 1;

  const ordered = [...occurrences]
    .filter((occurrence) => occurrence?.id)
    .sort((left, right) => occurrenceKey(left).localeCompare(occurrenceKey(right)));
  return String(ordered[0]?.id || "") === String(appointment.id || "");
}

export function packagePaymentFingerprint(payment = {}) {
  return [
    String(payment.paidAt || payment.dueDate || payment.date || "").slice(0, 10),
    String(payment.dueDate || "").slice(0, 10),
    String(payment.paymentMethod || "").trim().toLowerCase(),
    Number(payment.grossAmount ?? payment.amount ?? 0).toFixed(2),
    Number(payment.netAmount ?? payment.amount ?? 0).toFixed(2),
    String(payment.details || "").trim().toLowerCase(),
    String(payment.status || "").trim().toLowerCase(),
  ].join("|");
}

export function dedupePackagePayments(payments = []) {
  const seen = new Set();
  return payments.filter((payment) => {
    const fingerprint = packagePaymentFingerprint(payment);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}
