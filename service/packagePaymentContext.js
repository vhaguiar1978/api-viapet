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
