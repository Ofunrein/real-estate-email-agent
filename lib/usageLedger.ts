import { Pool } from "pg";

import { normalizeUsageAttempt, type UsageAttemptInput } from "@/lib/commandCenter";
import { activeClientId } from "@/lib/tenant";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for usage ledger writes");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: Number(process.env.USAGE_CAP_DATABASE_POOL_MAX || 2),
    });
  }
  return pool;
}

export type RecordUsageAttemptInput = Omit<UsageAttemptInput, "clientId"> & {
  clientId?: string;
};

export async function recordUsageAttempt(input: RecordUsageAttemptInput): Promise<boolean> {
  const attempt = normalizeUsageAttempt({
    ...input,
    clientId: input.clientId || activeClientId(),
  });
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV !== "test") {
      console.info("[usage-ledger] database unavailable", {
        clientId: attempt.clientId,
        correlationId: attempt.correlationId,
        attemptId: attempt.attemptId,
        status: attempt.status,
      });
    }
    return false;
  }

  try {
    const result = await getPool().query(
      `insert into usage_cost_ledger (
          client_id, occurred_at, correlation_id, attempt_id, request_id,
          parent_attempt_id, agent, channel, operation, provider, model,
          status, retry_number, fallback_from_provider, latency_ms,
          input_units, output_units, cache_read_units, cache_write_units,
          billable_quantity, billable_unit, cost_usd, metadata
        ) values (
          $1, $2::timestamptz, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20, $21, $22, $23::jsonb
        )
        on conflict (client_id, attempt_id) do nothing
        returning id`,
      [
        attempt.clientId,
        attempt.occurredAt,
        attempt.correlationId,
        attempt.attemptId,
        attempt.requestId,
        attempt.parentAttemptId,
        attempt.agent,
        attempt.channel,
        attempt.operation,
        attempt.provider,
        attempt.model,
        attempt.status,
        attempt.retryNumber,
        attempt.fallbackFromProvider,
        attempt.latencyMs,
        attempt.inputUnits,
        attempt.outputUnits,
        attempt.cacheReadUnits,
        attempt.cacheWriteUnits,
        attempt.billableQuantity,
        attempt.billableUnit,
        attempt.costUsd,
        JSON.stringify(attempt.metadata),
      ],
    );
    return Boolean(result.rowCount);
  } catch (error) {
    console.warn("[usage-ledger] write failed", {
      clientId: attempt.clientId,
      correlationId: attempt.correlationId,
      attemptId: attempt.attemptId,
      errorCode: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }
}
