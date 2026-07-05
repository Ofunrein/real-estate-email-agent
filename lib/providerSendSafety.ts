import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

const DEFAULT_RATE_LIMIT = Number(process.env.IRIS_PROVIDER_SENDS_PER_MINUTE || 12);
const PENDING_TTL_MS = 90_000;
const MEMORY_TTL_MS = 10 * 60_000;

type ProviderAction = "manual_reply" | "draft_approve_send" | "voice_call" | "voice_note" | string;

type GateInput = {
  requestId?: string;
  idempotencyKey?: string;
  action: ProviderAction;
  channel: string;
  target: string;
  threadRef?: string;
  payload: unknown;
  maxPerMinute?: number;
};

type StoredResult = Record<string, unknown> | null;

type GateDecision =
  | { ok: true; key: string; requestHash: string; source: "database" | "memory" | "disabled" }
  | { ok: false; status: number; error: string; key: string; replay?: boolean; result?: StoredResult };

type MemoryRecord = {
  key: string;
  requestHash: string;
  status: "pending" | "sent" | "failed";
  result: StoredResult;
  createdAt: number;
  updatedAt: number;
};

let pool: Pool | null = null;
let ensured = false;
const memoryDedupe = new Map<string, MemoryRecord>();
const memoryRate = new Map<string, number[]>();

function databaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function clientId() {
  return process.env.CLIENT_ID || "default";
}

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required provider send safety");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: Number(process.env.PROVIDER_SAFETY_DATABASE_POOL_MAX || 2),
    });
  }
  return pool;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function providerActionHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function providerIdempotencyKey(input: Omit<GateInput, "payload"> & { requestHash: string }): string {
  const explicit = String(input.idempotencyKey || "").trim();
  if (explicit) return explicit.slice(0, 180);
  return createHash("sha256")
    .update(stableStringify({
      action: input.action,
      channel: input.channel,
      target: input.target,
      threadRef: input.threadRef || "",
      requestHash: input.requestHash,
    }))
    .digest("hex");
}

function rateScope(input: Pick<GateInput, "action" | "channel" | "target">) {
  return `${clientId()}:${input.action}:${input.channel}:${input.target}`;
}

function cleanupMemory() {
  const cutoff = Date.now() - MEMORY_TTL_MS;
  for (const [key, record] of memoryDedupe.entries()) {
    if (record.updatedAt < cutoff) memoryDedupe.delete(key);
  }
  const rateCutoff = Date.now() - 60_000;
  for (const [key, hits] of memoryRate.entries()) {
    const kept = hits.filter((time) => time >= rateCutoff);
    if (kept.length) memoryRate.set(key, kept);
    else memoryRate.delete(key);
  }
}

async function ensureTables() {
  if (ensured || !databaseEnabled()) return;
  await getPool().query(`
    create table if not exists provider_send_idempotency (
      idempotency_key text primary key,
      client_id text not null default 'default',
      request_id text not null,
      request_hash text not null,
      action text not null,
      channel text not null,
      target text not null,
      thread_ref text not null default '',
      status text not null default 'pending',
      result_json jsonb not null default '{}'::jsonb,
      error_message text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await getPool().query(`
    create index if not exists provider_send_idempotency_rate_idx
    on provider_send_idempotency (client_id, action, channel, target, created_at desc)
  `);
  ensured = true;
}

function isPendingFresh(createdAt: unknown) {
  const created = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt || ""));
  return Number.isFinite(created) && Date.now() - created < PENDING_TTL_MS;
}

export async function claimProviderAction(input: GateInput): Promise<GateDecision> {
  cleanupMemory();
  const requestHash = providerActionHash(input.payload);
  const key = providerIdempotencyKey({ ...input, requestHash });
  const max = Math.max(1, input.maxPerMinute || DEFAULT_RATE_LIMIT);

  if (!databaseEnabled()) {
    const existing = memoryDedupe.get(key);
    if (existing?.status === "sent") return { ok: false, status: 200, error: "Duplicate provider action replayed.", key, replay: true, result: existing.result };
    if (existing?.status === "pending" && Date.now() - existing.createdAt < PENDING_TTL_MS) {
      return { ok: false, status: 409, error: "Provider action already in progress.", key };
    }
    const scope = rateScope(input);
    const now = Date.now();
    const hits = (memoryRate.get(scope) || []).filter((time) => time >= now - 60_000);
    if (hits.length >= max) return { ok: false, status: 429, error: "Provider send rate limit exceeded.", key };
    hits.push(now);
    memoryRate.set(scope, hits);
    memoryDedupe.set(key, { key, requestHash, status: "pending", result: null, createdAt: now, updatedAt: now });
    return { ok: true, key, requestHash, source: "memory" };
  }

  await ensureTables();
  const db = getPool();
  const rate = await db.query(
    `select count(*)::int as count
     from provider_send_idempotency
     where client_id = $1 and action = $2 and channel = $3 and target = $4 and created_at > now() - interval '1 minute'`,
    [clientId(), input.action, input.channel, input.target],
  );
  if (Number(rate.rows[0]?.count || 0) >= max) return { ok: false, status: 429, error: "Provider send rate limit exceeded.", key };

  const inserted = await db.query(
    `insert into provider_send_idempotency
      (idempotency_key, client_id, request_id, request_hash, action, channel, target, thread_ref, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     on conflict (idempotency_key) do nothing
     returning idempotency_key`,
    [key, clientId(), input.requestId || randomUUID(), requestHash, input.action, input.channel, input.target, input.threadRef || ""],
  );
  if ((inserted.rowCount || 0) > 0) return { ok: true, key, requestHash, source: "database" };

  const existing = await db.query(
    `select request_hash, status, result_json, created_at from provider_send_idempotency where idempotency_key = $1 limit 1`,
    [key],
  );
  const row = existing.rows[0];
  if (row?.request_hash && row.request_hash !== requestHash) {
    return { ok: false, status: 409, error: "Idempotency key reused with different payload.", key };
  }
  if (row?.status === "sent") {
    return { ok: false, status: 200, error: "Duplicate provider action replayed.", key, replay: true, result: row.result_json || {} };
  }
  if (row?.status === "pending" && isPendingFresh(row.created_at)) {
    return { ok: false, status: 409, error: "Provider action already in progress.", key };
  }

  await db.query(
    `update provider_send_idempotency
     set status = 'pending', request_id = $2, updated_at = now()
     where idempotency_key = $1`,
    [key, input.requestId || randomUUID()],
  );
  return { ok: true, key, requestHash, source: "database" };
}

export async function completeProviderAction(key: string, ok: boolean, result: StoredResult, error = "") {
  if (!key) return;
  if (!databaseEnabled()) {
    const existing = memoryDedupe.get(key);
    if (existing) {
      existing.status = ok ? "sent" : "failed";
      existing.result = result || null;
      existing.updatedAt = Date.now();
    }
    return;
  }
  await ensureTables();
  await getPool().query(
    `update provider_send_idempotency
     set status = $2, result_json = $3::jsonb, error_message = $4, updated_at = now()
     where idempotency_key = $1`,
    [key, ok ? "sent" : "failed", JSON.stringify(result || {}), error.slice(0, 500)],
  );
}
