import {
  findCandidatePropertiesFromDatabase,
  type PropertySearchCriteria,
} from "@/lib/database";
import { Pool } from "pg";
import {
  embedText,
  ragEnabled,
  PROPERTY_EMBEDDING_MODEL,
  vectorLiteral,
} from "@/lib/propertyEmbeddings";
import { searchAndImportMissingProperties } from "@/lib/propertyImportFallback";
import { PROPERTIES_HEADERS, type SheetRow } from "@/lib/sheetSchema";

export type SemanticPropertyMatch = {
  property: SheetRow;
  distance: number;
};

type RetrieveOptions = {
  channel?: string;
  enableRag?: boolean;
  enableMissingPropertyImport?: boolean;
};

type RetrieveDeps = {
  structured: (query: string | PropertySearchCriteria, limit?: number) => Promise<SheetRow[]>;
  embed: (text: string) => Promise<number[] | null>;
  semantic: (addresses: string[], embedding: number[], limit?: number) => Promise<SemanticPropertyMatch[]>;
  fallback?: (query: string | PropertySearchCriteria, limit: number, options: RetrieveOptions) => Promise<SheetRow[]>;
};

const defaultDeps: RetrieveDeps = {
  structured: findCandidatePropertiesFromDatabase,
  embed: embedText,
  semantic: findSemanticPropertyMatchesByAddress,
  fallback: (query, limit, options) => searchAndImportMissingProperties({
    query,
    limit,
    channel: options.channel,
    source: `apify_fallback_${options.channel || "agent"}`,
  }),
};

let pool: Pool | null = null;

function databaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function clientId(): string {
  return process.env.CLIENT_ID || "default";
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for property RAG");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function rowToProperty(row: Record<string, unknown>): SheetRow {
  return Object.fromEntries(PROPERTIES_HEADERS.map((header) => {
    const value = row[header];
    if (value == null) return [header, ""];
    if (typeof value === "object") return [header, JSON.stringify(value)];
    return [header, String(value)];
  })) as SheetRow;
}

async function findSemanticPropertyMatchesByAddress(
  addresses: string[],
  embedding: number[],
  limit = 25,
): Promise<SemanticPropertyMatch[]> {
  const cleaned = [...new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean))];
  if (!databaseEnabled() || !cleaned.length || !embedding.length) return [];
  const result = await getPool().query(
    `select ${PROPERTIES_HEADERS.map((header) => `p.${header}`).join(", ")},
            (pe.embedding <=> $2::vector) as distance
       from property_embeddings pe
       join properties p
         on p.client_id = pe.client_id
        and p.address = pe.address
      where pe.client_id = $1
        and pe.embedding_model = $3
        and lower(pe.address) = any($4::text[])
      order by pe.embedding <=> $2::vector, p.updated_at desc
      limit $5`,
    [clientId(), vectorLiteral(embedding), PROPERTY_EMBEDDING_MODEL, cleaned, Math.max(1, Math.min(limit, 100))],
  );
  return result.rows.map((row) => ({
    property: rowToProperty(row),
    distance: Number(row.distance || 0),
  }));
}

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function semanticQueryText(query: string | PropertySearchCriteria): string {
  if (typeof query === "string") return clean(query);
  return [
    clean(query.query),
    clean(query.area),
    query.mode && query.mode !== "general" ? query.mode : "",
    query.reference?.address ? `similar to ${query.reference.address}` : "",
    query.reference?.neighborhood ? `near ${query.reference.neighborhood}` : "",
  ].filter(Boolean).join(" ");
}

function shouldUseRag(query: string | PropertySearchCriteria, options: RetrieveOptions): boolean {
  if (options.enableRag === false) return false;
  if (options.enableRag === true) return true;
  if (!ragEnabled()) return false;
  if (options.channel === "voice") return false;
  return Boolean(semanticQueryText(query));
}

function shouldUseMissingPropertyFallback(options: RetrieveOptions): boolean {
  if (options.enableMissingPropertyImport === false) return false;
  if (options.channel === "voice" && process.env.PROPERTY_APIFY_FALLBACK_VOICE_ENABLED !== "true") return false;
  return true;
}

async function fallbackWhenEmpty(
  rows: SheetRow[],
  query: string | PropertySearchCriteria,
  requested: number,
  options: RetrieveOptions,
  deps: RetrieveDeps,
): Promise<SheetRow[]> {
  if (rows.length || !deps.fallback || !shouldUseMissingPropertyFallback(options)) return rows.slice(0, requested);
  const imported = await deps.fallback(query, requested, options).catch(() => []);
  return imported.slice(0, requested);
}

export async function retrievePropertiesForAgent(
  query: string | PropertySearchCriteria = "",
  limit = 5,
  options: RetrieveOptions = {},
  deps: RetrieveDeps = defaultDeps,
): Promise<SheetRow[]> {
  const requested = Math.max(1, Math.min(limit, 25));
  const poolSize = Math.max(25, Math.min(requested * 12, 100));
  const structured = await deps.structured(query, shouldUseRag(query, options) ? poolSize : requested);
  if (!structured.length || !shouldUseRag(query, options)) {
    return fallbackWhenEmpty(structured, query, requested, options, deps);
  }

  const embedding = await deps.embed(semanticQueryText(query)).catch(() => null);
  if (!embedding?.length) return structured.slice(0, requested);

  const semantic = await deps.semantic(
    structured.map((property) => property.address).filter(Boolean),
    embedding,
    poolSize,
  ).catch(() => []);
  if (!semantic.length) return structured.slice(0, requested);

  const structuredRank = new Map(structured.map((property, index) => [property.address.toLowerCase(), index]));
  const semanticRows = semantic
    .map((match) => ({
      property: match.property,
      score: match.distance + (structuredRank.get(match.property.address.toLowerCase()) ?? poolSize) * 0.02,
    }))
    .sort((a, b) => a.score - b.score)
    .map((item) => item.property);
  const seen = new Set<string>();
  const merged: SheetRow[] = [];
  for (const property of [...semanticRows, ...structured]) {
    const key = property.address.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(property);
    if (merged.length >= requested) break;
  }
  return merged;
}
