import { randomUUID } from "node:crypto";

import { writeRequestAuditEvent } from "@/lib/requestAudit";
import type { TheoMetric } from "@/lib/theoTelemetry";
import { recordUsageAttempt } from "@/lib/usageLedger";

type MetricAuditBase = {
  requestId?: string;
  route: string;
  method?: string;
  channel: string;
  provider?: string;
  threadRef?: string;
  contactRef?: string;
  providerMessageId?: string;
};

/**
 * `TheoMetric.status` is an open string, not a boolean. Producers emit at least
 * `"ok"` (lib/theoLlm.ts), `"found" | "no_data"` (lib/theoData.ts,
 * lib/publicPropertyData.ts) and `"failed" | "timeout"` on a genuinely broken
 * call. Treating everything that is not `"ok"` as a failure recorded every
 * successful lookup that simply matched no rows as `failed`, permanently
 * inflating `failed` / deflating `successRate` in the append-only
 * `usage_cost_ledger` (see docs/audits/2026-09-model-routing/07-gauntlet-round1-partial.md D2).
 *
 * Only an explicit failure vocabulary counts as a failure. Anything else —
 * including a successful "no data" outcome — is a succeeded attempt.
 */
const METRIC_FAILURE_STATUSES = new Set(["failed", "error", "timeout", "rejected"]);

export function metricStatusIsFailure(status: string | null | undefined): boolean {
  return METRIC_FAILURE_STATUSES.has(String(status || "").trim().toLowerCase());
}

function metricCostUnits(metric: TheoMetric): Record<string, unknown> {
  const match = String(metric.detail || "").match(/^(.+?)\s+(\d+)in\/(\d+)out$/);
  if (!match) return { detail: metric.detail || "" };
  return {
    model: match[1],
    input_tokens: Number(match[2]),
    output_tokens: Number(match[3]),
  };
}

export async function writeTheoMetricAuditEvents(metrics: TheoMetric[], base: MetricAuditBase): Promise<void> {
  const correlationId = base.requestId || randomUUID();
  await Promise.allSettled(
    metrics.flatMap((metric, index) => {
      const units = metricCostUnits(metric);
      const failed = metricStatusIsFailure(metric.status);
      const audit = Number(metric.costUsd || 0) > 0
        ? writeRequestAuditEvent({
            requestId: correlationId,
            route: base.route,
            method: base.method || "LLM",
            channel: base.channel,
            provider: base.provider || metric.service,
            threadRef: base.threadRef || "",
            contactRef: base.contactRef || "",
            providerMessageId: base.providerMessageId || "",
            stage: metric.label || "agent_metric",
            outcome: failed ? "failed" : "sent",
            durationMs: metric.elapsedMs,
            errorCode: failed ? metric.status : "",
            costUsd: metric.costUsd || 0,
            costService: metric.service || "unknown",
            costUnits: units,
            metadata: { detail: metric.detail || "" },
          })
        : Promise.resolve();
      const ledger = recordUsageAttempt({
        correlationId,
        attemptId: `${correlationId}:${index}:${metric.label || "agent_metric"}:${metric.service || "unknown"}`,
        requestId: correlationId,
        agent: "theo",
        channel: base.channel,
        operation: metric.label || "agent_metric",
        provider: base.provider || metric.service,
        model: String(units.model || ""),
        status: failed ? "failed" : "succeeded",
        latencyMs: metric.elapsedMs,
        inputUnits: Number(units.input_tokens || 0),
        outputUnits: Number(units.output_tokens || 0),
        billableQuantity: Number(units.input_tokens || 0) + Number(units.output_tokens || 0),
        billableUnit: "tokens",
        costUsd: metric.costUsd || 0,
      });
      return [audit, ledger];
    }),
  );
}
