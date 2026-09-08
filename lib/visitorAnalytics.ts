export type VisitorTrafficFlags = {
  is_internal: boolean;
  is_test: boolean;
  is_bot: boolean;
};

export type VisitorPage = {
  page_kind: "main_demo" | "client_demo";
  demo_slug: string;
  tenant_id?: string;
};

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROPERTY_ALLOWLIST = new Set([
  "page_kind",
  "demo_slug",
  "tenant_id",
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
const FORBIDDEN_KEY = /(email|phone|name|address|message|body|content|prompt|completion|transcript|token|secret|auth|cookie|url|query)/i;

function safeId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return SAFE_ID.test(normalized) ? normalized.slice(0, 80) : "";
}

export function classifyVisitorPage(pathname: string): VisitorPage | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "demo" && parts.length === 2) {
    const demoSlug = safeId(parts[1]);
    return demoSlug ? { page_kind: "main_demo", demo_slug: demoSlug } : null;
  }
  if (parts[0] === "d" && parts.length === 3) {
    const tenantId = safeId(parts[1]);
    const demoSlug = safeId(parts[2]);
    return tenantId && demoSlug
      ? { page_kind: "client_demo", demo_slug: demoSlug, tenant_id: tenantId }
      : null;
  }
  return null;
}

export function sanitizeVisitorProperties(input: unknown): Record<string, string | boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!PROPERTY_ALLOWLIST.has(key) || FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === "boolean") output[key] = value;
    if (typeof value === "string") output[key] = value.slice(0, 80);
  }
  return output;
}

export function shouldCountVisitor(flags: VisitorTrafficFlags): boolean {
  return !flags.is_internal && !flags.is_test && !flags.is_bot;
}
