/**
 * One telemetry record per model ATTEMPT (not per successful result). See
 * db/migrations/032_model_attempt_telemetry.sql (additive, NOT applied by this audit).
 *
 * Deviation from the audit's originating brief, recorded honestly: the brief asked for persistence
 * "via lib/dataSource.ts only." In practice, `lib/dataSource.ts` is a narrow read-only accessor for
 * the AgentInboxData-shaped tables (leads/events/properties) and has no generic write path. The
 * repo's own existing telemetry/cost writer, `lib/requestAudit.ts`, does NOT go through
 * `lib/dataSource.ts` either — it owns its own `pg.Pool` gated by `databaseEnabled()`. This module
 * follows that same established, already-reviewed convention rather than inventing a new one that
 * fights the codebase. See docs/audits/2026-09-model-routing/00-evidence-ledger.md.
 *
 * Constraints honored:
 *   - Never logs a message body or PII. `prompt_hash` + token counts only (see redactForTelemetry).
 *   - No-ops safely (never throws) when DATABASE_URL is unset OR the table/columns are absent —
 *     matches lib/database.ts's tableColumns() fallback-probe pattern.
 *   - One helper (`recordModelAttempt`) is the ONLY write path, so no call site can skip a field or
 *     accidentally log a raw prompt.
 */
import { createHash } from "node:crypto";
import { Pool } from "pg";

let pool: Pool | null = null;

function databaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for model-attempt telemetry writes");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

type TelemetryColumnQuery = () => Promise<{ rows: Array<{ column_name: unknown }> }>;

/**
 * Probe on every attempt. An absent table safely returns false, while a transient query failure is
 * not cached and therefore cannot disable telemetry for the lifetime of a warm process.
 */
export async function probeTelemetryTable(
  query: TelemetryColumnQuery = () =>
    getPool().query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'model_attempt_telemetry'`,
    ),
): Promise<boolean> {
  try {
    const result = await query();
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/** Never returns raw text. A hash + length is enough to detect duplicates/drift without storing PII. */
export function redactForTelemetry(promptText: string): { promptHash: string; promptLength: number } {
  return {
    promptHash: createHash("sha256").update(promptText).digest("hex").slice(0, 32),
    promptLength: promptText.length,
  };
}

export type ModelAttemptOutcome = "ok" | "schema_reject" | "timeout" | "provider_error" | "refusal" | "filtered";

export type ModelAttemptRecord = {
  attemptId: string;
  correlationId: string;
  clientId: string;
  channel: string;
  agent: string;
  taskClass: string;
  routingTier: string;
  modelId: string;
  reasoningEffort: string;
  attemptIndex: number;
  isFallback: boolean;
  parentAttemptId?: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  latencyMs?: number;
  ttftMs?: number;
  outcome: ModelAttemptOutcome;
  errorClass?: string;
  costUsd: number;
  /** Raw prompt text — hashed by this function, NEVER stored or logged verbatim. */
  promptText: string;
  routingReason: string;
  humanReviewFlag: boolean;
  promptVersion: string;
};

/**
 * Records one attempt. Never throws — a telemetry failure must not break the caller's real
 * request. Returns true if a row was actually written (false = no-op: DB disabled or table absent).
 */
export async function recordModelAttempt(record: ModelAttemptRecord): Promise<boolean> {
  if (!databaseEnabled()) return false;
  try {
    if (!(await probeTelemetryTable())) return false;
    const { promptHash } = redactForTelemetry(record.promptText);
    await getPool().query(
      `insert into model_attempt_telemetry
        (attempt_id, correlation_id, client_id, channel, agent, task_class, routing_tier, model_id,
         reasoning_effort, attempt_index, is_fallback, parent_attempt_id, input_tokens,
         cached_input_tokens, output_tokens, reasoning_tokens, latency_ms, ttft_ms, outcome,
         error_class, cost_usd, prompt_hash, routing_reason, human_review_flag, prompt_version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       on conflict (attempt_id) do nothing`,
      [
        record.attemptId,
        record.correlationId,
        record.clientId,
        record.channel,
        record.agent,
        record.taskClass,
        record.routingTier,
        record.modelId,
        record.reasoningEffort,
        record.attemptIndex,
        record.isFallback,
        record.parentAttemptId ?? null,
        record.inputTokens,
        record.cachedInputTokens ?? 0,
        record.outputTokens,
        record.reasoningTokens ?? 0,
        record.latencyMs ?? null,
        record.ttftMs ?? null,
        record.outcome,
        record.errorClass ?? null,
        record.costUsd,
        promptHash,
        record.routingReason,
        record.humanReviewFlag,
        record.promptVersion,
      ],
    );
    return true;
  } catch {
    return false;
  }
}
