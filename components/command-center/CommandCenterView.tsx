"use client";

import React from "react";
import { RefreshCw } from "lucide-react";

import {
  captureProductEvent,
  captureProductException,
  internalTrafficEnabled,
  setInternalTrafficEnabled,
} from "@/components/analytics/ProductAnalyticsProvider";
import type {
  CommandCenterAggregate,
  CommandCenterBreakdownRow,
  CommandCenterTenant,
  CommandCenterTrace,
  CommandCenterWindow,
} from "@/lib/commandCenter";

type Breakdown = "agent" | "channel" | "provider" | "model" | "operation";

type CommandCenterPayload = CommandCenterAggregate & {
  viewer: {
    role: "tenant_user" | "platform_admin";
    workspaceId: string;
    workspaceName: string;
  };
  range: { start: string; end: string; window: CommandCenterWindow };
  schemaAvailable: boolean;
  freshness: string;
  selectedTrace: CommandCenterTrace | null;
};

const WINDOWS: Array<{ value: CommandCenterWindow; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];
const BREAKDOWNS: Breakdown[] = ["provider", "model", "channel", "agent", "operation"];

function money(value: number | null, currency = "USD") {
  if (value == null) return "Not configured";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function integer(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}

function percent(value: number | null) {
  return value == null ? "No data" : `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

function latency(value: number | null) {
  if (value == null) return "No data";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${integer(value)}ms`;
}

function when(value: string) {
  if (!value) return "No activity";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string) {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

export function CommandCenterView() {
  const [windowValue, setWindowValue] = React.useState<CommandCenterWindow>("7d");
  const [tenantId, setTenantId] = React.useState("");
  const [breakdown, setBreakdown] = React.useState<Breakdown>("provider");
  const [data, setData] = React.useState<CommandCenterPayload | null>(null);
  const [tenantOptions, setTenantOptions] = React.useState<CommandCenterTenant[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [reload, setReload] = React.useState(0);
  const [internalTraffic, setInternalTraffic] = React.useState(false);

  React.useEffect(() => setInternalTraffic(internalTrafficEnabled()), []);

  React.useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ window: windowValue });
        if (tenantId) params.set("tenantId", tenantId);
        const response = await fetch(`/api/command-center?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({})) as CommandCenterPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Command-center data could not be loaded.");
        setData(payload);
        if (payload.viewer.role === "platform_admin" && !tenantId) {
          setTenantOptions(payload.tenants);
        }
        captureProductEvent("command_center_viewed", {
          tenant_id: tenantId || payload.viewer.workspaceId,
          viewer_role: payload.viewer.role,
          window: windowValue,
          section: "command-center",
          has_data: payload.totals.attempts > 0,
        });
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Command-center data could not be loaded.");
        captureProductException(loadError, {
          component: "command-center",
          runtime: "client",
          error_code: "command_center_load_failed",
        });
        captureProductEvent("dashboard_load_failed", {
          component: "command-center",
          runtime: "client",
          error_code: "command_center_load_failed",
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [reload, tenantId, windowValue]);

  const selectedTenant = data?.tenants.length === 1 ? data.tenants[0] : null;
  const quotaWatch = data?.tenants.filter((tenant) =>
    [tenant.quota.attempts.percent, tenant.quota.spendUsd.percent].some((value) => value != null && value >= 80),
  ).length || 0;
  const summary = data ? [
    { label: "Attempts", value: integer(data.totals.attempts), detail: `${integer(data.totals.retries)} retries · ${integer(data.totals.fallbacks)} fallbacks` },
    { label: "Success rate", value: percent(data.totals.successRate), detail: `${integer(data.totals.failed)} failed` },
    { label: "Provider spend", value: money(data.totals.costUsd), detail: "Immutable ledger" },
    { label: "Allocated margin", value: money(data.totals.allocatedMarginUsd), detail: data.totals.marginPct == null ? "Plan price required" : `${percent(data.totals.marginPct)} margin` },
    { label: "P95 latency", value: latency(data.totals.p95LatencyMs), detail: `P50 ${latency(data.totals.p50LatencyMs)}` },
    selectedTenant
      ? { label: "Attempt quota", value: percent(selectedTenant.quota.attempts.percent), detail: selectedTenant.quota.attempts.limit == null ? "Unlimited" : `${integer(selectedTenant.quota.attempts.used)} of ${integer(selectedTenant.quota.attempts.limit)}` }
      : { label: "Quota watch", value: integer(quotaWatch), detail: "Tenants at or above 80%" },
  ] : [];

  return (
    <section className="command-center" aria-labelledby="command-center-title">
      <header className="command-center-header">
        <div>
          <p className="command-center-kicker">Operations and economics</p>
          <h1 id="command-center-title">Command center</h1>
          <p>{data?.viewer.role === "platform_admin" ? "Platform-wide tenant health and usage." : "Your workspace health and usage."}</p>
        </div>
        <div className="command-center-controls" aria-label="Command center filters">
          {data?.viewer.role === "platform_admin" && (
            <label>
              <span>Tenant</span>
              <select
                value={tenantId}
                onChange={(event) => {
                  setTenantId(event.target.value);
                  captureProductEvent("command_center_scope_changed", {
                    tenant_id: event.target.value || data.viewer.workspaceId,
                    viewer_role: data.viewer.role,
                    window: windowValue,
                  });
                }}
              >
                <option value="">All active tenants</option>
                {tenantOptions.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
              </select>
            </label>
          )}
          <label>
            <span>Period</span>
            <select
              value={windowValue}
              onChange={(event) => {
                const value = event.target.value as CommandCenterWindow;
                setWindowValue(value);
                captureProductEvent("command_center_window_changed", {
                  tenant_id: tenantId || data?.viewer.workspaceId || "",
                  viewer_role: data?.viewer.role || "tenant_user",
                  window: value,
                });
              }}
            >
              {WINDOWS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="command-center-refresh"
            onClick={() => {
              setReload((value) => value + 1);
              captureProductEvent("command_center_refresh_requested", {
                tenant_id: tenantId || data?.viewer.workspaceId || "",
                viewer_role: data?.viewer.role || "tenant_user",
                window: windowValue,
              });
            }}
            disabled={loading}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
          {data?.viewer.role === "platform_admin" && (
            <label className="command-center-internal-toggle">
              <input
                type="checkbox"
                checked={internalTraffic}
                onChange={(event) => {
                  setInternalTraffic(event.target.checked);
                  setInternalTrafficEnabled(event.target.checked);
                }}
              />
              Mark my demo visits internal
            </label>
          )}
        </div>
      </header>

      <div className="command-center-status" aria-live="polite">
        {loading ? "Loading actual usage…" : error || (data?.freshness ? `Updated ${when(data.freshness)}` : "No ledger data loaded")}
      </div>

      {error && (
        <div className="command-center-state is-error" role="alert">
          <strong>Command center unavailable</strong>
          <p>{error}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button>
        </div>
      )}

      {!error && loading && !data && <LoadingState />}

      {!error && data && (
        <>
          {!data.schemaAvailable && (
            <div className="command-center-state">
              <strong>Usage ledger not ready</strong>
              <p>{data.emptyReason}</p>
            </div>
          )}

          <div className="command-center-summary">
            {summary.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>

          {data.totals.attempts === 0 ? (
            <div className="command-center-state">
              <strong>No usage for this period</strong>
              <p>{data.emptyReason}</p>
            </div>
          ) : (
            <TrendChart data={data.trend} />
          )}

          {data.viewer.role === "platform_admin" && !tenantId && data.tenants.length > 0 && (
            <TenantTable tenants={data.tenants} onSelect={setTenantId} />
          )}

          <section className="command-center-section">
            <div className="command-center-section-head">
              <div>
                <h2>Usage breakdown</h2>
                <p>Compare actual attempts, reliability, latency, and spend.</p>
              </div>
              <div className="command-center-tabs" role="group" aria-label="Breakdown dimension">
                {BREAKDOWNS.map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={breakdown === item}
                    onClick={() => {
                      setBreakdown(item);
                      captureProductEvent("command_center_breakdown_changed", {
                        tenant_id: tenantId || data.viewer.workspaceId,
                        viewer_role: data.viewer.role,
                        window: windowValue,
                        breakdown: item,
                      });
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <BreakdownTable rows={data.breakdowns[breakdown]} label={breakdown} />
          </section>

          <TraceExplorer
            traces={data.traces}
            tenantId={tenantId || data.viewer.workspaceId}
            viewerRole={data.viewer.role}
            windowValue={windowValue}
          />
        </>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div className="command-center-loading" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
    </div>
  );
}

function TrendChart({ data }: { data: CommandCenterPayload["trend"] }) {
  const max = Math.max(1, ...data.map((point) => point.attempts));
  return (
    <section className="command-center-section">
      <div className="command-center-section-head">
        <div>
          <h2>Operational trend</h2>
          <p>Attempts, errors, and ledger spend by period.</p>
        </div>
      </div>
      <div className="command-center-trend" role="img" aria-label="Usage attempts, errors, and spend over time">
        {data.map((point) => (
          <div key={point.bucket}>
            <span>{when(point.bucket)}</span>
            <i style={{ width: `${Math.max(2, point.attempts / max * 100)}%` }}>
              <b style={{ width: `${point.attempts ? point.errors / point.attempts * 100 : 0}%` }} />
            </i>
            <strong>{integer(point.attempts)} attempts</strong>
            <em>{integer(point.errors)} errors · {money(point.costUsd)}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function TenantTable({ tenants, onSelect }: { tenants: CommandCenterTenant[]; onSelect: (tenantId: string) => void }) {
  return (
    <section className="command-center-section">
      <div className="command-center-section-head">
        <div><h2>Active tenants</h2><p>Commercial status and operating health.</p></div>
      </div>
      <div className="command-center-table-wrap" role="region" aria-label="Active tenants table" tabIndex={0}>
        <table>
          <caption>Active tenant plans, usage, economics, quota, and reliability</caption>
          <thead><tr><th>Tenant</th><th>Plan</th><th>Usage</th><th>Spend</th><th>Margin</th><th>Quota</th><th>Errors</th><th>P95</th><th>Last activity</th></tr></thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id}>
                <th scope="row"><button type="button" onClick={() => onSelect(tenant.id)}>{tenant.name}</button><small>{tenant.status}</small></th>
                <td>{tenant.planName || tenant.planCode || "Not configured"}<small>{money(tenant.monthlyPriceCents == null ? null : tenant.monthlyPriceCents / 100, tenant.billingCurrency)}/mo</small></td>
                <td>{integer(tenant.attempts)}</td>
                <td>{money(tenant.costUsd, tenant.billingCurrency)}</td>
                <td>{money(tenant.allocatedMarginUsd, tenant.billingCurrency)}</td>
                <td>{percent(tenant.quota.attempts.percent)}</td>
                <td>{percent(tenant.errorRate)}</td>
                <td>{latency(tenant.p95LatencyMs)}</td>
                <td>{when(tenant.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BreakdownTable({ rows, label }: { rows: CommandCenterBreakdownRow[]; label: string }) {
  return (
    <div className="command-center-table-wrap" role="region" aria-label={`${label} usage table`} tabIndex={0}>
      <table>
        <caption>Usage grouped by {label}</caption>
        <thead><tr><th>{label}</th><th>Attempts</th><th>Success</th><th>Retries</th><th>Fallbacks</th><th>P95</th><th>Spend</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.key}</th>
              <td>{integer(row.attempts)}</td>
              <td>{percent(row.successRate)}</td>
              <td>{integer(row.retries)}</td>
              <td>{integer(row.fallbacks)}</td>
              <td>{latency(row.p95LatencyMs)}</td>
              <td>{money(row.costUsd)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7}>No usage rows in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function TraceExplorer({ traces, tenantId, viewerRole, windowValue }: {
  traces: CommandCenterTrace[];
  tenantId: string;
  viewerRole: string;
  windowValue: CommandCenterWindow;
}) {
  return (
    <section className="command-center-section ph-no-capture" data-ph-no-capture>
      <div className="command-center-section-head">
        <div><h2>Request traces</h2><p>Provider attempts joined by privacy-safe correlation ID.</p></div>
      </div>
      <div className="command-center-traces">
        {traces.map((trace) => (
          <details
            key={`${trace.clientId}-${trace.correlationId}`}
            onToggle={(event) => {
              if (event.currentTarget.open) {
                captureProductEvent("command_center_trace_opened", {
                  tenant_id: tenantId,
                  viewer_role: viewerRole,
                  window: windowValue,
                  attempt_count_bucket: trace.attemptCount > 10 ? "11+" : trace.attemptCount > 3 ? "4-10" : "1-3",
                });
              }
            }}
          >
            <summary>
              <span><strong>{shortId(trace.correlationId)}</strong><small>{trace.clientName} · {when(trace.startedAt)}</small></span>
              <span>{trace.attemptCount} attempts</span>
              <span>{trace.hasError ? "Has errors" : "Successful"}</span>
              <span>{latency(trace.durationMs)}</span>
              <span>{money(trace.costUsd)}</span>
            </summary>
            <div className="command-center-table-wrap" role="region" aria-label={`Trace ${shortId(trace.correlationId)} attempts`} tabIndex={0}>
              <table>
                <caption>Ordered attempts for correlation {shortId(trace.correlationId)}</caption>
                <thead><tr><th>Attempt</th><th>Agent/channel</th><th>Provider/model</th><th>Status</th><th>Retry/fallback</th><th>Latency</th><th>Units</th><th>Cost</th></tr></thead>
                <tbody>
                  {trace.attempts.map((attempt) => (
                    <tr key={attempt.attemptId}>
                      <th scope="row">{shortId(attempt.attemptId)}<small>{attempt.operation}</small></th>
                      <td>{attempt.agent || "Unspecified"}<small>{attempt.channel || "Unspecified"}</small></td>
                      <td>{attempt.provider || "Unspecified"}<small>{attempt.model || "Unspecified"}</small></td>
                      <td>{attempt.status}</td>
                      <td>{attempt.retryNumber ? `Retry ${attempt.retryNumber}` : "Initial"}{attempt.fallbackFromProvider && <small>from {attempt.fallbackFromProvider}</small>}</td>
                      <td>{latency(attempt.latencyMs)}</td>
                      <td>{integer(attempt.inputUnits + attempt.outputUnits)}</td>
                      <td>{money(attempt.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
        {!traces.length && <p className="command-center-empty-row">No request traces in this period.</p>}
      </div>
    </section>
  );
}
