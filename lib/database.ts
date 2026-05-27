import { Pool } from "pg";

import {
  CONVERSATION_EVENTS_HEADERS,
  LEAD_MEMORY_HEADERS,
  PROPERTIES_HEADERS,
  type SheetRow,
} from "@/lib/sheetSchema";

let pool: Pool | null = null;

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

function rowToStrings(headers: readonly string[], row: Record<string, unknown>): SheetRow {
  return Object.fromEntries(headers.map((header) => [header, row[header] == null ? "" : String(row[header])]));
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

export async function loadAgentInboxDataFromDatabase() {
  const [leads, events, properties] = await Promise.all([
    readLeadsFromDatabase(),
    readEventsFromDatabase(),
    readPropertiesFromDatabase(),
  ]);
  return { leads, events, properties };
}
