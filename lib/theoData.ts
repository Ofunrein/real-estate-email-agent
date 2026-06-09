import type { SheetRow } from "@/lib/sheetSchema";

type TheoEnrichedData = {
  properties: SheetRow[];
  context: string;
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

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function truthy(value?: string): boolean {
  return Boolean(clean(value));
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

function formatCurrency(value?: string): string {
  const numeric = clean(value).replace(/[^\d.]/g, "");
  if (!numeric) return clean(value);
  const amount = Number(numeric);
  return Number.isFinite(amount) ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : clean(value);
}

function extractAddress(...values: string[]): string {
  const text = values.map(clean).filter(Boolean).join(" ");
  const streetPattern = STREET_TERMS.join("|");
  const match = text.match(new RegExp(`\\b\\d{2,6}\\s+[A-Za-z0-9 .#-]+?\\s(?:${streetPattern})\\b(?:\\s+(?:unit|apt|#)\\s*[A-Za-z0-9-]+)?(?:,?\\s+[A-Za-z .]+)?(?:,?\\s+TX|,?\\s+Texas)?(?:\\s+\\d{5})?`, "i"));
  return clean(match?.[0] || "");
}

function mergeProperty(base: SheetRow, extra: Partial<SheetRow>): SheetRow {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (!truthy(merged[key]) && value != null && truthy(String(value))) {
      merged[key] = String(value);
    }
  }
  return merged;
}

function needsPropertyEnrichment(property: SheetRow): boolean {
  return !property.photo_url || !property.sqft || !property.year_built || !property.zip || !property.description;
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

async function runApifyActor(actorId: string, payload: Record<string, unknown>, timeoutSeconds = 60): Promise<Record<string, unknown>> {
  const token = apifyToken();
  if (!token) return {};
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeoutSeconds}&memory=512`;
  const data = await getJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, (timeoutSeconds + 20) * 1000);
  const items = Array.isArray(data) ? data : [];
  return (items[0] || {}) as Record<string, unknown>;
}

function photoFromApify(item: Record<string, unknown>): string {
  const photos = Array.isArray(item.responsivePhotos) ? item.responsivePhotos as Record<string, unknown>[] : [];
  const realPhoto = photos.find((photo) => typeof photo.url === "string" && !photo.url.includes("maps.googleapis"))?.url;
  const streetPhoto = photos.find((photo) => typeof photo.url === "string")?.url;
  return clean(String(realPhoto || streetPhoto || item.imgSrc || item.hiResImageLink || item.desktopWebHdpImageLink || item.image || item.photo || item.primaryPhoto || ""));
}

async function fetchApifyZillow(address: string): Promise<{ property: Partial<SheetRow>; context: string }> {
  if (!apifyToken() || !address) return { property: {}, context: "" };
  let item = await runApifyActor("ENK9p4RZHg0iVso52", { addresses: [address] });
  if (!Object.keys(item).length) {
    item = await runApifyActor("kawsar~Affordable-Zillow-Details-Scraper", { address: [address], maxItems: 1, requestTimeoutSecs: 25, timeoutSecs: 55 });
  }
  if (!Object.keys(item).length) return { property: {}, context: "" };
  const nearby = Array.isArray(item.nearbyNeighborhoods) ? item.nearbyNeighborhoods as Record<string, unknown>[] : [];
  const property = {
    address: String(item.streetAddress || address),
    city: String(item.city || ""),
    state: String(item.state || ""),
    zip: String(item.zipcode || ""),
    price: String(item.price || ""),
    beds: String(item.bedrooms || ""),
    baths: String(item.bathrooms || ""),
    sqft: String(item.livingArea || item.livingAreaValue || ""),
    year_built: String(item.yearBuilt || ""),
    neighborhood: String(nearby[0]?.name || ""),
    property_type: String(item.homeType || "").replace(/_/g, " ").toLowerCase(),
    days_on_market: String(item.daysOnZillow || ""),
    photo_url: photoFromApify(item),
    description: String(item.description || ""),
    status: String(item.homeStatus || "Active").replace(/_/g, " ").toLowerCase(),
    listing_url: item.hdpUrl ? `https://www.zillow.com${item.hdpUrl}` : "",
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
  const context: string[] = [];
  const properties = [...(input.properties || [])];
  const first = properties[0] || {};
  const address = clean(first.address || extractAddress(input.propertyInterest || "", input.message, input.lead?.property_interest || ""));

  if (address && (!properties.length || needsPropertyEnrichment(first))) {
    const [apify, rentcast] = await Promise.allSettled([
      fetchApifyZillow(address),
      fetchRentCast(address),
    ]);
    const apifyData = apify.status === "fulfilled" ? apify.value : { property: {}, context: "" };
    const rentcastData = rentcast.status === "fulfilled" ? rentcast.value : { property: {}, context: "" };
    const merged = mergeProperty(mergeProperty(first, rentcastData.property), apifyData.property);
    if (Object.keys(merged).length) {
      if (properties.length) properties[0] = merged;
      else properties.push(merged);
    }
    if (apifyData.context) context.push(apifyData.context);
    if (rentcastData.context) context.push(rentcastData.context);
  }

  const enrichedFirst = properties[0] || first;
  const [rates, census, comps] = await Promise.allSettled([
    fetchMortgageRates(),
    fetchCensusZip(enrichedFirst.zip),
    fetchSoldComps(enrichedFirst, input.message),
  ]);
  for (const result of [rates, census, comps]) {
    if (result.status === "fulfilled" && result.value) context.push(result.value);
  }

  return {
    properties,
    context: context.join("\n"),
  };
}
