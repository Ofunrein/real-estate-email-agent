type Hit = { count: number; resetsAt: number };

const hits = new Map<string, Hit>();

// Per-instance burst guard only. On Vercel each serverless instance holds its own Map, so this
// cannot enforce a spend cap across instances -- durable caps live in Postgres
// (demo_public_api.reserve_email_generation / reserve_voice_session). Keep this for cheap
// per-IP throttling; do not add money-bounded limits here.
export function allowRequest(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = hits.get(key);
  if (!current || current.resetsAt <= now) {
    hits.set(key, { count: 1, resetsAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function clientAddress(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
