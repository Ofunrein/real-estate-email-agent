import { Pool } from "pg";

import {
  CONVERSATION_EVENTS_HEADERS,
  LEAD_MEMORY_HEADERS,
  PROPERTIES_HEADERS,
  type SheetRow,
} from "@/lib/sheetSchema";
import { mergeNonEmpty, normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadIdentity";

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

export async function findCandidatePropertiesFromDatabase(query = "", limit = 5): Promise<SheetRow[]> {
  const search = `%${query.trim().toLowerCase()}%`;
  const result = await getPool().query(
    `select ${PROPERTIES_HEADERS.join(", ")}
       from properties
      where client_id = $1
        and (
          $2 = '%%'
          or lower(address) like $2
          or lower(city) like $2
          or lower(zip) like $2
          or lower(neighborhood) like $2
          or lower(property_type) like $2
        )
      order by updated_at desc, address asc
      limit $3`,
    [clientId(), search, limit],
  );
  return result.rows.map((row) => rowToStrings(PROPERTIES_HEADERS, row));
}

export async function findPropertiesByAddressesFromDatabase(addresses: string[], limit = 5): Promise<SheetRow[]> {
  const cleaned = addresses.map((address) => address.trim().toLowerCase()).filter(Boolean);
  if (!cleaned.length) return [];
  const result = await getPool().query(
    `select ${PROPERTIES_HEADERS.join(", ")}
       from properties
      where client_id = $1
        and lower(address) = any($2::text[])
      order by array_position($2::text[], lower(address)), updated_at desc
      limit $3`,
    [clientId(), cleaned, limit],
  );
  return result.rows.map((row) => rowToStrings(PROPERTIES_HEADERS, row));
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
