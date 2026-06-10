// Voice data layer for Aria. A live caller cannot tolerate the ~10s a cold
// Zillow scrape can take, so lookups are cache-first with a tight budget:
//   1. read the property cache (instant)
//   2. start full enrichment, race it against ARIA_ENRICHMENT_TIMEOUT_MS
//   3. if enrichment wins, speak the fresh facts
//   4. if the budget expires, speak what we have (or "pulling it up") AND let
//      the enrichment finish in the background, then text the caller the full
//      details via Theo's SMS sender — the data still reaches them.
//
// All IO is injected (AriaDataDeps) so this is unit-testable with no DB,
// network, or real timers.

import {
  findCandidatePropertiesFromDatabase,
  findPropertiesByAddressesFromDatabase,
  upsertPropertyToDatabase,
  type PropertySearchCriteria,
} from "@/lib/database";
import { enrichTheoData } from "@/lib/theoData";
import { sendTheoSms } from "@/lib/twilioSms";
import type { SheetRow } from "@/lib/sheetSchema";

export type AriaDataDeps = {
  findByAddresses: (addresses: string[], limit?: number) => Promise<SheetRow[]>;
  enrich: (input: {
    message: string;
    lead?: Partial<SheetRow>;
    properties?: SheetRow[];
    propertyInterest?: string;
  }) => Promise<{ properties: SheetRow[]; context: string }>;
  cacheProperty: (property: Partial<SheetRow>, source?: string) => Promise<SheetRow | null>;
  sendSms: (to: string, body: string, mediaUrls?: string[]) => Promise<unknown>;
  budgetMs: number;
};

function defaultBudgetMs(): number {
  return Math.max(500, Number(process.env.ARIA_ENRICHMENT_TIMEOUT_MS || "3500"));
}

const defaultDeps: AriaDataDeps = {
  findByAddresses: findPropertiesByAddressesFromDatabase,
  enrich: enrichTheoData,
  cacheProperty: upsertPropertyToDatabase,
  sendSms: sendTheoSms,
  budgetMs: defaultBudgetMs(),
};

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function formatPrice(value?: string): string {
  const numeric = clean(value).replace(/[^\d.]/g, "");
  if (!numeric) return "";
  const amount = Number(numeric);
  return Number.isFinite(amount) ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "";
}

function formatSqft(value?: string): string {
  const sqft = Number(clean(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(sqft) && sqft > 0 ? `${sqft.toLocaleString("en-US", { maximumFractionDigits: 0 })} square feet` : "";
}

// Natural spoken sentence for a property (no markdown, no URLs — this is read aloud).
export function speakProperty(property: SheetRow): string {
  const price = formatPrice(property.price);
  const bedsBaths = property.beds && property.baths ? `${property.beds} bed, ${property.baths} bath` : "";
  const sqft = formatSqft(property.sqft);
  const where = clean(property.neighborhood) || clean(property.city);
  const facts = [
    price ? `listed at ${price}` : "",
    bedsBaths,
    sqft,
    where ? `in ${where}` : "",
  ].filter(Boolean).join(", ");
  const address = clean(property.address);
  if (!facts) return address ? `I found ${address}, but I don't have the full details handy.` : "I couldn't find that property.";
  return `${address} is ${facts}.`;
}

// Concise SMS body for the timeout fallback (full details, links allowed).
export function propertySmsBody(property: SheetRow): string {
  const bits = [
    clean(property.address),
    formatPrice(property.price),
    property.beds && property.baths ? `${property.beds}bd/${property.baths}ba` : "",
    formatSqft(property.sqft),
    clean(property.neighborhood) || clean(property.city),
  ].filter(Boolean).join(" • ");
  const link = clean(property.listing_url);
  return [`Here are the full details on ${clean(property.address) || "that property"}:`, bits, link]
    .filter(Boolean)
    .join("\n");
}

export type VoiceLookupResult = {
  properties: SheetRow[];
  spoken: string;
  timedOut: boolean;
  fromCache: boolean;
};

function delay(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms).unref?.();
  });
}

// Cache-first property lookup tuned for a live phone call.
export async function lookupPropertyForVoice(
  input: { address: string; phone?: string; message?: string; lead?: Partial<SheetRow> },
  deps: AriaDataDeps = defaultDeps,
): Promise<VoiceLookupResult> {
  const address = clean(input.address);
  if (!address) {
    return { properties: [], spoken: "What's the address you're asking about?", timedOut: false, fromCache: false };
  }

  const cached = await deps.findByAddresses([address], 1);

  const enrichPromise = deps
    .enrich({
      message: input.message || address,
      lead: input.lead,
      properties: cached,
      propertyInterest: address,
    })
    .then(async (result) => {
      const property = result.properties[0];
      if (property) await deps.cacheProperty(property, "aria_voice_lookup").catch(() => null);
      return result;
    });

  const raced = await Promise.race([
    enrichPromise.then((result) => ({ kind: "enriched" as const, result })),
    delay(deps.budgetMs).then(() => ({ kind: "timeout" as const })),
  ]);

  if (raced.kind === "enriched") {
    const property = raced.result.properties[0];
    return {
      properties: raced.result.properties,
      spoken: property ? speakProperty(property) : `I couldn't pull up ${address} just now.`,
      timedOut: false,
      fromCache: false,
    };
  }

  // Budget expired. Let enrichment finish in the background and text the result.
  if (input.phone) {
    void enrichPromise
      .then((result) => {
        const property = result.properties[0];
        if (property) return deps.sendSms(input.phone as string, propertySmsBody(property));
        return undefined;
      })
      .catch(() => undefined);
  }

  const cachedProperty = cached[0];
  if (cachedProperty) {
    return {
      properties: cached,
      spoken: `${speakProperty(cachedProperty)} I'll text you the full details right after this call.`,
      timedOut: true,
      fromCache: true,
    };
  }
  return {
    properties: [],
    spoken: `Let me pull up ${address} — I'll text you the full details right after this call.`,
    timedOut: true,
    fromCache: false,
  };
}

// Short spoken option for a search result line (no address-only fluff).
function speakSearchOption(property: SheetRow, index: number): string {
  const price = formatPrice(property.price);
  const bedsBaths = property.beds && property.baths ? `${property.beds} bed, ${property.baths} bath` : "";
  const where = clean(property.neighborhood) || clean(property.city);
  const facts = [price, bedsBaths, where].filter(Boolean).join(", ");
  return `${index + 1}. ${clean(property.address)}${facts ? `, ${facts}` : ""}`;
}

export function speakSearchResults(properties: SheetRow[]): string {
  const usable = properties.filter((property) => clean(property.address)).slice(0, 3);
  if (!usable.length) {
    return "I don't see matching listings in our system right now. I can have someone pull fresh options and follow up — want me to do that?";
  }
  const lines = usable.map((property, index) => speakSearchOption(property, index)).join(". ");
  const count = usable.length === 1 ? "one option" : `${usable.length} options`;
  return `I found ${count}: ${lines}. Want details on any of these?`;
}

export type AriaSearchDeps = {
  findCandidates: (criteria: PropertySearchCriteria, limit?: number) => Promise<SheetRow[]>;
};

const defaultSearchDeps: AriaSearchDeps = {
  findCandidates: findCandidatePropertiesFromDatabase,
};

export type VoiceSearchResult = {
  properties: SheetRow[];
  spoken: string;
};

// Property search tuned for voice: query the cache (instant) and speak the top
// matches. Cold/live area scraping is intentionally out of the live-call path.
export async function searchPropertiesForVoice(
  input: { query?: string; area?: string; beds?: number; baths?: number; minPrice?: number; maxPrice?: number },
  deps: AriaSearchDeps = defaultSearchDeps,
): Promise<VoiceSearchResult> {
  const criteria: PropertySearchCriteria = {
    query: clean(input.query) || clean(input.area),
    area: clean(input.area) || clean(input.query),
    beds: input.beds,
    baths: input.baths,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    mode: "general",
  };
  const properties = await deps.findCandidates(criteria, 3);
  return { properties, spoken: speakSearchResults(properties) };
}
