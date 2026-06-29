import { writeRequestAuditEvent } from "@/lib/requestAudit";
import type { TheoMetric } from "@/lib/theoTelemetry";

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
  await Promise.allSettled(
    metrics
      .filter((metric) => Number(metric.costUsd || 0) > 0)
      .map((metric) => writeRequestAuditEvent({
        requestId: base.requestId,
        route: base.route,
        method: base.method || "LLM",
        channel: base.channel,
        provider: base.provider || metric.service,
        threadRef: base.threadRef || "",
        contactRef: base.contactRef || "",
        providerMessageId: base.providerMessageId || "",
        stage: metric.label || "agent_metric",
        outcome: metric.status === "ok" ? "sent" : "failed",
        durationMs: metric.elapsedMs,
        errorCode: metric.status === "ok" ? "" : metric.status,
        costUsd: metric.costUsd || 0,
        costService: metric.service || "unknown",
        costUnits: metricCostUnits(metric),
        metadata: {
          detail: metric.detail || "",
        },
      })),
  );
}
