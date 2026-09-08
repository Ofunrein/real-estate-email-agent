import { PostHog } from "posthog-node";

import {
  safeAnalyticsException,
  sanitizeProductAnalyticsEvent,
  type ProductAnalyticsEvent,
} from "@/lib/productAnalytics";

let client: PostHog | null | undefined;

function getPostHogServer(): PostHog | null {
  if (client !== undefined) return client;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  client = key && host
    ? new PostHog(key, { host, flushAt: 1, flushInterval: 0 })
    : null;
  return client;
}

export async function captureServerEvent(
  distinctId: string,
  event: ProductAnalyticsEvent,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const posthog = getPostHogServer();
  const sanitized = sanitizeProductAnalyticsEvent(event, properties);
  if (!posthog || !sanitized || !distinctId) return;
  try {
    await posthog.captureImmediate({
      distinctId: distinctId.slice(0, 120),
      event: sanitized.event,
      properties: sanitized.properties,
    });
  } catch {
    // Product analytics must never affect application behavior.
  }
}

export async function captureServerException(
  error: unknown,
  context: Record<string, unknown> = {},
  distinctId?: string,
): Promise<void> {
  const posthog = getPostHogServer();
  if (!posthog) return;
  const safe = safeAnalyticsException(error, context);
  try {
    await posthog.captureExceptionImmediate(safe.error, distinctId, safe.properties);
  } catch {
    // Product analytics must never affect application behavior.
  }
}

export async function serverFeatureFlag(
  flag: string,
  distinctId: string,
  tenantId: string,
): Promise<boolean> {
  const posthog = getPostHogServer();
  if (!posthog || !flag || !distinctId) return false;
  try {
    const enabled = Boolean(await posthog.isFeatureEnabled(flag.slice(0, 80), distinctId, {
      groups: { tenant: tenantId.slice(0, 80) },
    }));
    await captureServerEvent(distinctId, "feature_flag_evaluated", {
      tenant_id: tenantId,
      feature_flag: flag,
      flag_variant: enabled ? "enabled" : "disabled",
      runtime: "server",
    });
    return enabled;
  } catch {
    return false;
  }
}
