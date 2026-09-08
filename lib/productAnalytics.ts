export const PRODUCT_ANALYTICS_EVENTS = [
  "command_center_viewed",
  "command_center_scope_changed",
  "command_center_window_changed",
  "command_center_breakdown_changed",
  "command_center_trace_opened",
  "command_center_refresh_requested",
  "dashboard_navigation_selected",
  "dashboard_load_failed",
  "feature_flag_evaluated",
  "demo_page_viewed",
  "demo_conversion",
  "internal_traffic_changed",
  "$exception",
] as const;

export type ProductAnalyticsEvent = typeof PRODUCT_ANALYTICS_EVENTS[number];

const EVENT_SET = new Set<string>(PRODUCT_ANALYTICS_EVENTS);
const PROPERTY_ALLOWLIST = new Set([
  "tenant_id",
  "viewer_role",
  "window",
  "section",
  "breakdown",
  "has_data",
  "attempt_count_bucket",
  "latency_bucket",
  "error_rate_bucket",
  "feature_flag",
  "flag_variant",
  "error_code",
  "component",
  "runtime",
  "page_kind",
  "demo_slug",
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "device_class",
  "conversion_kind",
  "is_internal",
  "is_test",
  "is_bot",
  "counts_toward_kpi",
]);
const FORBIDDEN_KEY = /(message|body|content|prompt|completion|transcript|email|phone|name|address|token|secret|auth|cookie|legal|lending|fair.?housing)/i;

export type ProductAnalyticsProperties = Record<string, string | number | boolean>;

function safeValue(value: unknown): string | number | boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, 80);
  return null;
}

export function sanitizeProductAnalyticsProperties(input: unknown): ProductAnalyticsProperties {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: ProductAnalyticsProperties = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!PROPERTY_ALLOWLIST.has(key) || FORBIDDEN_KEY.test(key)) continue;
    const sanitized = safeValue(value);
    if (sanitized !== null) output[key] = sanitized;
  }
  return output;
}

export function sanitizeProductAnalyticsEvent(
  event: string,
  properties?: Record<string, unknown>,
): { event: ProductAnalyticsEvent; properties: ProductAnalyticsProperties } | null {
  if (!EVENT_SET.has(event)) return null;
  return {
    event: event as ProductAnalyticsEvent,
    properties: sanitizeProductAnalyticsProperties(properties),
  };
}

export function safeAnalyticsException(
  error: unknown,
  context: Record<string, unknown> = {},
): { error: Error; properties: ProductAnalyticsProperties } {
  const type = error instanceof Error ? error.name : "UnknownError";
  return {
    error: new Error("application_error"),
    properties: sanitizeProductAnalyticsProperties({
      ...context,
      error_code: type.slice(0, 80),
    }),
  };
}
