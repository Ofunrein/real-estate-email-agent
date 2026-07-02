import {
  criteriaFromQuery,
  propertyMatchesCriteria,
  upsertPropertyToDatabase,
  type PropertySearchCriteria,
} from "@/lib/database";
import { appendPropertyToSheets } from "@/lib/googleSheets";
import { PROPERTIES_HEADERS, type SheetRow } from "@/lib/sheetSchema";

const DEFAULT_ACTOR = "truefetch~zillow-real-estate-listings";

type ApifyFallbackInput = {
  query: string | PropertySearchCriteria;
  channel?: string;
  limit?: number;
  source?: string;
};

type ApifyFallbackDeps = {
  runActor?: (payload: Record<string, unknown>) => Promise<unknown[]>;
  upsert?: (row: Partial<SheetRow>, source?: string) => Promise<SheetRow | null>;
  appendSheet?: (row: Partial<SheetRow>) => Promise<boolean>;
};

function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pick(...values: unknown[]): string {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function digits(value: unknown): string {
  return clean(value).replace(/[^\d.]/g, "");
}

function listText(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => clean(item)).filter(Boolean).join(", ") : clean(value);
}

function titleizeType(value: unknown): string {
  const text = clean(value);
  if (!text) return "";
  const map: Record<string, string> = {
    house: "House",
    single_family: "House",
    singlefamily: "House",
    condo: "Condo",
    townhouse: "Townhouse",
    apartment: "Apartment",
    residential: "Residential",
  };
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return map[key] || text.replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeListingUrl(item: Record<string, unknown>): string {
  const raw = pick(
    item.listing_url,
    item.property_url,
    item.source_url,
    item.official_url,
    item.detailUrl,
    item.url,
    item.hdpUrl,
    item.bdpUrl,
    item.postingUrl,
  );
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://www.zillow.com${raw}`;
  const zpid = pick(item.zpid, item.property_id, item.listing_id);
  return zpid ? `https://www.zillow.com/homedetails/${zpid}_zpid/` : "";
}

function normalizePhotoUrl(item: Record<string, unknown>): string {
  const responsive = Array.isArray(item.responsivePhotos) ? item.responsivePhotos : [];
  const photo = responsive.find((entry) => typeof entry?.url === "string" && entry.url)?.url;
  const imageUrls = Array.isArray(item.image_urls) ? item.image_urls : [];
  return pick(
    item.photo_url,
    item.cover_image,
    imageUrls[0],
    item.primary_photo,
    item.imgSrc,
    item.hiResImageLink,
    item.desktopWebHdpImageLink,
    item.image,
    item.photo,
    item.primaryPhoto,
    photo,
  );
}

function cityStateFromLocation(location: unknown): { city: string; state: string; zip: string } {
  const text = clean(location);
  const zip = text.match(/\b\d{5}\b/)?.[0] || "";
  const [city = "", state = ""] = text.split(",").map((part) => clean(part));
  return { city: zip ? "" : city, state, zip };
}

function apifyPriceDigits(price: Record<string, unknown> | null, item: Record<string, unknown>): string {
  return digits(pick(price?.value, price?.amount, item.price, item.unformattedPrice, item.priceString));
}

function statusFromItem(item: Record<string, unknown>, slice: Record<string, string>): string {
  return pick(item.status, item.homeStatus, item.listingStatus, item.home_status, slice.listingLabel)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeApifyItemToProperty(item: Record<string, unknown>, slice: Record<string, string> = {}): SheetRow {
  const addressObject = item.address && typeof item.address === "object" ? item.address as Record<string, unknown> : {};
  const attribution = item.attributionInfo && typeof item.attributionInfo === "object" ? item.attributionInfo as Record<string, unknown> : {};
  const price = item.price && typeof item.price === "object" ? item.price as Record<string, unknown> : null;
  const rooms = item.rooms && typeof item.rooms === "object" ? item.rooms as Record<string, unknown> : {};
  const area = item.area && typeof item.area === "object" ? item.area as Record<string, unknown> : {};
  const dates = item.dates && typeof item.dates === "object" ? item.dates as Record<string, unknown> : {};
  const contact = item.contact && typeof item.contact === "object" ? item.contact as Record<string, unknown> : {};
  const locationParts = cityStateFromLocation(item.location);
  const row: Partial<SheetRow> = {
    address: pick(item.address, item.streetAddress, item.street_address, addressObject.streetAddress, item.abbreviatedAddress),
    price: apifyPriceDigits(price, item),
    beds: digits(pick(rooms.beds, item.beds, item.bedrooms, item.bedroomsTotal)),
    baths: digits(pick(rooms.baths, item.baths_full, item.bathrooms, item.bathroomsTotalInteger)),
    city: pick(item.city, addressObject.city, locationParts.city, slice.city),
    state: pick(item.state, addressObject.state, locationParts.state, slice.state),
    zip: pick(item.zip, item.zip_code, item.zipcode, addressObject.zipcode, locationParts.zip, slice.zip),
    description: pick(item.description, item.agent_broker),
    neighborhood: pick(item.neighborhood, addressObject.neighborhood, item.neighborhood_name, item.subdivision, item.hood),
    property_type: titleizeType(pick(item.property_type, item.propertyType, item.homeType, item.home_type, slice.propertyTypeLabel)),
    features: pick(listText(item.features), listText(item.amenities), item.whatILove),
    days_on_market: digits(pick(dates.market_days, item.days_on_market, item.daysOnZillow, item.timeOnZillow)),
    photo_url: normalizePhotoUrl(item),
    sqft: digits(pick(area.floor, area.floor_text, item.sqft, item.livingArea, item.livingAreaValue, item.living_area)),
    year_built: digits(pick(item.year_built, item.yearBuilt)),
    status: statusFromItem(item, slice),
    listing_url: normalizeListingUrl(item),
    agent_name: pick(item.agent_name, item.agentName, contact.agent, contact.agency, attribution.agentName, attribution.brokerName),
    agent_email: pick(item.agent_email, item.agentEmail, contact.email, attribution.agentEmail),
  };
  return Object.fromEntries(PROPERTIES_HEADERS.map((header) => [header, row[header] || ""])) as SheetRow;
}

function queryText(criteria: PropertySearchCriteria): string {
  return [criteria.query, criteria.area, criteria.reference?.address, criteria.reference?.city, criteria.reference?.zip]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

function locationFromCriteria(criteria: PropertySearchCriteria): string {
  const text = queryText(criteria);
  const zip = text.match(/\b78\d{3}\b/)?.[0];
  if (zip) return `${zip}, TX`;
  const area = clean(criteria.area || criteria.reference?.neighborhood || criteria.reference?.city);
  if (!area) return process.env.PROPERTY_APIFY_FALLBACK_DEFAULT_LOCATION || "Austin, TX";
  if (/\b(tx|texas)\b/i.test(area) || /\b\d{5}\b/.test(area)) return area;
  return `${area}, TX`;
}

function listingTypeFromCriteria(criteria: PropertySearchCriteria): string {
  return /\b(rent|rental|lease|apartment|monthly)\b/i.test(queryText(criteria)) ? "for_rent" : "for_sale";
}

function propertyTypeFromCriteria(criteria: PropertySearchCriteria): string {
  const text = queryText(criteria);
  if (/\b(apartment|apt|rental)\b/i.test(text)) return "apartment";
  if (/\b(condo)\b/i.test(text)) return "condo";
  if (/\b(townhome|townhouse)\b/i.test(text)) return "townhouse";
  if (/\b(house|home|single family|single-family)\b/i.test(text)) return "house";
  return "residential";
}

export function buildApifySearchPayloadFromCriteria(
  query: string | PropertySearchCriteria,
  maxResults = intEnv("PROPERTY_APIFY_FALLBACK_MAX_RESULTS", 5, 1, 10),
): Record<string, unknown> {
  const criteria = criteriaFromQuery(query);
  const payload: Record<string, unknown> = {
    country: "United States",
    location: locationFromCriteria(criteria),
    listing_type: listingTypeFromCriteria(criteria),
    max_results: Math.max(1, Math.min(10, maxResults)),
    property_type: propertyTypeFromCriteria(criteria),
  };
  if (process.env.APIFY_ZILLOW_SEARCH_EXTRA_JSON) {
    return { ...payload, ...JSON.parse(process.env.APIFY_ZILLOW_SEARCH_EXTRA_JSON) };
  }
  return payload;
}

export function propertyApifyFallbackEnabled(channel?: string): boolean {
  if (!boolEnv("PROPERTY_APIFY_FALLBACK_ENABLED")) return false;
  if (channel === "voice" && !boolEnv("PROPERTY_APIFY_FALLBACK_VOICE_ENABLED")) return false;
  return Boolean(process.env.APIFY_TOKEN);
}

async function runApifySearchActor(payload: Record<string, unknown>): Promise<unknown[]> {
  const token = process.env.APIFY_TOKEN || "";
  if (!token) return [];
  const actor = process.env.APIFY_ZILLOW_SEARCH_ACTOR || DEFAULT_ACTOR;
  const timeoutSeconds = intEnv("PROPERTY_APIFY_FALLBACK_TIMEOUT_SECONDS", 25, 5, 60);
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeoutSeconds}&memory=1024`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (timeoutSeconds + 5) * 1000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Apify ${actor} failed (${response.status}): ${text.slice(0, 500)}`);
    const parsed = JSON.parse(text || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeProperties(rows: SheetRow[]): SheetRow[] {
  const seen = new Set<string>();
  const unique: SheetRow[] = [];
  for (const row of rows) {
    const listingUrl = clean(row.listing_url).toLowerCase();
    const listingKey = listingUrl && listingUrl !== "https://www.zillow.com/" ? listingUrl : "";
    const key = clean(row.address).toLowerCase().replace(/[^a-z0-9#]+/g, " ") || listingKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

export async function searchAndImportMissingProperties(
  input: ApifyFallbackInput,
  deps: ApifyFallbackDeps = {},
): Promise<SheetRow[]> {
  const channel = input.channel || "unknown";
  if (!propertyApifyFallbackEnabled(channel) && !deps.runActor) return [];

  const maxResults = Math.max(1, Math.min(input.limit || intEnv("PROPERTY_APIFY_FALLBACK_MAX_RESULTS", 5, 1, 10), 10));
  const criteria = criteriaFromQuery(input.query);
  const payload = buildApifySearchPayloadFromCriteria(criteria, maxResults);
  const slice = {
    city: String(payload.location || "").split(",")[0] || "Austin",
    state: "TX",
    listingLabel: String(payload.listing_type || ""),
    propertyTypeLabel: String(payload.property_type || ""),
  };

  try {
    const items = await (deps.runActor || runApifySearchActor)(payload);
    const rows = dedupeProperties(
      items
        .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
        .map((item) => normalizeApifyItemToProperty(item, slice))
        .filter((row) => row.address && propertyMatchesCriteria(row, criteria))
        .slice(0, maxResults),
    );
    const imported: SheetRow[] = [];
    for (const row of rows) {
      const saved = await (deps.upsert || upsertPropertyToDatabase)(row, input.source || `apify_fallback_${channel}`);
      if (!saved) continue;
      imported.push(saved);
      if (boolEnv("PROPERTY_APIFY_FALLBACK_SYNC_SHEETS")) {
        await (deps.appendSheet || appendPropertyToSheets)(saved).catch((error) => {
          console.warn("property_apify_fallback_sheet_sync_failed", {
            channel,
            address: saved.address,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        });
      }
    }
    console.info("property_apify_fallback_complete", { channel, count: imported.length, payload });
    return imported;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("property_apify_fallback_failed", { channel, error: message, payload });
    return [];
  }
}
