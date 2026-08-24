/**
 * Per-client usage caps.
 *
 * The audit trail already records cost_usd per request (migration 022) but
 * nothing ever read it back, so a runaway loop or an abusive inbound flood
 * spent until the provider's own limit stopped it — on the operator's card,
 * with no per-client attribution.
 *
 * These caps are a spend circuit breaker, not a billing system. They are
 * deliberately coarse (a rolling 24h window per client). When a configured cap
 * cannot be evaluated they fail CLOSED by default: a broken meter must not turn
 * a contractual spend limit into unlimited provider usage. Operators can opt
 * into availability-first behavior with USAGE_CAP_FAILURE_MODE=open.
 *
 * Caps are read from env so each deployment sets its own, sized to the client's
 * contract.
 */

import { Pool } from "pg";

import { activeClientId } from "@/lib/tenant";

export type UsageKind = "ai" | "sms" | "voice";

export type UsageVerdict = {
  allowed: boolean;
  kind: UsageKind;
  /** "" when allowed. */
  code: "" | "ai_daily_cost_cap" | "sms_daily_cap" | "voice_daily_cap" | "unavailable";
  reason: string;
  used: number;
  limit: number;
};

let pool: Pool | null = null;

function databaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for usage caps");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: Number(process.env.USAGE_CAP_DATABASE_POOL_MAX || 2),
    });
  }
  return pool;
}

function limitFor(kind: UsageKind): number {
  const raw = kind === "ai"
    ? process.env.CLIENT_DAILY_AI_COST_USD_CAP
    : kind === "sms"
      ? process.env.CLIENT_DAILY_SMS_CAP
      : process.env.CLIENT_DAILY_VOICE_CALL_CAP;
  const parsed = Number(String(raw ?? "").trim());
  // 0 or unset means uncapped. An explicit 0 to mean "block everything" would
  // be indistinguishable from a typo in an env var, which is a worse failure.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function usageCaps(): Record<UsageKind, number> {
  return { ai: limitFor("ai"), sms: limitFor("sms"), voice: limitFor("voice") };
}

function failOpenOnUnavailable(): boolean {
  return String(process.env.USAGE_CAP_FAILURE_MODE || "closed").trim().toLowerCase() === "open";
}

/** Rolling 24h usage for this client, from the audit trail. */
export async function usageInLastDay(kind: UsageKind, clientId = activeClientId()): Promise<number> {
  if (!databaseEnabled()) return 0;

  if (kind === "ai") {
    const result = await getPool().query<{ total: string }>(
      `select coalesce(sum(cost_usd), 0)::text as total
         from request_audit_events
        where client_id = $1
          and created_at > now() - interval '24 hours'`,
      [clientId],
    );
    return Number(result.rows[0]?.total || 0);
  }

  const channel = kind === "sms" ? "sms" : "voice";
  // `outcome = 'sent'` alone is far too broad: writeTheoMetricAuditEvents marks
  // each successful LLM call "sent" with channel "sms", and the webhook's own
  // respond() adds another. Counting those would trip a 500-message cap after
  // roughly 100 real texts. Only rows written at the provider send boundary
  // count, which is `stage = 'send'`.
  const result = await getPool().query<{ total: string }>(
    `select count(*)::text as total
       from request_audit_events
      where client_id = $1
        and channel = $2
        and stage = 'send'
        and outcome = 'sent'
        and created_at > now() - interval '24 hours'`,
    [clientId, channel],
  );
  return Number(result.rows[0]?.total || 0);
}

/**
 * May this client spend more of `kind` right now?
 *
 * Fails closed on a database error unless the deployment explicitly chooses
 * availability-first behavior with USAGE_CAP_FAILURE_MODE=open.
 */
export async function checkUsageCap(kind: UsageKind, clientId = activeClientId()): Promise<UsageVerdict> {
  const limit = limitFor(kind);
  if (!limit) {
    return { allowed: true, kind, code: "", reason: "uncapped", used: 0, limit: 0 };
  }

  let used: number;
  try {
    used = await usageInLastDay(kind, clientId);
  } catch {
    const allowed = failOpenOnUnavailable();
    return {
      allowed,
      kind,
      code: "unavailable",
      reason: allowed
        ? "Usage cap could not be evaluated; availability-first override allowed the request."
        : "Usage cap could not be evaluated; request parked to preserve the configured spend limit.",
      used: 0,
      limit,
    };
  }

  if (used < limit) {
    return { allowed: true, kind, code: "", reason: "within cap", used, limit };
  }

  const code = kind === "ai" ? "ai_daily_cost_cap" : kind === "sms" ? "sms_daily_cap" : "voice_daily_cap";
  const unit = kind === "ai" ? "USD" : kind === "sms" ? "messages" : "calls";
  return {
    allowed: false,
    kind,
    code,
    reason: `Client ${clientId} hit its 24h ${kind} cap (${used.toFixed(kind === "ai" ? 2 : 0)} of ${limit} ${unit}). Work is parked for human review.`,
    used,
    limit,
  };
}

export type UsageSnapshot = {
  clientId: string;
  window: "24h";
  usage: Array<{ kind: UsageKind; used: number; limit: number; pctOfCap: number | null }>;
};

/** Everything the health endpoint and the runbooks need, in one query set. */
export async function usageSnapshot(clientId = activeClientId()): Promise<UsageSnapshot> {
  const kinds: UsageKind[] = ["ai", "sms", "voice"];
  const usage = await Promise.all(kinds.map(async (kind) => {
    const limit = limitFor(kind);
    const used = await usageInLastDay(kind, clientId).catch(() => 0);
    return { kind, used, limit, pctOfCap: limit ? Math.round((used / limit) * 100) : null };
  }));
  return { clientId, window: "24h", usage };
}
