import { createHash } from "node:crypto";

import { Pool } from "pg";

import type { SheetRow } from "@/lib/sheetSchema";
import { activeClientId } from "@/lib/tenant";

export const PROPERTY_FACT_FIELDS = [
  "price",
  "status",
  "beds",
  "baths",
  "sqft",
  "property_type",
  "neighborhood",
  "city",
  "state",
  "zip",
  "features",
  "utilities_included",
  "appliances_included",
  "parking",
  "pet_policy",
  "deposit",
  "fees",
  "lease_terms",
  "available_date",
  "days_on_market",
  "tax_assessment",
  "hoa_fee",
  "year_built",
] as const;

export type PropertyFactField = typeof PROPERTY_FACT_FIELDS[number] | string;
export type PropertyFactStatus = "known" | "unknown" | "stale" | "conflicting";

export type PropertyFactEvidence = {
  field: PropertyFactField;
  value: string | number | boolean | null;
  status: PropertyFactStatus;
  sourceName: string;
  sourceUrl: string;
  sourceRecordId: string;
  retrievedAt: string;
  observedAt: string;
  effectiveDate: string;
  expiresAt: string;
  confidence: number;
  rawHash: string;
};

let poolInstance: Pool | null = null;

function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return poolInstance;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isoOrEmpty(value: unknown): string {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function confidence(value: unknown, fallback = 0.8): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

export function propertyFactHash(input: {
  address: string;
  field: string;
  value: unknown;
  sourceName: string;
  sourceRecordId?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      address: clean(input.address).toLowerCase(),
      field: clean(input.field).toLowerCase(),
      value: input.value,
      sourceName: clean(input.sourceName).toLowerCase(),
      sourceRecordId: clean(input.sourceRecordId),
    }))
    .digest("hex");
}

export function normalizePropertyFact(input: Partial<PropertyFactEvidence> & {
  field: string;
  value?: PropertyFactEvidence["value"];
  sourceName: string;
  sourceUrl?: string;
  sourceRecordId?: string;
  address: string;
}, now = new Date()): PropertyFactEvidence {
  const retrievedAt = isoOrEmpty(input.retrievedAt) || now.toISOString();
  const observedAt = isoOrEmpty(input.observedAt) || retrievedAt;
  const effectiveDate = isoOrEmpty(input.effectiveDate);
  const expiresAt = isoOrEmpty(input.expiresAt);
  const value = input.value == null || clean(input.value) === "" ? null : input.value;
  const status: PropertyFactStatus = input.status === "conflicting"
    ? "conflicting"
    : value == null ? "unknown"
      : expiresAt && Date.parse(expiresAt) <= now.getTime() ? "stale"
        : input.status === "stale" ? "stale" : "known";
  return {
    field: clean(input.field),
    value,
    status,
    sourceName: clean(input.sourceName),
    sourceUrl: clean(input.sourceUrl),
    sourceRecordId: clean(input.sourceRecordId),
    retrievedAt,
    observedAt,
    effectiveDate,
    expiresAt,
    confidence: confidence(input.confidence),
    rawHash: input.rawHash || propertyFactHash({
      address: input.address,
      field: input.field,
      value,
      sourceName: input.sourceName,
      sourceRecordId: input.sourceRecordId,
    }),
  };
}

export function resolvePropertyFact(facts: PropertyFactEvidence[], now = new Date()): PropertyFactEvidence | null {
  if (!facts.length) return null;
  const current = facts.map((fact) => normalizePropertyFact({ ...fact, address: "resolution" }, now));
  const live = current.filter((fact) => fact.status !== "stale" && (!fact.expiresAt || Date.parse(fact.expiresAt) > now.getTime()));
  const values = new Set(live.filter((fact) => fact.value != null).map((fact) => JSON.stringify(fact.value)));
  if (live.some((fact) => fact.status === "conflicting") || values.size > 1) {
    const latest = [...live].sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] || current[0];
    return { ...latest, status: "conflicting" };
  }
  return [...current].sort((left, right) => {
    const statusRank = (status: PropertyFactStatus) => status === "known" ? 0 : status === "unknown" ? 1 : status === "stale" ? 2 : 3;
    return statusRank(left.status) - statusRank(right.status) || Date.parse(right.observedAt) - Date.parse(left.observedAt);
  })[0];
}

function rowFactInputs(row: Partial<SheetRow>, sourceName: string, now: Date): Array<{ address: string; fact: PropertyFactEvidence }> {
  const address = clean(row.address);
  const sourceUrl = clean(row.listing_url);
  const sourceRecordId = clean(row.property_id || row.mls_number || row.mls);
  const observedAt = isoOrEmpty(row.source_observed_at || row.updated_at) || now.toISOString();
  const freshnessHours = Math.max(1, Number(process.env.PROPERTY_FACT_FRESHNESS_HOURS || "24"));
  const expiresAt = new Date(Date.parse(observedAt) + freshnessHours * 60 * 60_000).toISOString();
  return PROPERTY_FACT_FIELDS
    .filter((field) => clean(row[field]))
    .map((field) => ({
      address,
      fact: normalizePropertyFact({
        address,
        field,
        value: clean(row[field]),
        sourceName,
        sourceUrl,
        sourceRecordId,
        retrievedAt: now.toISOString(),
        observedAt,
        effectiveDate: observedAt,
        expiresAt,
        confidence: 0.8,
      }, now),
    }));
}

export async function recordPropertyFactsFromRow(row: Partial<SheetRow>, sourceName: string): Promise<void> {
  if (!process.env.DATABASE_URL || !clean(row.address)) return;
  const tenantId = activeClientId();
  const inputs = rowFactInputs(row, sourceName, new Date());
  if (!inputs.length) return;
  const connection = await pool().connect();
  try {
    await connection.query("begin");
    for (const { address, fact } of inputs) {
      await connection.query(
        `insert into property_facts (
           client_id, property_address, field, value, status,
           source_name, source_url, source_record_id, retrieved_at,
           observed_at, effective_date, expires_at, confidence, raw_hash
         ) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (client_id, property_address, field, source_name, raw_hash)
         do update set
           retrieved_at = excluded.retrieved_at,
           observed_at = excluded.observed_at,
           effective_date = excluded.effective_date,
           expires_at = excluded.expires_at,
           confidence = excluded.confidence`,
        [
          tenantId,
          address,
          fact.field,
          JSON.stringify(fact.value),
          fact.status,
          fact.sourceName,
          fact.sourceUrl,
          fact.sourceRecordId,
          fact.retrievedAt,
          fact.observedAt,
          fact.effectiveDate || null,
          fact.expiresAt || null,
          fact.confidence,
          fact.rawHash,
        ],
      );
      await connection.query(
        `update property_facts current
            set status = 'conflicting'
           from property_facts other
          where current.client_id = $1
            and current.property_address = $2
            and current.field = $3
            and other.client_id = current.client_id
            and other.property_address = current.property_address
            and other.field = current.field
            and other.source_name <> current.source_name
            and other.value <> current.value
            and other.retrieved_at >= now() - interval '24 hours'
            and current.retrieved_at >= now() - interval '24 hours'`,
        [tenantId, address, fact.field],
      );
    }
    await connection.query("commit");
  } catch (error) {
    await connection.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

function rowToFact(row: Record<string, unknown>): PropertyFactEvidence {
  const value = typeof row.value === "string"
    ? (() => { try { return JSON.parse(row.value); } catch { return row.value; } })()
    : row.value as PropertyFactEvidence["value"];
  return {
    field: clean(row.field),
    value,
    status: clean(row.status) as PropertyFactStatus,
    sourceName: clean(row.source_name),
    sourceUrl: clean(row.source_url),
    sourceRecordId: clean(row.source_record_id),
    retrievedAt: isoOrEmpty(row.retrieved_at),
    observedAt: isoOrEmpty(row.observed_at),
    effectiveDate: isoOrEmpty(row.effective_date),
    expiresAt: isoOrEmpty(row.expires_at),
    confidence: confidence(row.confidence),
    rawHash: clean(row.raw_hash),
  };
}

export async function readPropertyFacts(addresses: string[]): Promise<Record<string, PropertyFactEvidence[]>> {
  const cleaned = [...new Set(addresses.map(clean).filter(Boolean))];
  if (!process.env.DATABASE_URL || !cleaned.length) return {};
  const result = await pool().query(
    `select property_address, field, value, status, source_name, source_url,
            source_record_id, retrieved_at, observed_at, effective_date,
            expires_at, confidence, raw_hash
       from property_facts
      where client_id = $1
        and lower(property_address) = any($2::text[])
      order by observed_at desc, retrieved_at desc`,
    [activeClientId(), cleaned.map((address) => address.toLowerCase())],
  );
  const output: Record<string, PropertyFactEvidence[]> = {};
  for (const row of result.rows) {
    const key = clean(row.property_address).toLowerCase();
    output[key] ||= [];
    output[key].push(rowToFact(row));
  }
  return output;
}

export async function attachPropertyFactEvidence(rows: SheetRow[]): Promise<SheetRow[]> {
  if (!rows.length || !process.env.DATABASE_URL) return rows;
  const evidenceByAddress: Record<string, PropertyFactEvidence[]> = await readPropertyFacts(rows.map((row) => row.address)).catch(() => ({}));
  return rows.map((row) => {
    const facts = evidenceByAddress[clean(row.address).toLowerCase()] || [];
    if (!facts.length) return row;
    const resolved = Object.fromEntries(PROPERTY_FACT_FIELDS.map((field) => [
      field,
      resolvePropertyFact(facts.filter((fact) => fact.field === field)),
    ])) as Record<string, PropertyFactEvidence | null>;
    const safe: SheetRow = { ...row, fact_evidence: JSON.stringify(resolved) };
    for (const field of PROPERTY_FACT_FIELDS) {
      const fact = resolved[field];
      if (fact) safe[field] = fact.status === "known" ? clean(fact.value) : "";
    }
    // Free-form copy can retain superseded prices even when structured facts expire.
    safe.description = "";
    return safe;
  });
}

export function attributableFactText(fact: PropertyFactEvidence): string {
  if (fact.status === "unknown") return `${fact.field} is unknown`;
  if (fact.status === "stale") return `${fact.field} is stale and must be reverified`;
  if (fact.status === "conflicting") return `${fact.field} has conflicting sources and requires review`;
  const observed = fact.observedAt ? fact.observedAt.slice(0, 10) : "unknown date";
  return `${fact.field}: ${clean(fact.value)} (source: ${fact.sourceName}, observed ${observed}${fact.sourceUrl ? `, ${fact.sourceUrl}` : ""})`;
}
