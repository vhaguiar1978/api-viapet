export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function phoneVariations(value) {
  const normalized = normalizePhone(value);
  if (!normalized) return [];
  const withoutCountry = normalized.startsWith("55")
    ? normalized.slice(2)
    : normalized;
  const withNine = withoutCountry.replace(/^(\d{2})(\d{8})$/, "$19$2");
  const withoutNine = withoutCountry.replace(/^(\d{2})9(\d{8})$/, "$1$2");
  return Array.from(
    new Set(
      [
        normalized,
        withoutCountry,
        withNine,
        withoutNine,
        normalizePhone(withNine),
        normalizePhone(withoutNine),
      ].filter(Boolean),
    ),
  );
}

export function toDateFromUnix(value) {
  if (!value) return new Date();
  const num = Number(value);
  if (!Number.isFinite(num)) return new Date();
  return new Date(num * 1000);
}
