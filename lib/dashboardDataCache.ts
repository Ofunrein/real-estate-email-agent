type CacheResult = { value: string; cacheStatus: "MISS" | "HIT" | "WAIT" | "STALE" };

const TTL_MS = Number(process.env.IRIS_DASHBOARD_DATA_CACHE_MS || 30_000);
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

let memoryValue = "";
let memoryExpiresAt = 0;
let inflight: Promise<string> | null = null;

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
  if (memoryValue && memoryExpiresAt > now) return { value: memoryValue, cacheStatus: "HIT" };

  if (inflight) return { value: await inflight, cacheStatus: "WAIT" };
  inflight = (async () => {
    const external = await externalGet(key);
    if (external) {
      memoryValue = external;
      memoryExpiresAt = Date.now() + TTL_MS;
      return external;
    }

    const value = await loader();
    memoryValue = value;
    memoryExpiresAt = Date.now() + TTL_MS;
    await externalSet(key, value);
    return value;
  })()
    .finally(() => {
      inflight = null;
    });

  try {
    return { value: await inflight, cacheStatus: "MISS" };
  } catch (error) {
    if (memoryValue) return { value: memoryValue, cacheStatus: "STALE" };
    throw error;
  }
}

export function dashboardDataCacheMode() {
  return externalCacheEnabled() ? "external+memory" : "memory";
}
