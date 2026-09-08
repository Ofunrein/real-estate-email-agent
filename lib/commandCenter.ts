export type CommandCenterWindow = "24h" | "7d" | "30d";

export type CommandCenterRange = {
  start: string;
  end: string;
  window: CommandCenterWindow;
};

export type CommandCenterClient = {
  id: string;
  name: string;
  status: "active" | "paused" | "onboarding" | "cancelled";
  planCode: string;
  planName: string;
  billingCurrency: string;
  monthlyPriceCents: number | null;
  monthlyAttemptQuota: number | null;
  monthlyInputUnitQuota: number | null;
  monthlyOutputUnitQuota: number | null;
  monthlySpendQuotaUsd: number | null;
  billingPeriodStartedAt: string;
  billingPeriodEndsAt: string;
  activatedAt: string;
};

export type UsageAttempt = {
  id: string;
  clientId: string;
  occurredAt: string;
  correlationId: string;
  attemptId: string;
  requestId: string;
  parentAttemptId: string;
  agent: string;
  channel: string;
  operation: string;
  provider: string;
  model: string;
  status: string;
  retryNumber: number;
  fallbackFromProvider: string;
  latencyMs: number | null;
  inputUnits: number;
  outputUnits: number;
  cacheReadUnits: number;
  cacheWriteUnits: number;
  billableQuantity: number;
  billableUnit: string;
  costUsd: number;
  metadata: Record<string, string | number | boolean>;
};

export type UsageAttemptInput = Partial<Omit<UsageAttempt, "id" | "occurredAt" | "metadata">> & {
  clientId: string;
  correlationId: string;
  attemptId: string;
  operation: string;
  status: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

export type CommandCenterTotals = {
  attempts: number;
  successful: number;
  failed: number;
  retries: number;
  fallbacks: number;
  successRate: number | null;
  costUsd: number;
  allocatedRevenueUsd: number | null;
  allocatedMarginUsd: number | null;
  marginPct: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

type QuotaMetric = { used: number; limit: number | null; percent: number | null };

export type CommandCenterTenant = CommandCenterClient & CommandCenterTotals & {
  errorRate: number | null;
  lastActivityAt: string;
  quota: {
    attempts: QuotaMetric;
    inputUnits: QuotaMetric;
    outputUnits: QuotaMetric;
    spendUsd: QuotaMetric;
  };
};

export type CommandCenterBreakdownRow = {
  key: string;
  attempts: number;
  successful: number;
  failed: number;
  successRate: number | null;
  retries: number;
  fallbacks: number;
  p95LatencyMs: number | null;
  costUsd: number;
};

export type CommandCenterTrace = {
  correlationId: string;
  clientId: string;
  clientName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number | null;
  attemptCount: number;
  hasRetry: boolean;
  hasFallback: boolean;
  hasError: boolean;
  costUsd: number;
  attempts: UsageAttempt[];
};

export type CommandCenterAggregate = {
  totals: CommandCenterTotals;
  tenants: CommandCenterTenant[];
  trend: Array<{ bucket: string; attempts: number; errors: number; costUsd: number; p95LatencyMs: number | null }>;
  breakdowns: Record<"agent" | "channel" | "provider" | "model" | "operation", CommandCenterBreakdownRow[]>;
  traces: CommandCenterTrace[];
  emptyReason: string;
};

const LEDGER_METADATA_ALLOWLIST = new Set([
  "region",
  "finish_reason",
  "cache_hit",
  "rate_limit_tier",
  "provider_request_id",
]);

function required(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function text(value: unknown, max = 120): string {
  return String(value || "").trim().slice(0, max);
}

function nonnegative(value: unknown, integer = true): number {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return integer ? Math.round(number) : Math.round(number * 1e10) / 1e10;
}

function nullableNonnegative(value: unknown): number | null {
  if (value == null || value === "") return null;
  return nonnegative(value);
}

export function normalizeUsageAttempt(input: UsageAttemptInput): UsageAttempt {
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input.metadata || {})) {
    if (!LEDGER_METADATA_ALLOWLIST.has(key)) continue;
    if (typeof value === "boolean") metadata[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) metadata[key] = value;
    else if (typeof value === "string") metadata[key] = value.slice(0, 120);
  }
  return {
    id: "",
    clientId: required(input.clientId, "clientId"),
    occurredAt: input.occurredAt || new Date().toISOString(),
    correlationId: required(input.correlationId, "correlationId"),
    attemptId: required(input.attemptId, "attemptId"),
    requestId: text(input.requestId),
    parentAttemptId: text(input.parentAttemptId),
    agent: text(input.agent, 80),
    channel: text(input.channel, 40),
    operation: required(input.operation, "operation").slice(0, 80),
    provider: text(input.provider, 80),
    model: text(input.model, 120),
    status: required(input.status, "status").slice(0, 40),
    retryNumber: nonnegative(input.retryNumber),
    fallbackFromProvider: text(input.fallbackFromProvider, 80),
    latencyMs: nullableNonnegative(input.latencyMs),
    inputUnits: nonnegative(input.inputUnits),
    outputUnits: nonnegative(input.outputUnits),
    cacheReadUnits: nonnegative(input.cacheReadUnits),
    cacheWriteUnits: nonnegative(input.cacheWriteUnits),
    billableQuantity: nonnegative(input.billableQuantity, false),
    billableUnit: text(input.billableUnit, 40),
    costUsd: nonnegative(input.costUsd, false),
    metadata,
  };
}

function rounded(value: number, places = 10): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function isSuccess(attempt: UsageAttempt): boolean {
  return ["succeeded", "success", "sent", "completed", "ok"].includes(attempt.status.toLowerCase());
}

function percentile(values: Array<number | null>, p: number): number | null {
  const sorted = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function allocatedRevenue(client: CommandCenterClient, range: CommandCenterRange): number | null {
  if (client.monthlyPriceCents == null) return null;
  const rangeMs = Math.max(0, Date.parse(range.end) - Date.parse(range.start));
  const configuredPeriodMs = Date.parse(client.billingPeriodEndsAt) - Date.parse(client.billingPeriodStartedAt);
  const periodMs = Number.isFinite(configuredPeriodMs) && configuredPeriodMs > 0
    ? configuredPeriodMs
    : 30 * 24 * 60 * 60 * 1000;
  return rounded((client.monthlyPriceCents / 100) * (rangeMs / periodMs), 2);
}

function totalsFor(
  attempts: UsageAttempt[],
  clients: CommandCenterClient[],
  range: CommandCenterRange,
): CommandCenterTotals {
  const successful = attempts.filter(isSuccess).length;
  const failed = attempts.length - successful;
  const costUsd = rounded(attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0));
  const revenues = clients.map((client) => allocatedRevenue(client, range));
  const allocatedRevenueUsd = revenues.some((value) => value == null)
    ? null
    : rounded((revenues as number[]).reduce((sum, value) => sum + value, 0), 2);
  const allocatedMarginUsd = allocatedRevenueUsd == null ? null : rounded(allocatedRevenueUsd - costUsd, 2);
  return {
    attempts: attempts.length,
    successful,
    failed,
    retries: attempts.filter((attempt) => attempt.retryNumber > 0).length,
    fallbacks: attempts.filter((attempt) => Boolean(attempt.fallbackFromProvider)).length,
    successRate: attempts.length ? rounded((successful / attempts.length) * 100, 2) : null,
    costUsd,
    allocatedRevenueUsd,
    allocatedMarginUsd,
    marginPct: allocatedRevenueUsd && allocatedMarginUsd != null
      ? rounded((allocatedMarginUsd / allocatedRevenueUsd) * 100, 2)
      : null,
    p50LatencyMs: percentile(attempts.map((attempt) => attempt.latencyMs), 0.5),
    p95LatencyMs: percentile(attempts.map((attempt) => attempt.latencyMs), 0.95),
  };
}

function quota(used: number, limit: number | null): QuotaMetric {
  return {
    used: rounded(used),
    limit,
    percent: limit && limit > 0 ? rounded((used / limit) * 100, 2) : null,
  };
}

function breakdown(attempts: UsageAttempt[], keyFor: (attempt: UsageAttempt) => string): CommandCenterBreakdownRow[] {
  const groups = new Map<string, UsageAttempt[]>();
  for (const attempt of attempts) {
    const key = keyFor(attempt) || "Unspecified";
    groups.set(key, [...(groups.get(key) || []), attempt]);
  }
  return Array.from(groups.entries()).map(([key, rows]) => {
    const successful = rows.filter(isSuccess).length;
    return {
      key,
      attempts: rows.length,
      successful,
      failed: rows.length - successful,
      successRate: rows.length ? rounded((successful / rows.length) * 100, 2) : null,
      retries: rows.filter((row) => row.retryNumber > 0).length,
      fallbacks: rows.filter((row) => Boolean(row.fallbackFromProvider)).length,
      p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.95),
      costUsd: rounded(rows.reduce((sum, row) => sum + row.costUsd, 0)),
    };
  }).sort((a, b) => b.attempts - a.attempts || b.costUsd - a.costUsd || a.key.localeCompare(b.key));
}

function tracesFor(attempts: UsageAttempt[], clients: CommandCenterClient[]): CommandCenterTrace[] {
  const names = new Map(clients.map((client) => [client.id, client.name]));
  // Group by tenant AND correlation id: correlation ids originate from upstream request ids and
  // are not guaranteed unique across tenants, so keying on correlation id alone would merge two
  // tenants' attempts into one trace and leak cross-tenant cost/latency in platform-admin scope.
  const groups = new Map<string, UsageAttempt[]>();
  for (const attempt of attempts) {
    const key = `${attempt.clientId}\u0000${attempt.correlationId}`;
    groups.set(key, [...(groups.get(key) || []), attempt]);
  }
  return Array.from(groups.values()).map((rows) => {
    const ordered = [...rows].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const correlationId = ordered[0].correlationId;
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const startMs = Date.parse(first.occurredAt);
    const endMs = Date.parse(last.occurredAt);
    return {
      correlationId,
      clientId: first.clientId,
      clientName: names.get(first.clientId) || first.clientId,
      startedAt: first.occurredAt,
      completedAt: last.occurredAt,
      durationMs: Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, endMs - startMs + (last.latencyMs || 0))
        : null,
      attemptCount: ordered.length,
      hasRetry: ordered.some((row) => row.retryNumber > 0),
      hasFallback: ordered.some((row) => Boolean(row.fallbackFromProvider)),
      hasError: ordered.some((row) => !isSuccess(row)),
      costUsd: rounded(ordered.reduce((sum, row) => sum + row.costUsd, 0)),
      attempts: ordered,
    };
  }).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 100);
}

function trendFor(attempts: UsageAttempt[], range: CommandCenterRange): CommandCenterAggregate["trend"] {
  const hourly = range.window === "24h";
  const groups = new Map<string, UsageAttempt[]>();
  for (const attempt of attempts) {
    const date = new Date(attempt.occurredAt);
    if (!Number.isFinite(date.getTime())) continue;
    const bucket = hourly
      ? `${date.toISOString().slice(0, 13)}:00:00.000Z`
      : `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
    groups.set(bucket, [...(groups.get(bucket) || []), attempt]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([bucket, rows]) => ({
    bucket,
    attempts: rows.length,
    errors: rows.filter((row) => !isSuccess(row)).length,
    costUsd: rounded(rows.reduce((sum, row) => sum + row.costUsd, 0)),
    p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.95),
  }));
}

export function aggregateCommandCenter(input: {
  clients: CommandCenterClient[];
  attempts: UsageAttempt[];
  range: CommandCenterRange;
}): CommandCenterAggregate {
  const tenants = input.clients.map((client) => {
    const attempts = input.attempts.filter((attempt) => attempt.clientId === client.id);
    const totals = totalsFor(attempts, [client], input.range);
    const inputUnits = attempts.reduce((sum, attempt) => sum + attempt.inputUnits, 0);
    const outputUnits = attempts.reduce((sum, attempt) => sum + attempt.outputUnits, 0);
    return {
      ...client,
      ...totals,
      errorRate: attempts.length ? rounded((totals.failed / attempts.length) * 100, 2) : null,
      lastActivityAt: [...attempts].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0]?.occurredAt || "",
      quota: {
        attempts: quota(attempts.length, client.monthlyAttemptQuota),
        inputUnits: quota(inputUnits, client.monthlyInputUnitQuota),
        outputUnits: quota(outputUnits, client.monthlyOutputUnitQuota),
        spendUsd: quota(totals.costUsd, client.monthlySpendQuotaUsd),
      },
    };
  }).sort((a, b) => b.attempts - a.attempts || a.name.localeCompare(b.name));

  return {
    totals: totalsFor(input.attempts, input.clients, input.range),
    tenants,
    trend: trendFor(input.attempts, input.range),
    breakdowns: {
      agent: breakdown(input.attempts, (attempt) => attempt.agent),
      channel: breakdown(input.attempts, (attempt) => attempt.channel),
      provider: breakdown(input.attempts, (attempt) => attempt.provider),
      model: breakdown(input.attempts, (attempt) => attempt.model),
      operation: breakdown(input.attempts, (attempt) => attempt.operation),
    },
    traces: tracesFor(input.attempts, input.clients),
    emptyReason: input.attempts.length ? "" : "No usage attempts recorded in this period.",
  };
}

export function commandCenterRange(window: CommandCenterWindow, now = new Date()): CommandCenterRange {
  const durationMs = window === "24h" ? 24 * 60 * 60 * 1000 : window === "7d" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return {
    start: new Date(now.getTime() - durationMs).toISOString(),
    end: now.toISOString(),
    window,
  };
}
