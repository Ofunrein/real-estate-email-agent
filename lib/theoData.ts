import type { SheetRow } from "@/lib/sheetSchema";
import { CENTRAL_TEXAS_SEARCH_AREAS } from "@/lib/serviceAreas";
import { elapsedMs, nowMs, type TheoMetric } from "@/lib/theoTelemetry";

type TheoEnrichedData = {
  properties: SheetRow[];
  context: string;
  metrics: TheoMetric[];
  elapsedMs: number;
  costUsd: number;
};

const SOLD_COMP_TERMS = [
  "good price",
  "good deal",
  "bad deal",
  "overpriced",
  "underpriced",
  "fair price",
  "worth it",
  "market value",
  "appraised value",
  "comps",
  "comparable",
  "nearby sales",
  "recent sales",
  "how does it compare",
  "compare to",
];

const STREET_TERMS = [
  "st",
  "street",
  "dr",
  "drive",
  "rd",
  "road",
  "ave",
  "avenue",
  "blvd",
  "boulevard",
  "ln",
  "lane",
  "way",
  "ct",
  "court",
  "cir",
  "circle",
  "trl",
  "trail",
  "path",
  "cv",
  "cove",
];

const PROPERTY_SEARCH_AREAS = CENTRAL_TEXAS_SEARCH_AREAS;

export type TheoPropertySearchIntent = {
  query: string;
  area?: string;
  beds?: number;
  baths?: number;
  minPrice?: number;
  maxPrice?: number;
  mode: "general" | "similar" | "neighboring";
};

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function truthy(value?: string): boolean {
  return Boolean(clean(value));
}

function parseAddressParts(address: string): Partial<SheetRow> {
  const text = clean(address).replace(/\bUnited States\b/gi, "").trim();
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || "";
  const state = text.match(/\b(TX|Texas)\b/i)?.[1]?.replace(/^Texas$/i, "TX") || "";
  const beforeState = clean(text.replace(/\b(TX|Texas)\b.*$/i, "").replace(/[,\s]+$/, ""));
  const commaParts = beforeState.split(",").map(clean).filter(Boolean);
  const streetMatch = beforeState.match(/^(.+?\b(?:st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|cir|circle|trl|trail|path|cv|cove)\b)\s+(.+)$/i);
  const street = commaParts[0] || streetMatch?.[1] || beforeState || text;
  const city = commaParts.length > 1 ? commaParts[1] : clean(streetMatch?.[2] || "");
  return {
    address: [street, city, state].filter(Boolean).join(", ") + (zip ? ` ${zip}` : ""),
    city,
    state,
    zip,
  };
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

async function getJson(url: string, init: RequestInit = {}, timeoutMs = 7000): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: timeoutSignal(timeoutMs) });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function measuredDataCall<T>(
  label: string,
  service: string,
  fn: () => Promise<T>,
  costOnContext = 0,
): Promise<{ value: T; metric: TheoMetric }> {
  const started = nowMs();
  try {
    const value = await fn();
    const hasContext = typeof value === "string"
      ? truthy(value)
      : Boolean(value && typeof value === "object" && "context" in value && truthy(String((value as { context?: string }).context)));
    return {
      value,
      metric: {
        service,
        label,
        status: hasContext ? "found" : "no_data",
        elapsedMs: elapsedMs(started),
        costUsd: hasContext ? costOnContext : 0,
      },
    };
  } catch (error) {
    return {
      value: "" as T,
      metric: {
        service,
        label,
        status: "failed",
        elapsedMs: elapsedMs(started),
        costUsd: 0,
        detail: error instanceof Error ? error.message : "data call failed",
      },
    };
  }
}

function formatCurrency(value?: string): string {
  const numeric = clean(value).replace(/[^\d.]/g, "");
  if (!numeric) return clean(value);
  const amount = Number(numeric);
  return Number.isFinite(amount) ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : clean(value);
}

export function extractTheoAddress(...values: string[]): string {
  return extractTheoAddresses(...values)[0] || "";
}

export function extractTheoAddresses(...values: string[]): string[] {
  const text = values.map(clean).filter(Boolean).join(" ");
  const streetPattern = STREET_TERMS.join("|");
  const pattern = new RegExp(`\\b\\d{2,6}\\s+[A-Za-z0-9 .#-]+?\\s(?:${streetPattern})\\b(?:\\s+(?:unit|apt|#)\\s*[A-Za-z0-9-]+)?(?:,?\\s+[A-Za-z .]+)?(?:,?\\s+TX|,?\\s+Texas)?(?:\\s+\\d{5})?`, "gi");
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const address = clean(match[0].replace(/[.,;:]+$/, ""));
    const key = address.toLowerCase();
    if (!address || seen.has(key)) continue;
    seen.add(key);
    addresses.push(address);
  }
  return addresses;
}

export function extractTheoPropertySearchQuery(...values: string[]): string {
  const text = values.map(clean).filter(Boolean).join(" ");
  const address = extractTheoAddress(text);
  if (address) return address;
  const area = findPropertySearchArea(...values);
  return area || clean(values.find((value) => truthy(value)) || "");
}

function findPropertySearchArea(...values: string[]): string {
  const sortedAreas = [...PROPERTY_SEARCH_AREAS].sort((a, b) => b.length - a.length);
  for (const value of values) {
    const lower = clean(value).toLowerCase();
    const area = sortedAreas.find((candidate) => new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase()}\\b`, "i").test(lower));
    if (area) return area;
  }
  return "";
}

function parsePriceTerm(text: string, direction: "min" | "max"): number | undefined {
  const pattern = direction === "max"
    ? /\b(?:under|below|less than|max|maximum|up to)\s+\$?\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?\b/i
    : /\b(?:over|above|more than|min|minimum|at least)\s+\$?\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?\b/i;
  const match = text.match(pattern);
  if (!match) return undefined;
  let amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const suffix = match[2] || "";
  if (/^m|million/i.test(suffix)) amount *= 1_000_000;
  if (/^k|thousand/i.test(suffix)) amount *= 1_000;
  return amount;
}

function parseCountTerm(text: string, kind: "bed" | "bath"): number | undefined {
  const pattern = kind === "bed"
    ? /\b(\d+(?:\.\d+)?)\s*(?:bed|beds|bd|br|bedroom|bedrooms)\b/i
    : /\b(\d+(?:\.\d+)?)\s*(?:bath|baths|ba|bathroom|bathrooms)\b/i;
  const match = text.match(pattern);
  const amount = match ? Number(match[1]) : NaN;
  return Number.isFinite(amount) ? amount : undefined;
}

function normalizeAreaName(area?: string): string {
  if (!area) return "";
  if (/^flugerville$/i.test(area)) return "Pflugerville";
  if (/^(greater austin|austin metro|austin area|central texas)$/i.test(area)) return "Greater Austin";
  return area;
}

function propertySearchMode(text: string): TheoPropertySearchIntent["mode"] {
  if (/\b(neighboring|neighbor|nearby|next to|around it|around that|close to it|close by)\b/i.test(text)) return "neighboring";
  if (/\b(similar|same spec|same specs|same size|same price|close to (?:the )?(?:\d+\s*)?(?:bed|bd|bedroom|layout)|\d+\s*(?:bed|bd|bedroom).{0,40}layout|something close|comparable|alternatives?|other options?)\b/i.test(text)) return "similar";
  return "general";
}

export function extractTheoPropertySearchIntent(...values: string[]): TheoPropertySearchIntent {
  const text = values.map(clean).filter(Boolean).join(" ");
  const query = extractTheoPropertySearchQuery(...values);
  const area = findPropertySearchArea(...values);
  return {
    query,
    area: normalizeAreaName(area),
    beds: parseCountTerm(text, "bed"),
    baths: parseCountTerm(text, "bath"),
    minPrice: parsePriceTerm(text, "min"),
    maxPrice: parsePriceTerm(text, "max"),
    mode: propertySearchMode(text),
  };
}

export function extractTheoListedPropertyAddresses(...values: string[]): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const value of values) {
    for (const rawLine of String(value || "").split(/\n+/)) {
      const line = clean(rawLine.replace(/^\d+\.\s*/, ""));
      const addressText = clean(line.split(/\s[-–]\s/)[0] || "");
      for (const address of extractTheoAddresses(addressText)) {
        const key = address.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        addresses.push(address);
      }
    }
  }
  return addresses;
}

function mergeProperty(base: SheetRow, extra: Partial<SheetRow>): SheetRow {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || !truthy(String(value))) continue;
    const incoming = String(value);
    if (!truthy(merged[key]) || shouldReplacePropertyValue(key, merged[key], incoming)) {
      merged[key] = incoming;
    }
  }
  return merged;
}

function needsPropertyEnrichment(property: SheetRow): boolean {
  return !property.photo_url || isGoogleStreetViewUrl(property.photo_url) || hasGenericNeighborhood(property.neighborhood) || !property.sqft || !property.year_built || !property.zip || !property.description;
}

function isGoogleStreetViewUrl(value?: string): boolean {
  return /maps\.googleapis\.com\/maps\/api\/streetview/i.test(clean(value));
}

function hasGenericNeighborhood(value?: string): boolean {
  return /^(downtown|unknown|n\/a)$/i.test(clean(value));
}

function shouldReplacePropertyValue(key: string, current: string | undefined, incoming: string): boolean {
  if (key === "photo_url" && isGoogleStreetViewUrl(current) && !isGoogleStreetViewUrl(incoming)) return true;
  if (key === "listing_url" && /zillow\.com/i.test(incoming) && !/zillow\.com/i.test(clean(current))) return true;
  if (key === "neighborhood" && hasGenericNeighborhood(current) && truthy(incoming)) return true;
  if (key === "property_type" && /^(home type unknown|unknown|n\/a)$/i.test(clean(current)) && truthy(incoming)) return true;
  if (["price", "beds", "baths", "sqft", "year_built", "description", "agent_name", "agent_email"].includes(key) && truthy(incoming) && !truthy(current)) return true;
  return false;
}

function wantsPropertyImage(message: string): boolean {
  return /\b(photo|photos|picture|pictures|image|images|pic|pics|look like|see it|show me)\b/i.test(message);
}

function googleStreetViewProperty(address: string): { property: Partial<SheetRow>; context: string } {
  const key = process.env.GOOGLE_MAPS_API_KEY || "";
  if (!key || !address) return { property: {}, context: "" };
  const photoUrl = `https://maps.googleapis.com/maps/api/streetview?location=${encodeURIComponent(address)}&size=640x480&key=${encodeURIComponent(key)}`;
  const property = {
    ...parseAddressParts(address),
    photo_url: photoUrl,
    status: "lookup photo",
  };
  return {
    property,
    context: `Google Street View fallback prepared for ${address}.`,
  };
}

function timeoutFallbackData(input: {
  message: string;
  lead?: Partial<SheetRow>;
  properties?: SheetRow[];
  propertyInterest?: string;
}, started: number, budgetMs: number): TheoEnrichedData {
  const properties = [...(input.properties || [])];
  const address = clean(properties[0]?.address || extractTheoAddress(input.propertyInterest || "", input.message, input.lead?.property_interest || ""));
  const context: string[] = [];
  if (address && !properties.some((property) => truthy(property.photo_url))) {
    const fallback = googleStreetViewProperty(address);
    if (Object.keys(fallback.property).length) {
      if (properties.length) properties[0] = mergeProperty(properties[0], fallback.property);
      else properties.push(fallback.property as SheetRow);
      if (fallback.context) context.push(fallback.context);
    }
  }
  return {
    properties,
    context: context.join("\n"),
    metrics: [{
      service: "enrichment",
      label: "theo_enrichment_budget",
      status: "timeout",
      elapsedMs: elapsedMs(started),
      costUsd: 0,
      detail: `budget=${budgetMs}ms`,
    }],
    elapsedMs: elapsedMs(started),
    costUsd: 0,
  };
}

async function fetchRentCast(address: string): Promise<{ property: Partial<SheetRow>; context: string }> {
  const key = process.env.RENTCAST_API_KEY || "";
  if (!key || !address) return { property: {}, context: "" };
  const params = new URLSearchParams({ address, limit: "1" });
  const data = await getJson(`https://api.rentcast.io/v1/properties?${params.toString()}`, {
    headers: { "X-Api-Key": key },
  }, 9000);
  const item = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (!item) return { property: {}, context: "" };
  const property = {
    address: String(item.addressLine1 || address),
    city: String(item.city || ""),
    state: String(item.state || ""),
    zip: String(item.zipCode || ""),
    price: String(item.price || ""),
    beds: String(item.bedrooms || ""),
    baths: String(item.bathrooms || ""),
    sqft: String(item.squareFootage || item.livingArea || ""),
    year_built: String(item.yearBuilt || ""),
    photo_url: String(item.photoUrl || ""),
    status: String(item.status || ""),
  };
  return {
    property,
    context: `RentCast property enrichment found: ${Object.entries(property).filter(([, value]) => truthy(value)).map(([key, value]) => `${key}=${value}`).join(", ")}`,
  };
}

function apifyToken(): string {
  return process.env.APIFY_TOKEN || "";
}

async function runApifyActor(actorId: string, payload: Record<string, unknown>, timeoutSeconds = Number(process.env.THEO_APIFY_TIMEOUT_SECONDS || "12")): Promise<Record<string, unknown>> {
  const token = apifyToken();
  if (!token) return {};
  const actorTimeout = Math.max(3, Number(timeoutSeconds || 8));
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${actorTimeout}&memory=512`;
  const data = await getJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, (actorTimeout + 2) * 1000);
  const items = Array.isArray(data) ? data : [];
  return (items[0] || {}) as Record<string, unknown>;
}

function photoFromApify(item: Record<string, unknown>): string {
  const photos = Array.isArray(item.responsivePhotos) ? item.responsivePhotos as Record<string, unknown>[] : [];
  const realPhoto = photos.find((photo) => typeof photo.url === "string" && /photos\.zillowstatic\.com/i.test(photo.url))?.url;
  const primaryImage = [item.imgSrc, item.hiResImageLink, item.desktopWebHdpImageLink, item.image, item.photo, item.primaryPhoto]
    .map((value) => clean(String(value || "")))
    .find((url) => /photos\.zillowstatic\.com/i.test(url));
  return clean(String(realPhoto || primaryImage || ""));
}

function zillowListingUrl(item: Record<string, unknown>): string {
  const hdpUrl = clean(String(item.hdpUrl || item.detailUrl || item.url || ""));
  if (/^https:\/\/(?:www\.)?zillow\.com\//i.test(hdpUrl)) return hdpUrl;
  if (hdpUrl.startsWith("/")) return `https://www.zillow.com${hdpUrl}`;
  const zpid = clean(String(item.zpid || ""));
  return zpid ? `https://www.zillow.com/homedetails/${zpid}_zpid/` : "";
}

async function fetchApifyZillow(address: string): Promise<{ property: Partial<SheetRow>; context: string }> {
  if (!apifyToken() || !address) return { property: {}, context: "" };
  let item = await runApifyActor("kawsar~Affordable-Zillow-Details-Scraper", { address: [address], maxItems: 1, requestTimeoutSecs: 25, timeoutSecs: 55 }, 22);
  if (!Object.keys(item).length) {
    item = await runApifyActor("ENK9p4RZHg0iVso52", { addresses: [address] });
  }
  if (!Object.keys(item).length) return { property: {}, context: "" };
  const nearby = Array.isArray(item.nearbyNeighborhoods) ? item.nearbyNeighborhoods as Record<string, unknown>[] : [];
  const zillowAddress = item.address && typeof item.address === "object" ? item.address as Record<string, unknown> : {};
  const attributionInfo = item.attributionInfo && typeof item.attributionInfo === "object" ? item.attributionInfo as Record<string, unknown> : {};
  const property = {
    address: String(item.streetAddress || zillowAddress.streetAddress || address),
    city: String(item.city || zillowAddress.city || ""),
    state: String(item.state || zillowAddress.state || ""),
    zip: String(item.zipcode || zillowAddress.zipcode || ""),
    price: String(item.price || ""),
    beds: String(item.bedrooms || ""),
    baths: String(item.bathrooms || ""),
    sqft: String(item.livingArea || item.livingAreaValue || ""),
    year_built: String(item.yearBuilt || ""),
    neighborhood: String(zillowAddress.neighborhood || zillowAddress.subdivision || nearby[0]?.name || ""),
    property_type: String(item.homeType || "").replace(/_/g, " ").toLowerCase(),
    days_on_market: String(item.daysOnZillow || ""),
    photo_url: photoFromApify(item),
    description: String(item.description || ""),
    status: String(item.homeStatus || "Active").replace(/_/g, " ").toLowerCase(),
    listing_url: zillowListingUrl(item),
    agent_name: String(attributionInfo.agentName || attributionInfo.brokerName || ""),
    agent_phone: String(attributionInfo.agentPhoneNumber || attributionInfo.brokerPhoneNumber || ""),
  };
  return {
    property,
    context: `Apify Zillow enrichment found: ${Object.entries(property).filter(([, value]) => truthy(value)).map(([key, value]) => `${key}=${clean(value).slice(0, 140)}`).join(", ")}`,
  };
}

async function fetchMortgageRates(): Promise<string> {
  const key = process.env.FRED_API_KEY || "abcdefghijklmnopqrstuvwxyz012345";
  const series = [
    ["30yr fixed", "MORTGAGE30US"],
    ["15yr fixed", "MORTGAGE15US"],
  ];
  const rates = await Promise.all(series.map(async ([label, seriesId]) => {
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: key,
      file_type: "json",
      limit: "1",
      sort_order: "desc",
    });
    const data = await getJson(`https://api.stlouisfed.org/fred/series/observations?${params.toString()}`, {}, 6000) as Record<string, unknown> | null;
    const observations = Array.isArray(data?.observations) ? data.observations as Record<string, unknown>[] : [];
    const value = observations[0]?.value;
    return value ? `${label} ${value}%` : "";
  }));
  const cleanRates = rates.filter(Boolean);
  return cleanRates.length ? `Current mortgage rate context from FRED: ${cleanRates.join(", ")}.` : "";
}

async function fetchCensusZip(zip?: string): Promise<string> {
  const key = process.env.CENSUS_API_KEY || "";
  if (!key || !zip) return "";
  const params = new URLSearchParams({
    get: "B19013_001E,B01003_001E",
    for: `zip code tabulation area:${zip}`,
    key,
  });
  const data = await getJson(`https://api.census.gov/data/2022/acs/acs5?${params.toString()}`, {}, 6000);
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) return "";
  const [income, population] = data[1] as string[];
  const incomeText = income && income !== "-666666666" ? `$${Number(income).toLocaleString("en-US")}` : "";
  const populationText = population ? Number(population).toLocaleString("en-US") : "";
  return [incomeText ? `median_income=${incomeText}` : "", populationText ? `population=${populationText}` : ""]
    .filter(Boolean)
    .join(", ")
    .replace(/^/, `Census ZIP ${zip} context: `);
}

async function fetchSoldComps(property: SheetRow, message: string): Promise<string> {
  const actorId = process.env.APIFY_SOLD_COMPS_ACTOR_ID || "";
  const maxResults = Math.max(0, Math.min(2, Number(process.env.SOLD_COMPS_MAX_RESULTS || "2")));
  const wantsComps = SOLD_COMP_TERMS.some((term) => message.toLowerCase().includes(term));
  if (!apifyToken() || !actorId || !maxResults || !wantsComps || !property.zip || !property.price) return "";
  const item = await runApifyActor(actorId, {
    search: property.zip,
    mode: "SOLD",
    maxItems: maxResults,
    scrapeDetails: false,
  });
  if (!Object.keys(item).length) return "";
  const address = String(item.address || item.streetAddress || item.formattedAddress || "");
  const price = formatCurrency(String(item.price || item.soldPrice || item.unformattedPrice || ""));
  const beds = String(item.beds || item.bedrooms || "");
  const baths = String(item.baths || item.bathrooms || "");
  const sqft = String(item.livingArea || item.sqft || item.area || "");
  const soldDate = String(item.dateSold || item.soldDate || item.soldOn || "");
  return `Recently sold comp context: ${[address, price, beds ? `${beds} beds` : "", baths ? `${baths} baths` : "", sqft ? `${sqft} sqft` : "", soldDate ? `sold ${soldDate}` : ""].filter(Boolean).join(", ")}.`;
}

export async function enrichTheoData(input: {
  message: string;
  lead?: Partial<SheetRow>;
  properties?: SheetRow[];
  propertyInterest?: string;
}): Promise<TheoEnrichedData> {
  const started = nowMs();
  const budgetMs = Math.max(1000, Number(process.env.THEO_ENRICHMENT_TIMEOUT_MS || "14000"));
  return Promise.race([
    runTheoDataEnrichment(input),
    new Promise<TheoEnrichedData>((resolve) => {
      setTimeout(() => resolve(timeoutFallbackData(input, started, budgetMs)), budgetMs).unref?.();
    }),
  ]);
}

async function runTheoDataEnrichment(input: {
  message: string;
  lead?: Partial<SheetRow>;
  properties?: SheetRow[];
  propertyInterest?: string;
}): Promise<TheoEnrichedData> {
  const started = nowMs();
  const context: string[] = [];
  const metrics: TheoMetric[] = [];
  const properties = [...(input.properties || [])];
  const first = properties[0] || {};
  const address = clean(first.address || extractTheoAddress(input.propertyInterest || "", input.message, input.lead?.property_interest || ""));
  const cachedPhotoReady = properties.length > 0 && truthy(first.photo_url) && !isGoogleStreetViewUrl(first.photo_url) && !hasGenericNeighborhood(first.neighborhood) && wantsPropertyImage(input.message);
  const emptyEnrichment = { property: {}, context: "" };

  if (address && !cachedPhotoReady && (!properties.length || needsPropertyEnrichment(first))) {
    const [apify, rentcast] = await Promise.allSettled([
      measuredDataCall("apify_zillow_lookup", "apify", () => fetchApifyZillow(address), 0.003),
      measuredDataCall("rentcast_property_lookup", "rentcast", () => fetchRentCast(address)),
    ]);
    const apifyValue = apify.status === "fulfilled" ? apify.value.value : emptyEnrichment;
    const rentcastValue = rentcast.status === "fulfilled" ? rentcast.value.value : emptyEnrichment;
    const apifyData = typeof apifyValue === "object" && apifyValue && "property" in apifyValue ? apifyValue : emptyEnrichment;
    const rentcastData = typeof rentcastValue === "object" && rentcastValue && "property" in rentcastValue ? rentcastValue : emptyEnrichment;
    if (apify.status === "fulfilled") metrics.push(apify.value.metric);
    if (rentcast.status === "fulfilled") metrics.push(rentcast.value.metric);
    const merged = mergeProperty(mergeProperty(first, rentcastData.property), apifyData.property);
    const streetViewData = !truthy(merged.photo_url) ? googleStreetViewProperty(address) : emptyEnrichment;
    const mergedWithFallback = mergeProperty(merged, streetViewData.property);
    if (Object.keys(mergedWithFallback).length) {
      if (properties.length) properties[0] = mergedWithFallback;
      else properties.push(mergedWithFallback);
    }
    if (apifyData.context) context.push(apifyData.context);
    if (rentcastData.context) context.push(rentcastData.context);
    if (streetViewData.context) context.push(streetViewData.context);
  }

  const enrichedFirst = properties[0] || first;
  if (wantsPropertyImage(input.message)) {
    const costUsd = metrics.reduce((total, metric) => total + (metric.costUsd || 0), 0);
    return {
      properties,
      context: context.join("\n"),
      metrics,
      elapsedMs: elapsedMs(started),
      costUsd,
    };
  }

  const [rates, census, comps] = await Promise.allSettled([
    measuredDataCall("fred_mortgage_rates", "fred", () => fetchMortgageRates()),
    measuredDataCall("census_zip_stats", "census", () => fetchCensusZip(enrichedFirst.zip)),
    measuredDataCall("apify_sold_comps", "apify", () => fetchSoldComps(enrichedFirst, input.message), 0.003),
  ]);
  for (const result of [rates, census, comps]) {
    if (result.status === "fulfilled") {
      metrics.push(result.value.metric);
      if (result.value.value) context.push(result.value.value);
    }
  }

  const costUsd = metrics.reduce((total, metric) => total + (metric.costUsd || 0), 0);
  return {
    properties,
    context: context.join("\n"),
    metrics,
    elapsedMs: elapsedMs(started),
    costUsd,
  };
}
