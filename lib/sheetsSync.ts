import { Pool } from "pg";

import { readSheets } from "@/lib/googleSheets";
import {
  appendConversationEventToDatabase,
  clientId,
  ensureClientInDatabase,
  readEventsFromDatabase,
  upsertLeadMemoryToDatabase,
} from "@/lib/database";
import {
  CONVERSATION_EVENTS_TAB,
  LEAD_MEMORY_TAB,
  PROPERTIES_HEADERS,
  PROPERTIES_TAB,
  type SheetRow,
} from "@/lib/sheetSchema";

let syncPool: Pool | null = null;

function getSyncPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!syncPool) {
    syncPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return syncPool;
}

function clean(value?: string): string {
  return (value || "").trim();
}

function eventKey(row: SheetRow): string {
  return [
    row.event_at,
    row.channel,
    row.direction,
    row.email,
    row.phone,
    row.thread_ref,
    row.event_type,
    row.message_text,
  ].map(clean).join("\u0001");
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function bulkUpsertProperties(rows: SheetRow[]): Promise<number> {
  const valid = rows.filter((row) => clean(row.address));
  if (!valid.length) return 0;
  await ensureClientInDatabase();
  let count = 0;

  for (const batch of chunks(valid, 500)) {
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const start = params.length + 1;
      params.push(clientId(), ...PROPERTIES_HEADERS.map((header) => row[header] || ""), "sheets");
      return `(${Array.from({ length: PROPERTIES_HEADERS.length + 2 }, (_, index) => `$${start + index}`).join(", ")})`;
    });

    await getSyncPool().query(
      `insert into properties (client_id, ${PROPERTIES_HEADERS.join(", ")}, source)
       values ${tuples.join(", ")}
       on conflict (client_id, address) do update set
         ${PROPERTIES_HEADERS.filter((header) => header !== "address").map((header) => `${header} = coalesce(nullif(excluded.${header}, ''), properties.${header})`).join(", ")},
         source = 'sheets',
         updated_at = now()`,
      params,
    );
    count += batch.length;
  }

  return count;
}

export type SheetsToNeonSyncResult = {
  propertiesRead: number;
  propertiesUpserted: number;
  leadsRead: number;
  leadsUpserted: number;
  eventsRead: number;
  eventsAppended: number;
};

export async function syncSheetsToNeon(): Promise<SheetsToNeonSyncResult> {
  const tables = await readSheets([PROPERTIES_TAB, LEAD_MEMORY_TAB, CONVERSATION_EVENTS_TAB]);
  const properties = tables[PROPERTIES_TAB] || [];
  const leads = tables[LEAD_MEMORY_TAB] || [];
  const events = tables[CONVERSATION_EVENTS_TAB] || [];

  const propertiesUpserted = await bulkUpsertProperties(properties);

  let leadsUpserted = 0;
  for (const row of leads) {
    if (!clean(row.email) && !clean(row.phone) && !clean(row.full_name)) continue;
    await upsertLeadMemoryToDatabase(row);
    leadsUpserted += 1;
  }

  const existingEventKeys = new Set((await readEventsFromDatabase()).map(eventKey));
  let eventsAppended = 0;
  for (const row of events) {
    if (!clean(row.event_at) && !clean(row.message_text) && !clean(row.summary)) continue;
    const key = eventKey(row);
    if (existingEventKeys.has(key)) continue;
    await appendConversationEventToDatabase(row);
    existingEventKeys.add(key);
    eventsAppended += 1;
  }

  return {
    propertiesRead: properties.length,
    propertiesUpserted,
    leadsRead: leads.length,
    leadsUpserted,
    eventsRead: events.length,
    eventsAppended,
  };
}
