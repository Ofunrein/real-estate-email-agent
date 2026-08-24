type CacheResult = { value: string; cacheStatus: "MISS" | "HIT" | "WAIT" | "STALE" };
type MemoryEntry = { value: string; expiresAt: number };

const TTL_MS = Number(process.env.IRIS_DASHBOARD_DATA_CACHE_MS || 30_000);
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

// Keyed by cache key, not a module-level singleton. The key carries the tenant,
// so a shared value would serve one client's whole inbox to another.
const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<string>>();

function externalCacheEnabled() {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

async function externalCommand(args: unknown[]): Promise<unknown> {
  if (!externalCacheEnabled()) return null;
  const res = await fetch(UPSTASH_URL.replace(/\/$/, ""), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const payload = await res.json().catch(() => ({})) as { result?: unknown };
  return payload.result ?? null;
}

async function externalGet(key: string): Promise<string> {
  const result = await externalCommand(["GET", key]);
  return typeof result === "string" ? result : "";
}

async function externalSet(key: string, value: string, ttlMs = TTL_MS) {
  await externalCommand(["SET", key, value, "PX", Math.max(1000, Math.round(ttlMs))]).catch(() => undefined);
}

export async function cachedDashboardData(key: string, loader: () => Promise<string>): Promise<CacheResult> {
  const now = Date.now();
  const cached = memory.get(key);
  if (cached && cached.expiresAt > now) return { value: cached.value, cacheStatus: "HIT" };

  const pending = inflight.get(key);
  if (pending) return { value: await pending, cacheStatus: "WAIT" };

  const work = (async () => {
    const external = await externalGet(key);
    if (external) {
      memory.set(key, { value: external, expiresAt: Date.now() + TTL_MS });
      return external;
    }

    const value = await loader();
    memory.set(key, { value, expiresAt: Date.now() + TTL_MS });
    await externalSet(key, value);
    return value;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, work);

  try {
    return { value: await work, cacheStatus: "MISS" };
  } catch (error) {
    const stale = memory.get(key);
    if (stale) return { value: stale.value, cacheStatus: "STALE" };
    throw error;
  }
}

export function dashboardDataCacheMode() {
  return externalCacheEnabled() ? "external+memory" : "memory";
}
