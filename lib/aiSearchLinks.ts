type Env = Record<string, string | undefined>;

export type AiSearchConfig = {
  baseUrl: string;
  tenantId: string;
  mlsOsn: string;
};

export type AiSearchPropertyInput =
  | string
  | number
  | null
  | undefined
  | Record<string, unknown>;

export type AiSearchLinkOptions = {
  env?: Env;
  noSqueeze?: boolean;
  preserveListingUrl?: boolean;
};

const ID_FIELDS = [
  "ai_search_property_id",
  "aiSearchPropertyId",
  "property_id",
  "propertyId",
  "listing_id",
  "listingId",
  "mls_id",
  "mlsId",
  "mls_number",
  "mlsNumber",
  "id",
];

function clean(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function listingUrl(input: AiSearchPropertyInput): string {
  if (!input || typeof input !== "object") return "";
  const value = clean(input.listing_url);
  return value.startsWith("http://") || value.startsWith("https://") ? value : "";
}

function idFromListingUrl(input: AiSearchPropertyInput): string {
  const value = listingUrl(input);
  if (!value) return "";

  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/property\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

export function resolveAiSearchConfig(env: Env = process.env): AiSearchConfig | null {
  const baseUrl = clean(env.NEXT_PUBLIC_AI_SEARCH_BASE_URL || env.AI_SEARCH_BASE_URL);
  const tenantId = clean(env.AI_SEARCH_TENANT_ID);
  const mlsOsn = clean(env.AI_SEARCH_MLS_OSN);
  if (!baseUrl || !tenantId || !mlsOsn) return null;

  try {
    return {
      baseUrl: new URL(baseUrl).origin,
      tenantId,
      mlsOsn,
    };
  } catch {
    return null;
  }
}

export function aiSearchPropertyId(input: AiSearchPropertyInput): string {
  if (typeof input === "string" || typeof input === "number") return clean(input);
  if (!input || typeof input !== "object") return "";

  for (const field of ID_FIELDS) {
    const value = clean(input[field]);
    if (value) return value;
  }

  return idFromListingUrl(input);
}

export function aiSearchPropertyUrl(input: AiSearchPropertyInput, options: AiSearchLinkOptions = {}): string {
  const preserveListingUrl = options.preserveListingUrl !== false;
  const fallbackUrl = preserveListingUrl ? listingUrl(input) : "";
  const config = resolveAiSearchConfig(options.env);
  const propertyId = aiSearchPropertyId(input);
  if (!config || !propertyId) return fallbackUrl;

  const url = new URL(config.baseUrl);
  url.pathname = `/property/${encodeURIComponent(propertyId)}`;
  url.searchParams.set("tenant_id", config.tenantId);
  url.searchParams.set("mls_osn", config.mlsOsn);
  if (options.noSqueeze !== false) url.searchParams.set("no_squeeze", "true");

  return url.toString();
}
