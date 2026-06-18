import { Pool } from "pg";

// ponytail: own pool, not database.ts's (not exported). Fine for low-traffic dashboard;
// reuse a shared pool if connection count ever matters.
let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function clientId(): string {
  return process.env.CLIENT_ID || "default";
}

export type TakeoverState = { isActive: boolean; takenBy: string | null; takenAt: string | null };

export async function isTakeoverActive(threadRef: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const result = await getPool().query(
    `select 1 from thread_takeovers
     where client_id = $1 and thread_ref = $2 and is_active = true limit 1`,
    [clientId(), threadRef],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getTakeover(threadRef: string): Promise<TakeoverState> {
  if (!process.env.DATABASE_URL) return { isActive: false, takenBy: null, takenAt: null };
  const result = await getPool().query(
    `select taken_by, taken_at from thread_takeovers
     where client_id = $1 and thread_ref = $2 and is_active = true limit 1`,
    [clientId(), threadRef],
  );
  const row = result.rows[0];
  if (!row) return { isActive: false, takenBy: null, takenAt: null };
  return { isActive: true, takenBy: row.taken_by, takenAt: String(row.taken_at) };
}

export async function activateTakeover(threadRef: string, channel: string, takenBy = "owner"): Promise<void> {
  await getPool().query(
    `insert into thread_takeovers (client_id, thread_ref, channel, is_active, taken_by)
     values ($1, $2, $3, true, $4)
     on conflict (client_id, thread_ref) where is_active = true do nothing`,
    [clientId(), threadRef, channel, takenBy],
  );
}

export async function releaseTakeover(threadRef: string): Promise<void> {
  await getPool().query(
    `update thread_takeovers set is_active = false, released_at = now()
     where client_id = $1 and thread_ref = $2 and is_active = true`,
    [clientId(), threadRef],
  );
}
