import { Pool } from "pg";

// ponytail: own pool, not database.ts's (not exported). Fine for low-traffic dashboard.
let pool: Pool | null = null;
let ensured = false;

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

async function ensureTakeoverTable() {
  if (ensured || !process.env.DATABASE_URL) return;
  await getPool().query(`
    create table if not exists thread_takeovers (
      id bigserial primary key,
      client_id text not null default 'default',
      thread_ref text not null,
      channel text not null default '',
      is_active boolean not null default true,
      taken_by text,
      taken_at timestamptz not null default now(),
      released_at timestamptz
    )
  `);
  await getPool().query(`
    create index if not exists idx_thread_takeovers_lookup_channel
    on thread_takeovers(client_id, channel, thread_ref)
  `);
  await getPool().query(`
    create unique index if not exists idx_thread_takeovers_active_channel
    on thread_takeovers(client_id, channel, thread_ref)
    where is_active = true
  `).catch(() => undefined);
  ensured = true;
}

export type TakeoverState = { isActive: boolean; takenBy: string | null; takenAt: string | null };

export async function isTakeoverActive(threadRef: string, channel?: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  await ensureTakeoverTable();
  const params = channel ? [clientId(), threadRef, channel] : [clientId(), threadRef];
  const result = await getPool().query(
    `select 1 from thread_takeovers
     where client_id = $1 and thread_ref = $2 ${channel ? "and channel = $3" : ""} and is_active = true
     limit 1`,
    params,
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getTakeover(threadRef: string, channel?: string): Promise<TakeoverState> {
  if (!process.env.DATABASE_URL) return { isActive: false, takenBy: null, takenAt: null };
  await ensureTakeoverTable();
  const params = channel ? [clientId(), threadRef, channel] : [clientId(), threadRef];
  const result = await getPool().query(
    `select taken_by, taken_at from thread_takeovers
     where client_id = $1 and thread_ref = $2 ${channel ? "and channel = $3" : ""} and is_active = true
     order by taken_at desc
     limit 1`,
    params,
  );
  const row = result.rows[0];
  if (!row) return { isActive: false, takenBy: null, takenAt: null };
  return { isActive: true, takenBy: row.taken_by, takenAt: String(row.taken_at) };
}

export async function activateTakeover(threadRef: string, channel: string, takenBy: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await ensureTakeoverTable();
  const db = getPool();
  const params = [clientId(), threadRef, channel, takenBy];
  await db.query("begin");
  try {
    await db.query(
      `update thread_takeovers
       set is_active = false, released_at = now()
       where client_id = $1 and thread_ref = $2 and channel = $3 and is_active = true`,
      params.slice(0, 3),
    );
    await db.query(
      `insert into thread_takeovers (client_id, thread_ref, channel, taken_by, is_active, taken_at)
       values ($1, $2, $3, $4, true, now())`,
      params,
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function releaseTakeover(threadRef: string, channel?: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await ensureTakeoverTable();
  const params = channel ? [clientId(), threadRef, channel] : [clientId(), threadRef];
  await getPool().query(
    `update thread_takeovers
     set is_active = false, released_at = now()
     where client_id = $1 and thread_ref = $2 ${channel ? "and channel = $3" : ""} and is_active = true`,
    params,
  );
}
