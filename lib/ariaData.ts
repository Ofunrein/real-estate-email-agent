// Voice data layer for Aria. A live caller cannot tolerate cold external
// enrichment, so the production default is DB/cache-only. Tests can inject an
// enrich dependency, but voice must not trigger Apify-style lookups by default.
//
// All IO is injected (AriaDataDeps) so this is unit-testable with no DB,
// network, or real timers.

import {
  findCandidatePropertiesFromDatabase,
  findPropertiesByAddressesFromDatabase,
  upsertPropertyToDatabase,
  type PropertySearchCriteria,
} from "@/lib/database";
import { sendTheoSms } from "@/lib/twilioSms";
import type { SheetRow } from "@/lib/sheetSchema";
import { aiSearchPropertyUrl } from "@/lib/aiSearchLinks";

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

// STT commonly mishears street suffixes (Road/Path/Drive/Way all sound similar).
// Strip the trailing suffix to get a base that matches any suffix in the DB.
// e.g. "4309 Fairway Road" → "4309 Fairway" → finds "4309 Fairway Path" ✅
const STREET_SUFFIX_RE = /\s+\b(st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|cir|circle|trl|trail|path|cv|cove|pkwy|parkway|pl|place|ter|terrace|run|loop|bend|ridge|crossing|hollow|glen|grove|hills?|valley|view|crest|canyon|falls|springs|lake|forest|woods|park|bay|pointe?)\b\.?(\s+|,|$)/i;

export function stripStreetSuffix(address: string): string {
  const normalized = clean(address);
  // Only strip if the suffix is at the end (after the street name, before city/state)
  const match = normalized.match(/^(\d+\s+\S+(?:\s+\S+)?)\s+\b(?:st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|cir|circle|trl|trail|path|cv|cove|pkwy|parkway|pl|place|ter|terrace|run|loop|bend|ridge|crossing|hollow|glen|grove|hills?|valley|view|crest|canyon|falls|springs|lake|forest|woods|park|bay|pointe?)\b/i);
  return match?.[1] || normalized;
}

function defaultBudgetMs(): number {
  return Math.max(500, Number(process.env.ARIA_ENRICHMENT_TIMEOUT_MS || "3500"));
}

async function noVoiceExternalEnrichment(input: {
  properties?: SheetRow[];
}): Promise<{ properties: SheetRow[]; context: string }> {
  return { properties: input.properties || [], context: "" };
}

const defaultDeps: AriaDataDeps = {
  findByAddresses: findPropertiesByAddressesFromDatabase,
  enrich: noVoiceExternalEnrichment,
  cacheProperty: upsertPropertyToDatabase,
  sendSms: sendTheoSms,
  budgetMs: defaultBudgetMs(),
};

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function hasMonthlySuffix(value?: string): boolean {
  return /\b(per\s*month|monthly)\b|\/\s*(mo|month)\b/i.test(clean(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function streetNumber(value?: string): string {
  return clean(value).match(/\b\d{1,6}\b/)?.[0] || "";
}

function sameStreetNumber(a?: string, b?: string): boolean {
  const left = streetNumber(a);
  const right = streetNumber(b);
  return Boolean(left && right && left === right);
}

function usefulNumericFact(value?: string): boolean {
  const numeric = clean(value).replace(/[^\d.]/g, "");
  return Boolean(numeric && Number(numeric) > 0);
}

// Guard against caching, texting, or speaking junk from failed scrapes, STT
// mangles, or prompt fragments accidentally stored as a property address.
function isUsableProperty(property: Partial<SheetRow>): property is SheetRow {
  const addr = clean(property.address);
  if (!addr || addr.length > 140) return false;
  if (!streetNumber(addr)) return false;
  if (/caller|asked|wants|more details|this property|undefined|null|message|prompt/i.test(addr)) return false;
  return Boolean(
    usefulNumericFact(property.price) ||
    usefulNumericFact(property.beds) ||
    usefulNumericFact(property.baths) ||
    usefulNumericFact(property.sqft),
  );
}

function addressCandidates(input: { address: string; message?: string; lead?: Partial<SheetRow> }): { candidates: string[]; correction: string } {
  const address = clean(input.address);
  const leadInterest = clean(input.lead?.property_interest);
  const messageAddress = clean(input.message);
  const correction = leadInterest && sameStreetNumber(address || messageAddress, leadInterest) ? leadInterest : "";
  const values = [
    address,
    correction,
    stripStreetSuffix(address),
    correction ? stripStreetSuffix(correction) : "",
  ];
  return { candidates: unique(values), correction };
}

function formatPrice(value?: string): string {
  const numeric = clean(value).replace(/[^\d.]/g, "");
  if (!numeric) return "";
  const amount = Number(numeric);
  if (!Number.isFinite(amount)) return "";
  const price = `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return hasMonthlySuffix(value) ? `${price} per month` : price;
}

function formatSqft(value?: string): string {
  const sqft = Number(clean(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(sqft) && sqft > 0 ? `${sqft.toLocaleString("en-US", { maximumFractionDigits: 0 })} square feet` : "";
}

const DIGIT_WORDS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

function speakAddress(address?: string): string {
  return clean(address).replace(/^\d+/, (digits) => digits.split("").map((digit) => DIGIT_WORDS[digit] || digit).join(" "));
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
  return `${speakAddress(address)} is ${facts}.`;
}

// Concise SMS body for the timeout fallback (full details, links allowed).
export function propertySmsBody(property: SheetRow): string {
  const bits = [
    formatPrice(property.price),
    property.beds && property.baths ? `${property.beds}bd/${property.baths}ba` : "",
    formatSqft(property.sqft),
    clean(property.neighborhood) || clean(property.city),
  ].filter(Boolean).join(" • ");
  const link = aiSearchPropertyUrl(property);
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
// STT-tolerant: if the exact address isn't in cache, tries the suffix-stripped
// form (e.g. "4309 Fairway Road" → "4309 Fairway") to survive mishearing.
export async function lookupPropertyForVoice(
  input: { address: string; phone?: string; message?: string; lead?: Partial<SheetRow> },
  deps: AriaDataDeps = defaultDeps,
): Promise<VoiceLookupResult> {
  const address = clean(input.address);
  if (!address) {
    return { properties: [], spoken: "What's the address you're asking about?", timedOut: false, fromCache: false };
  }

  const { candidates, correction } = addressCandidates(input);
  let cached: SheetRow[] = [];
  for (const candidate of candidates) {
    const matches = (await deps.findByAddresses([candidate], 3)).filter(isUsableProperty);
    if (matches.length) {
      cached = matches.slice(0, 1);
      break;
    }
  }

  const enrichAddress = cached[0]?.address || correction || address;
  const enrichPromise = deps
    .enrich({
      message: input.message || address,
      lead: input.lead,
      properties: cached,
      propertyInterest: enrichAddress,
    })
    .then(async (result) => {
      const properties = result.properties.filter(isUsableProperty);
      const property = properties[0];
      if (property) await deps.cacheProperty(property, "aria_voice_lookup").catch(() => null);
      return { ...result, properties };
    });

  const raced = await Promise.race([
    enrichPromise.then((result) => ({ kind: "enriched" as const, result })),
    delay(deps.budgetMs).then(() => ({ kind: "timeout" as const })),
  ]);

  if (raced.kind === "enriched") {
    const property = raced.result.properties[0];
    return {
      properties: raced.result.properties,
      spoken: property
        ? speakProperty(property)
        : correction && correction !== address
          ? `I heard ${address}, but your recent property is ${correction}. Did you mean ${correction}?`
          : `I don't have a confirmed match for ${address} yet. Can you confirm the full street address and city?`,
      timedOut: false,
      fromCache: false,
    };
  }

  // Budget expired. Only text if enrichment returns valid, usable data.
  if (input.phone) {
    void enrichPromise
      .then((result) => {
        const property = result.properties[0];
        if (property && isUsableProperty(property)) return deps.sendSms(input.phone as string, propertySmsBody(property));
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
    spoken: correction && correction !== address
      ? `I heard ${address}, but your recent property is ${correction}. Did you mean ${correction}?`
      : `I'm checking ${address}, but I don't have a confirmed match yet. Can you confirm the full street address and city?`,
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
  return `${index + 1}. ${speakAddress(property.address)}${facts ? `, ${facts}` : ""}`;
}

export function speakSearchResults(properties: SheetRow[]): string {
  const usable = properties.filter(isUsableProperty).slice(0, 3);
  if (!usable.length) {
    return "I don't see matching listings in our system right now. I can have someone pull fresh options and follow up — want me to do that?";
  }
  const lines = usable.map((property, index) => speakSearchOption(property, index)).join(". ");
  const count = usable.length === 1 ? "one option" : `${usable.length} options`;
  return `I found ${count}: ${lines}. Want details on any of these?`;
}

export type AriaSearchDeps = {
  findCandidates: (criteria: PropertySearchCriteria, limit?: number) => Promise<SheetRow[]>;
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

const defaultSearchDeps: AriaSearchDeps = {
  findCandidates: findCandidatePropertiesFromDatabase,
  enrich: noVoiceExternalEnrichment,
  cacheProperty: upsertPropertyToDatabase,
  sendSms: sendTheoSms,
  budgetMs: defaultBudgetMs(),
};

export type VoiceSearchResult = {
  properties: SheetRow[];
  spoken: string;
  timedOut: boolean;
  fromCache: boolean;
};

function searchSmsBody(properties: SheetRow[], criteria: string): string {
  const lines = properties
    .filter((property) => clean(property.address))
    .slice(0, 3)
    .map((property, index) => {
      const facts = [
        formatPrice(property.price),
        property.beds && property.baths ? `${property.beds}bd/${property.baths}ba` : "",
        formatSqft(property.sqft),
        clean(property.neighborhood) || clean(property.city),
      ].filter(Boolean).join(" • ");
      const link = aiSearchPropertyUrl(property);
      return [`${index + 1}. ${clean(property.address)}`, facts, link].filter(Boolean).join("\n");
    });
  return [`Fresh options for ${criteria || "your search"}:`, ...lines].filter(Boolean).join("\n\n");
}

// Property search tuned for voice: production returns cached DB matches quickly.
// Tests may inject enrichment, but the default voice path avoids external
// Apify-style enrichment and only texts richer results when an injected enrich
// dependency supplies them.
export async function searchPropertiesForVoice(
  input: { query?: string; area?: string; beds?: number; baths?: number; minPrice?: number; maxPrice?: number; phone?: string; lead?: Partial<SheetRow> },
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
  const criteriaText = [
    clean(input.query),
    clean(input.area),
    input.beds ? `${input.beds} bed` : "",
    input.baths ? `${input.baths} bath` : "",
    input.maxPrice ? `under ${formatPrice(String(input.maxPrice))}` : "",
  ].filter(Boolean).join(", ");

  const cached = (await deps.findCandidates(criteria, 3)).filter(isUsableProperty);
  const enrichPromise = deps.enrich({
    message: criteriaText || "Find matching homes",
    lead: input.lead,
    properties: cached,
    propertyInterest: criteriaText,
  }).then(async (result) => {
    const properties = result.properties.filter(isUsableProperty).slice(0, 3);
    await Promise.all(properties.map((property) => deps.cacheProperty(property, "aria_voice_search").catch(() => null)));
    return { ...result, properties };
  });

  const raced = await Promise.race([
    enrichPromise.then((result) => ({ kind: "enriched" as const, result })),
    delay(deps.budgetMs).then(() => ({ kind: "timeout" as const })),
  ]);

  if (raced.kind === "enriched" && raced.result.properties.length) {
    return { properties: raced.result.properties, spoken: speakSearchResults(raced.result.properties), timedOut: false, fromCache: false };
  }

  if (input.phone) {
    void enrichPromise
      .then((result) => {
        const usable = result.properties.filter(isUsableProperty);
        if (usable.length) return deps.sendSms(input.phone as string, searchSmsBody(usable, criteriaText));
        return undefined;
      })
      .catch(() => undefined);
  }

  if (cached.length) {
    return {
      properties: cached,
      spoken: `${speakSearchResults(cached)} I can text the links too if you want them.`,
      timedOut: raced.kind === "timeout",
      fromCache: true,
    };
  }

  return {
    properties: [],
    spoken: "I don't see matching listings in our saved property database from that description. Give me an area, budget, or bedroom count and I'll narrow it down.",
    timedOut: true,
    fromCache: false,
  };
}
