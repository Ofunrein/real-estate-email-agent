import { Pool } from "pg";

import {
  aggregateCommandCenter,
  type CommandCenterAggregate,
  type CommandCenterClient,
  type CommandCenterRange,
  type UsageAttempt,
} from "@/lib/commandCenter";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for command-center reads");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: Number(process.env.USAGE_CAP_DATABASE_POOL_MAX || 2),
    });
  }
  return pool;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function iso(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function clientFromRow(row: Record<string, unknown>): CommandCenterClient {
  const status = String(row.status || "active");
  return {
    id: String(row.id || ""),
    name: String(row.name || row.id || ""),
    status: ["active", "paused", "onboarding", "cancelled"].includes(status)
      ? status as CommandCenterClient["status"]
      : "active",
    planCode: String(row.plan_code || ""),
    planName: String(row.plan_name || ""),
    billingCurrency: String(row.billing_currency || "USD"),
    monthlyPriceCents: nullableNumber(row.monthly_price_cents),
    monthlyAttemptQuota: nullableNumber(row.monthly_attempt_quota),
    monthlyInputUnitQuota: nullableNumber(row.monthly_input_unit_quota),
    monthlyOutputUnitQuota: nullableNumber(row.monthly_output_unit_quota),
    monthlySpendQuotaUsd: nullableNumber(row.monthly_spend_quota_usd),
    billingPeriodStartedAt: iso(row.billing_period_started_at),
    billingPeriodEndsAt: iso(row.billing_period_ends_at),
    activatedAt: iso(row.activated_at),
  };
}

function attemptFromRow(row: Record<string, unknown>): UsageAttempt {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, string | number | boolean>
    : {};
  return {
    id: String(row.id || ""),
    clientId: String(row.client_id || ""),
    occurredAt: iso(row.occurred_at),
    correlationId: String(row.correlation_id || ""),
    attemptId: String(row.attempt_id || ""),
    requestId: String(row.request_id || ""),
    parentAttemptId: String(row.parent_attempt_id || ""),
    agent: String(row.agent || ""),
    channel: String(row.channel || ""),
    operation: String(row.operation || ""),
    provider: String(row.provider || ""),
    model: String(row.model || ""),
    status: String(row.status || ""),
    retryNumber: Number(row.retry_number || 0),
    fallbackFromProvider: String(row.fallback_from_provider || ""),
    latencyMs: nullableNumber(row.latency_ms),
    inputUnits: Number(row.input_units || 0),
    outputUnits: Number(row.output_units || 0),
    cacheReadUnits: Number(row.cache_read_units || 0),
    cacheWriteUnits: Number(row.cache_write_units || 0),
    billableQuantity: Number(row.billable_quantity || 0),
    billableUnit: String(row.billable_unit || ""),
    costUsd: Number(row.cost_usd || 0),
    metadata,
  };
}

async function commandCenterSchemaAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const result = await getPool().query(
    `select
       bool_or(to_regclass('public.usage_cost_ledger') is not null) as ledger_exists,
       count(*) filter (
         where table_name = 'clients'
           and column_name in ('status', 'plan_code', 'monthly_price_cents', 'monthly_attempt_quota')
       )::int as client_columns
     from information_schema.columns
     where table_schema = 'public'`,
  );
  return Boolean(result.rows[0]?.ledger_exists) && Number(result.rows[0]?.client_columns || 0) === 4;
}

export type CommandCenterSnapshot = CommandCenterAggregate & {
  schemaAvailable: boolean;
  freshness: string;
};

function unavailableSnapshot(range: CommandCenterRange): CommandCenterSnapshot {
  return {
    ...aggregateCommandCenter({ clients: [], attempts: [], range }),
    schemaAvailable: false,
    freshness: "",
    emptyReason: "Usage ledger is not available. Create and review the command-center migration before collecting data.",
  };
}

export async function readCommandCenterSnapshot(input: {
  tenantId: string | null;
  allTenants: boolean;
  range: CommandCenterRange;
}): Promise<CommandCenterSnapshot> {
  if (!process.env.DATABASE_URL || !(await commandCenterSchemaAvailable())) {
    return unavailableSnapshot(input.range);
  }

  const clientResult = await getPool().query(
    `select id, name, status, plan_code, plan_name, billing_currency,
            monthly_price_cents, monthly_attempt_quota,
            monthly_input_unit_quota, monthly_output_unit_quota,
            monthly_spend_quota_usd, billing_period_started_at,
            billing_period_ends_at, activated_at
       from clients
      where ($1::text is null and status = 'active')
         or ($1::text is not null and id = $1)
      order by name asc`,
    [input.allTenants ? null : input.tenantId],
  );
  const clients = clientResult.rows.map(clientFromRow);
  const clientIds = clients.map((client) => client.id);
  if (!clientIds.length) {
    return {
      ...aggregateCommandCenter({ clients, attempts: [], range: input.range }),
      schemaAvailable: true,
      freshness: new Date().toISOString(),
      emptyReason: input.tenantId ? "Tenant not found or unavailable." : "No active tenants are configured.",
    };
  }

  const attemptResult = await getPool().query(
    `select id, client_id, occurred_at, correlation_id, attempt_id, request_id,
            parent_attempt_id, agent, channel, operation, provider, model,
            status, retry_number, fallback_from_provider, latency_ms,
            input_units, output_units, cache_read_units, cache_write_units,
            billable_quantity, billable_unit, cost_usd, metadata
       from usage_cost_ledger
      where client_id = any($1::text[])
        and occurred_at >= $2::timestamptz
        and occurred_at < $3::timestamptz
      order by occurred_at desc
      limit 10000`,
    [clientIds, input.range.start, input.range.end],
  );
  const attempts = attemptResult.rows.map(attemptFromRow);
  return {
    ...aggregateCommandCenter({ clients, attempts, range: input.range }),
    schemaAvailable: true,
    freshness: new Date().toISOString(),
  };
}
