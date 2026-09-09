type Hit = { count: number; resetsAt: number };

const hits = new Map<string, Hit>();

// ponytail: per-instance limiter; replace with shared KV before sending more than one bounded prospect demo.
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
