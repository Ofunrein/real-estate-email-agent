export function normalizeEmail(value?: string): string {
  return (value || "").trim().toLowerCase();
}

export function normalizePhone(value?: string): string {
  const digits = (value || "").replace(/\D/g, "");
  if (digits.length === 10) {
    return `1${digits}`;
  }
  return digits;
}

export function normalizeName(value?: string): string {
  return (value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function mergeNonEmpty<T extends Record<string, string>>(existing: T, incoming: T): T {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== "") {
      merged[key as keyof T] = value as T[keyof T];
    }
  }
  return merged;
}
