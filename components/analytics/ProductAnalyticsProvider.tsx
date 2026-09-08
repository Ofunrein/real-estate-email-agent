"use client";

import React from "react";
import posthog, { type CaptureResult } from "posthog-js";

import {
  safeAnalyticsException,
  sanitizeProductAnalyticsEvent,
  sanitizeProductAnalyticsProperties,
  type ProductAnalyticsEvent,
} from "@/lib/productAnalytics";
import { classifyVisitorPage, sanitizeVisitorProperties, shouldCountVisitor } from "@/lib/visitorAnalytics";

let initialized = false;
const INTERNAL_TRAFFIC_KEY = "lumenosis_internal_traffic";

function replaySampled(distinctId: string): boolean {
  let hash = 0;
  for (let index = 0; index < distinctId.length; index += 1) {
    hash = ((hash << 5) - hash + distinctId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 100 < 5;
}

function beforeSend(event: CaptureResult | null): CaptureResult | null {
  if (!event?.event) return null;
  const sanitized = sanitizeProductAnalyticsEvent(event.event, event.properties || {});
  if (!sanitized) return null;
  if (event.event === "$exception") {
    const exceptionProperties = Object.fromEntries(
      Object.entries(event.properties || {}).filter(([key]) => key.startsWith("$exception_")),
    );
    return {
      ...event,
      properties: {
        ...exceptionProperties,
        ...sanitizeProductAnalyticsProperties(event.properties),
      },
    };
  }
  return { ...event, properties: sanitized.properties };
}

function initializePostHog() {
  if (initialized) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host) return;
  initialized = true;
  posthog.init(key, {
    api_host: host,
    defaults: "2026-05-30",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    custom_personal_data_properties: [
      "email",
      "phone",
      "name",
      "address",
      "token",
      "auth",
      "prompt",
    ],
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockSelector: [
        ".ph-no-capture",
        "[data-ph-no-capture]",
        ".iris-thread-col",
        ".iris-convo-col",
        ".iris-context-col",
        ".iris-composer",
        ".iris-top-search",
        ".iris-search",
      ].join(","),
    },
    before_send: beforeSend,
    loaded: (client) => {
      client.onFeatureFlags(() => {
        const replayEnabled = client.isFeatureEnabled("command-center-session-replay") === true;
        if (replayEnabled && replaySampled(client.get_distinct_id())) {
          client.startSessionRecording();
        } else {
          client.stopSessionRecording();
        }
      });
    },
  });
}

export function ProductAnalyticsProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    initializePostHog();
    const page = classifyVisitorPage(window.location.pathname);
    if (!page) return;
    const params = new URLSearchParams(window.location.search);
    const flags = {
      is_internal: window.localStorage.getItem(INTERNAL_TRAFFIC_KEY) === "1",
      is_test: params.get("test") === "1" || navigator.webdriver,
      is_bot: /bot|crawler|spider|headless/i.test(navigator.userAgent),
    };
    let referrerHost = "";
    try {
      referrerHost = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      referrerHost = "";
    }
    captureProductEvent("demo_page_viewed", sanitizeVisitorProperties({
      ...page,
      referrer_host: referrerHost,
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      device_class: window.matchMedia("(max-width: 600px)").matches ? "mobile" : "desktop",
      ...flags,
      counts_toward_kpi: shouldCountVisitor(flags),
    }));
  }, []);
  return children;
}

export function internalTrafficEnabled(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(INTERNAL_TRAFFIC_KEY) === "1";
}

export function setInternalTrafficEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INTERNAL_TRAFFIC_KEY, enabled ? "1" : "0");
  captureProductEvent("internal_traffic_changed", {
    is_internal: enabled,
    counts_toward_kpi: !enabled,
  });
}

export function captureProductEvent(
  event: ProductAnalyticsEvent,
  properties: Record<string, unknown> = {},
) {
  const sanitized = sanitizeProductAnalyticsEvent(event, properties);
  if (!initialized || !sanitized) return;
  posthog.capture(sanitized.event, sanitized.properties);
}

export function captureProductException(error: unknown, context: Record<string, unknown> = {}) {
  if (!initialized) return;
  const safe = safeAnalyticsException(error, context);
  posthog.captureException(safe.error, safe.properties);
}

export function identifyProductViewer(input: {
  distinctId: string;
  tenantId: string;
  viewerRole: string;
}) {
  if (!initialized || !input.distinctId) return;
  posthog.identify(input.distinctId.slice(0, 120), {
    tenant_id: input.tenantId.slice(0, 80),
    viewer_role: input.viewerRole.slice(0, 40),
  });
  posthog.group("tenant", input.tenantId.slice(0, 80));
}

export function resetProductViewer() {
  if (initialized) posthog.reset();
}
