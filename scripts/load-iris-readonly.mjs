#!/usr/bin/env node
const baseUrl = process.env.BASE_URL || 'http://localhost:3317';
const users = Number(process.env.USERS || 100);
const durationMs = Number(process.env.DURATION_MS || process.env.DURATION_SECONDS * 1000 || 30_000);
const rampMs = Number(process.env.RAMP_MS || 10_000);
const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 15_000);
const thinkMinMs = Number(process.env.THINK_MIN_MS || 250);
const thinkMaxMs = Number(process.env.THINK_MAX_MS || 1000);

const endpoints = [
  { name: 'dashboard', path: '/?preview=1', weight: 40 },
  { name: 'inbox-data', path: '/api/data?preview=1', weight: 35 },
  { name: 'sms-takeover-read', path: '/api/threads/%2B15125712595/takeover?channel=sms', weight: 15 },
  { name: 'instagram-takeover-read', path: '/api/threads/martn.o/takeover?channel=instagram', weight: 10 },
];
const totalWeight = endpoints.reduce((sum, item) => sum + item.weight, 0);
const startedAt = Date.now();
const latencies = [];
const byEndpoint = new Map();
const byStatus = new Map();
const errors = new Map();
let total = 0;
let ok = 0;
let bytes = 0;
let active = 0;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function jitter(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function pickEndpoint() {
  let cursor = Math.random() * totalWeight;
  for (const endpoint of endpoints) {
    cursor -= endpoint.weight;
    if (cursor <= 0) return endpoint;
  }
  return endpoints[0];
}
function inc(map, key, amount = 1) { map.set(key, (map.get(key) || 0) + amount); }
function endpointStats(name) {
  if (!byEndpoint.has(name)) byEndpoint.set(name, { total: 0, ok: 0, failed: 0, latencies: [] });
  return byEndpoint.get(name);
}
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}
async function hit(endpoint, userId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  active += 1;
  try {
    const res = await fetch(`${baseUrl}${endpoint.path}`, {
      signal: controller.signal,
      headers: {
        'x-iris-load-test': 'readonly-100-users',
        'x-iris-load-user': String(userId),
      },
    });
    const body = await res.arrayBuffer();
    const ms = Math.round(performance.now() - start);
    const stat = endpointStats(endpoint.name);
    total += 1;
    stat.total += 1;
    stat.latencies.push(ms);
    latencies.push(ms);
    bytes += body.byteLength;
    inc(byStatus, String(res.status));
    if (res.ok) {
      ok += 1;
      stat.ok += 1;
    } else {
      stat.failed += 1;
      inc(errors, `${endpoint.name}:${res.status}`);
    }
  } catch (error) {
    const ms = Math.round(performance.now() - start);
    const stat = endpointStats(endpoint.name);
    total += 1;
    stat.total += 1;
    stat.failed += 1;
    stat.latencies.push(ms);
    latencies.push(ms);
    inc(errors, `${endpoint.name}:${error?.name || 'error'}`);
  } finally {
    clearTimeout(timeout);
    active -= 1;
  }
}
async function userLoop(userId) {
  await sleep(Math.floor((rampMs / Math.max(users, 1)) * userId));
  while (Date.now() - startedAt < durationMs) {
    await hit(pickEndpoint(), userId);
    await sleep(jitter(thinkMinMs, thinkMaxMs));
  }
}

await Promise.all(Array.from({ length: users }, (_, i) => userLoop(i + 1)));
const elapsedSeconds = (Date.now() - startedAt) / 1000;
const sorted = [...latencies].sort((a, b) => a - b);
const endpointSummary = Object.fromEntries([...byEndpoint.entries()].map(([name, stat]) => {
  const sortedEndpoint = [...stat.latencies].sort((a, b) => a - b);
  return [name, {
    total: stat.total,
    ok: stat.ok,
    failed: stat.failed,
    p50_ms: percentile(sortedEndpoint, 50),
    p95_ms: percentile(sortedEndpoint, 95),
    p99_ms: percentile(sortedEndpoint, 99),
  }];
}));
const summary = {
  baseUrl,
  users,
  duration_seconds: Math.round(elapsedSeconds * 10) / 10,
  total_requests: total,
  ok,
  failed: total - ok,
  success_rate: total ? Math.round((ok / total) * 10000) / 100 : 0,
  rps: Math.round((total / elapsedSeconds) * 100) / 100,
  transferred_mb: Math.round((bytes / 1024 / 1024) * 100) / 100,
  latency: {
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    max_ms: sorted.at(-1) || 0,
  },
  by_status: Object.fromEntries([...byStatus.entries()].sort()),
  by_endpoint: endpointSummary,
  errors: Object.fromEntries([...errors.entries()].sort((a, b) => b[1] - a[1])),
  active_at_end: active,
  safety: 'read-only GETs only; no SMS, voice calls, email, Instagram sends, or provider generation endpoints hit',
};
console.log(JSON.stringify(summary, null, 2));
if (summary.failed > 0 || summary.latency.p95_ms > Number(process.env.MAX_P95_MS || 5000)) process.exitCode = 1;
