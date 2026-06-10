import { Pool } from "pg";

import {
  CONVERSATION_EVENTS_HEADERS,
  LEAD_MEMORY_HEADERS,
  PROPERTIES_HEADERS,
  type SheetRow,
} from "@/lib/sheetSchema";
import { mergeNonEmpty, normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadIdentity";

let pool: Pool | null = null;

export type PropertySearchCriteria = {
  query?: string;
  area?: string;
  beds?: string | number;
  baths?: string | number;
  minPrice?: string | number;
  maxPrice?: string | number;
  mode?: "general" | "similar" | "neighboring";
  reference?: Partial<SheetRow>;
  excludeAddresses?: string[];
};

const GREATER_AUSTIN_CITIES = [
  "austin",
  "round rock",
  "pflugerville",
  "cedar park",
  "georgetown",
  "leander",
  "buda",
  "kyle",
  "manchaca",
  "lakeway",
  "bee cave",
  "dripping springs",
  "hutto",
  "taylor",
  "west lake hills",
  "rollingwood",
];

const AUSTIN_NEIGHBORHOODS = [
  "south austin",
  "south congress",
  "south lamar",
  "southwest austin",
  "southeast austin",
  "south slaughter",
  "downtown",
  "downtown austin",
  "east austin",
  "north austin",
  "northwest austin",
  "northeast austin",
  "west austin",
  "zilker",
  "hyde park",
  "brentwood",
  "crestview",
  "oak hill",
  "circle c",
  "circle c ranch",
  "montopolis",
  "windsor park",
  "north lamar",
  "rosedale",
  "allandale",
  "west campus",
  "cat mountain",
  "copperfield",
  "anderson mill",
  "steiner ranch",
];

const AREA_ALIASES: Record<string, string[]> = {
  "greater austin": [...GREATER_AUSTIN_CITIES, ...AUSTIN_NEIGHBORHOODS],
  "austin metro": [...GREATER_AUSTIN_CITIES, ...AUSTIN_NEIGHBORHOODS],
  "austin area": [...GREATER_AUSTIN_CITIES, ...AUSTIN_NEIGHBORHOODS],
  "central texas": [...GREATER_AUSTIN_CITIES, ...AUSTIN_NEIGHBORHOODS],
  "flugerville": ["pflugerville"],
  "pflugerville": ["pflugerville"],
  "south austin": ["south austin", "south congress", "south lamar", "southwest austin", "southeast austin", "south slaughter", "78704", "78745", "78748", "78749", "78744"],
  "north austin": ["north austin", "north lamar", "northwest austin", "northeast austin", "copperfield", "anderson mill", "78727", "78729", "78750", "78753", "78758", "78759"],
};

export function databaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function clientId(): string {
  return process.env.CLIENT_ID || "default";
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for database reads");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function clientName(): string {
  return process.env.CLIENT_NAME || clientId();
}

function cleanRow(headers: readonly string[], row: Partial<SheetRow>): SheetRow {
  return Object.fromEntries(headers.map((header) => [header, row[header] || ""])) as SheetRow;
}

function rowToStrings(headers: readonly string[], row: Record<string, unknown>): SheetRow {
  return Object.fromEntries(headers.map((header) => [header, row[header] == null ? "" : String(row[header])]));
}

export async function ensureClientInDatabase(): Promise<void> {
  await getPool().query(
    `insert into clients (id, name)
     values ($1, $2)
     on conflict (id) do update set
       name = excluded.name,
       updated_at = now()`,
    [clientId(), clientName()],
  );
}

export async function readPropertiesFromDatabase(): Promise<SheetRow[]> {
  const result = await getPool().query(
    `select ${PROPERTIES_HEADERS.join(", ")}
       from properties
      where client_id = $1
      order by updated_at desc, address asc`,
    [clientId()],
  );
  return result.rows.map((row) => rowToStrings(PROPERTIES_HEADERS, row));
}

export async function readLeadsFromDatabase(): Promise<SheetRow[]> {
  const result = await getPool().query(
    `select ${LEAD_MEMORY_HEADERS.join(", ")}
       from lead_memory
      where client_id = $1
      order by updated_at desc`,
    [clientId()],
  );
  return result.rows.map((row) => rowToStrings(LEAD_MEMORY_HEADERS, row));
}

export async function readEventsFromDatabase(): Promise<SheetRow[]> {
  const result = await getPool().query(
    `select ${CONVERSATION_EVENTS_HEADERS.join(", ")}
       from conversation_events
      where client_id = $1
      order by id asc`,
    [clientId()],
  );
  return result.rows.map((row) => rowToStrings(CONVERSATION_EVENTS_HEADERS, row));
}

export async function readEventsForThreadFromDatabase(threadRef: string, limit = 12): Promise<SheetRow[]> {
  const result = await getPool().query(
    `select ${CONVERSATION_EVENTS_HEADERS.join(", ")}
       from conversation_events
      where client_id = $1
        and thread_ref = $2
      order by id desc
      limit $3`,
    [clientId(), threadRef, limit],
  );
  return result.rows.reverse().map((row) => rowToStrings(CONVERSATION_EVENTS_HEADERS, row));
}

async function findMatchingLead(incoming: SheetRow): Promise<SheetRow | null> {
  const phone = normalizePhone(incoming.phone);
  const email = normalizeEmail(incoming.email);
  const fullName = normalizeName(incoming.full_name);
  if (!phone && !email && !fullName) {
    return null;
  }

  const result = await getPool().query(
    `select ${LEAD_MEMORY_HEADERS.join(", ")}
       from lead_memory
      where client_id = $1
        and (
          ($2 <> '' and (
            regexp_replace(phone, '\\D', '', 'g') = $2
            or (
              length(regexp_replace(phone, '\\D', '', 'g')) = 10
              and concat('1', regexp_replace(phone, '\\D', '', 'g')) = $2
            )
          ))
          or ($3 <> '' and lower(email) = $3)
          or ($4 <> '' and lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) = $4)
        )
      order by updated_at desc
      limit 1`,
    [clientId(), phone, email, fullName],
  );
  return result.rows[0] ? rowToStrings(LEAD_MEMORY_HEADERS, result.rows[0]) : null;
}

export async function findLeadInDatabase(incoming: Partial<SheetRow>): Promise<SheetRow | null> {
  return findMatchingLead(cleanRow(LEAD_MEMORY_HEADERS, incoming));
}

function normalizeSearchText(value?: string | number): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\btexas\b/g, "tx")
    .replace(/\s+/g, " ");
}

function numericValue(value?: string | number): number | null {
  const text = String(value ?? "").toLowerCase().replace(/,/g, "").trim();
  if (!text) return null;
  const match = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?/i);
  if (!match) return null;
  let amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const suffix = match[2] || "";
  if (/^m|million/.test(suffix)) amount *= 1_000_000;
  if (/^k|thousand/.test(suffix)) amount *= 1_000;
  return amount;
}

function criteriaFromQuery(query: string | PropertySearchCriteria = ""): PropertySearchCriteria {
  if (typeof query !== "string") return query;
  return { query, area: query, mode: "general" };
}

function areaTerms(criteria: PropertySearchCriteria): string[] {
  const text = normalizeSearchText([criteria.area, criteria.query].filter(Boolean).join(" "));
  const terms = new Set<string>();
  for (const [alias, values] of Object.entries(AREA_ALIASES)) {
    if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
      values.forEach((value) => terms.add(value));
    }
  }
  for (const city of GREATER_AUSTIN_CITIES) {
    if (new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) terms.add(city);
  }
  for (const neighborhood of AUSTIN_NEIGHBORHOODS) {
    if (new RegExp(`\\b${neighborhood.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) terms.add(neighborhood);
  }
  return [...terms];
}

function propertyHaystack(property: SheetRow): string {
  return normalizeSearchText([
    property.address,
    property.city,
    property.zip,
    property.neighborhood,
    property.property_type,
    property.features,
    property.description,
  ].filter(Boolean).join(" "));
}

function textTokens(criteria: PropertySearchCriteria): string[] {
  const text = normalizeSearchText(criteria.query || criteria.area || "");
  return text
    .replace(/\b(show|send|find|give|me|more|other|similar|neighboring|nearby|properties|property|homes|home|listings|listing|spec|same|around|area|in|the|a|an|to|of|with|under|over)\b/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !/^\d+$/.test(token));
}

function matchesArea(property: SheetRow, terms: string[]): boolean {
  if (!terms.length) return true;
  const haystack = propertyHaystack(property);
  return terms.some((term) => haystack.includes(normalizeSearchText(term)));
}

function referenceRange(criteria: PropertySearchCriteria, key: "price" | "beds" | "baths"): [number | null, number | null] {
  const referenceValue = numericValue(criteria.reference?.[key]);
  if (!referenceValue || criteria.mode === "general") return [null, null];
  if (key === "price") return [Math.max(0, referenceValue * 0.75), referenceValue * 1.25];
  if (key === "beds") return [Math.max(0, referenceValue - 1), referenceValue + 1];
  return [Math.max(0, referenceValue - 1), referenceValue + 1];
}

function propertyMatchesCriteria(property: SheetRow, criteria: PropertySearchCriteria): boolean {
  const excluded = new Set((criteria.excludeAddresses || []).map((address) => normalizeSearchText(address)));
  if (excluded.has(normalizeSearchText(property.address))) return false;

  const terms = areaTerms(criteria);
  if (!matchesArea(property, terms)) return false;

  const tokens = textTokens(criteria);
  const haystack = propertyHaystack(property);

  const beds = numericValue(property.beds);
  const baths = numericValue(property.baths);
  const price = numericValue(property.price);
  const requestedBeds = numericValue(criteria.beds);
  const requestedBaths = numericValue(criteria.baths);
  const explicitMinPrice = numericValue(criteria.minPrice);
  const explicitMaxPrice = numericValue(criteria.maxPrice);
  const [referenceMinPrice, referenceMaxPrice] = referenceRange(criteria, "price");
  const [referenceMinBeds, referenceMaxBeds] = referenceRange(criteria, "beds");
  const [referenceMinBaths, referenceMaxBaths] = referenceRange(criteria, "baths");
  const minPrice = explicitMinPrice ?? referenceMinPrice;
  const maxPrice = explicitMaxPrice ?? referenceMaxPrice;
  const hasStructuredCriteria = requestedBeds != null
    || requestedBaths != null
    || minPrice != null
    || maxPrice != null
    || Boolean(criteria.reference?.address)
    || criteria.mode === "similar"
    || criteria.mode === "neighboring";
  if (!terms.length && tokens.length && !hasStructuredCriteria && !tokens.some((token) => haystack.includes(token))) return false;

  if (requestedBeds != null && beds != null && beds < requestedBeds) return false;
  if (requestedBaths != null && baths != null && baths < requestedBaths) return false;
  if (referenceMinBeds != null && beds != null && beds < referenceMinBeds) return false;
  if (referenceMaxBeds != null && beds != null && beds > referenceMaxBeds) return false;
  if (referenceMinBaths != null && baths != null && baths < referenceMinBaths) return false;
  if (referenceMaxBaths != null && baths != null && baths > referenceMaxBaths) return false;
  if (minPrice != null && price != null && price < minPrice) return false;
  if (maxPrice != null && price != null && price > maxPrice) return false;

  return true;
}

function scorePropertyCandidate(property: SheetRow, criteria: PropertySearchCriteria): number {
  let score = 0;
  const terms = areaTerms(criteria);
  const haystack = propertyHaystack(property);
  if (terms.some((term) => normalizeSearchText(property.city) === normalizeSearchText(term))) score -= 40;
  if (terms.some((term) => normalizeSearchText(property.neighborhood).includes(normalizeSearchText(term)))) score -= 35;
  if (terms.some((term) => haystack.includes(normalizeSearchText(term)))) score -= 10;

  const reference = criteria.reference || {};
  const price = numericValue(property.price);
  const refPrice = numericValue(reference.price);
  const beds = numericValue(property.beds);
  const refBeds = numericValue(reference.beds);
  const baths = numericValue(property.baths);
  const refBaths = numericValue(reference.baths);
  if (refBeds != null && beds != null) score += Math.abs(beds - refBeds) * 12;
  if (refBaths != null && baths != null) score += Math.abs(baths - refBaths) * 8;
  if (refPrice != null && price != null) score += Math.min(50, Math.abs(price - refPrice) / Math.max(refPrice, 1) * 50);
  if (reference.neighborhood && normalizeSearchText(property.neighborhood) === normalizeSearchText(reference.neighborhood)) score -= criteria.mode === "neighboring" ? 30 : 8;
  if (reference.city && normalizeSearchText(property.city) === normalizeSearchText(reference.city)) score -= criteria.mode === "neighboring" ? 20 : 4;
  if (property.photo_url) score -= 1;
  if (property.listing_url) score -= 1;
  return score;
}

export async function findCandidatePropertiesFromDatabase(query: string | PropertySearchCriteria = "", limit = 5): Promise<SheetRow[]> {
  const criteria = criteriaFromQuery(query);
  const result = await getPool().query(
    `select ${PROPERTIES_HEADERS.join(", ")}
       from properties
      where client_id = $1
      order by updated_at desc, address asc
      limit 500`,
    [clientId()],
  );
  const rows = result.rows.map((row) => rowToStrings(PROPERTIES_HEADERS, row));
  const matched = rows.filter((property) => propertyMatchesCriteria(property, criteria));
  const candidates = matched.length ? matched : rows.filter((property) => {
    const terms = areaTerms(criteria);
    return terms.length ? matchesArea(property, terms) : true;
  });
  return candidates
    .sort((a, b) => scorePropertyCandidate(a, criteria) - scorePropertyCandidate(b, criteria) || a.address.localeCompare(b.address))
    .slice(0, limit);
}

function propertyAddressStem(address: string): string {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/\btexas\b/g, "tx")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(/^(\d+\s+.*?\b(?:st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|cir|circle|trl|trail|path|cv|cove)\b)/);
  return match?.[1] || normalized;
}

export async function findPropertiesByAddressesFromDatabase(addresses: string[], limit = 5): Promise<SheetRow[]> {
  const cleaned = addresses.map((address) => address.trim().toLowerCase()).filter(Boolean);
  if (!cleaned.length) return [];
  const rows: SheetRow[] = [];
  const seen = new Set<string>();
  for (const address of cleaned) {
    if (rows.length >= limit) break;
    const stem = propertyAddressStem(address);
    const result = await getPool().query(
      `select ${PROPERTIES_HEADERS.join(", ")}
         from properties
        where client_id = $1
          and (
            lower(address) = $2
            or lower(regexp_replace(address, '[^a-zA-Z0-9#]+', ' ', 'g')) like $3
          )
        order by case when lower(address) = $2 then 0 else 1 end, updated_at desc
        limit $4`,
      [clientId(), address, `${stem}%`, Math.max(1, limit - rows.length)],
    );
    for (const row of result.rows) {
      const mapped = rowToStrings(PROPERTIES_HEADERS, row);
      const key = mapped.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(mapped);
    }
  }
  return rows;
}

export async function upsertPropertyToDatabase(incoming: Partial<SheetRow>, source = "live_lookup"): Promise<SheetRow | null> {
  const cleaned = cleanRow(PROPERTIES_HEADERS, incoming);
  if (!cleaned.address.trim()) return null;
  await ensureClientInDatabase();
  await getPool().query(
    `insert into properties (client_id, ${PROPERTIES_HEADERS.join(", ")}, source)
     values ($1, ${PROPERTIES_HEADERS.map((_, index) => `$${index + 2}`).join(", ")}, $${PROPERTIES_HEADERS.length + 2})
     on conflict (client_id, address) do update set
       ${PROPERTIES_HEADERS.filter((header) => header !== "address").map((header) => `${header} = coalesce(nullif(excluded.${header}, ''), properties.${header})`).join(", ")},
       source = case
         when properties.source = 'sheets' then properties.source
         else excluded.source
       end,
       updated_at = now()`,
    [clientId(), ...PROPERTIES_HEADERS.map((header) => cleaned[header]), source],
  );
  return cleaned;
}

export async function upsertLeadMemoryToDatabase(incoming: Partial<SheetRow>): Promise<SheetRow> {
  await ensureClientInDatabase();
  const cleaned = cleanRow(LEAD_MEMORY_HEADERS, incoming);
  const existing = await findMatchingLead(cleaned);
  const next = existing ? mergeNonEmpty(existing, cleaned) : cleaned;

  if (existing) {
    await getPool().query(
      `update lead_memory
          set ${LEAD_MEMORY_HEADERS.map((header, index) => `${header} = $${index + 2}`).join(", ")},
              updated_at = now()
        where client_id = $1
          and email = $${LEAD_MEMORY_HEADERS.length + 2}
          and phone = $${LEAD_MEMORY_HEADERS.length + 3}
          and full_name = $${LEAD_MEMORY_HEADERS.length + 4}`,
      [clientId(), ...LEAD_MEMORY_HEADERS.map((header) => next[header]), existing.email, existing.phone, existing.full_name],
    );
    return next;
  }

  await getPool().query(
    `insert into lead_memory (client_id, ${LEAD_MEMORY_HEADERS.join(", ")})
     values ($1, ${LEAD_MEMORY_HEADERS.map((_, index) => `$${index + 2}`).join(", ")})
     on conflict (client_id, email, phone, full_name) do update set
       ${LEAD_MEMORY_HEADERS.filter((header) => !["email", "phone", "full_name"].includes(header))
         .map((header) => `${header} = excluded.${header}`)
         .join(", ")},
       updated_at = now()`,
    [clientId(), ...LEAD_MEMORY_HEADERS.map((header) => next[header])],
  );
  return next;
}

export async function appendConversationEventToDatabase(event: Partial<SheetRow>): Promise<SheetRow> {
  await ensureClientInDatabase();
  const cleaned = cleanRow(CONVERSATION_EVENTS_HEADERS, event);
  await getPool().query(
    `insert into conversation_events (client_id, ${CONVERSATION_EVENTS_HEADERS.join(", ")})
     values ($1, ${CONVERSATION_EVENTS_HEADERS.map((_, index) => `$${index + 2}`).join(", ")})`,
    [clientId(), ...CONVERSATION_EVENTS_HEADERS.map((header) => cleaned[header])],
  );
  return cleaned;
}

export async function loadAgentInboxDataFromDatabase() {
  const [leads, events, properties] = await Promise.all([
    readLeadsFromDatabase(),
    readEventsFromDatabase(),
    readPropertiesFromDatabase(),
  ]);
  return { leads, events, properties };
}
