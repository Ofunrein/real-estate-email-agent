import type { SheetRow } from "@/lib/sheetSchema";

export function formatPrice(value?: string) {
  if (!value) return "Blank";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return `$${numeric.toLocaleString()}`;
}

export function formatSqft(value?: string) {
  if (!value || value === "None") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return `${numeric.toLocaleString()} sqft`;
}

export function displayValue(value?: string) {
  return value && value !== "None" ? value : "Blank";
}

export const corePropertyFields = [
  "price",
  "beds",
  "baths",
  "photo_url",
  "sqft",
  "year_built",
  "city",
  "state",
  "zip",
  "property_type",
];

export function missingPropertyFields(property: SheetRow) {
  return corePropertyFields.filter((field) => !property[field] || property[field] === "None");
}
