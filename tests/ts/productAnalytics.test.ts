import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeProductAnalyticsEvent,
  safeAnalyticsException,
} from "@/lib/productAnalytics";

test("product analytics emits only named events and allowlisted properties", () => {
  assert.deepEqual(
    sanitizeProductAnalyticsEvent("command_center_viewed", {
      tenant_id: "acme",
      viewer_role: "tenant_user",
      window: "7d",
      has_data: true,
      arbitrary: "drop me",
    }),
    {
      event: "command_center_viewed",
      properties: {
        tenant_id: "acme",
        viewer_role: "tenant_user",
        window: "7d",
        has_data: true,
      },
    },
  );
  assert.equal(sanitizeProductAnalyticsEvent("lead_message_read", { tenant_id: "acme" }), null);
});

test("product analytics drops PII, content, prompts, auth, and regulated material", () => {
  const event = sanitizeProductAnalyticsEvent("dashboard_load_failed", {
    tenant_id: "acme",
    component: "command-center",
    error_code: "load_failed",
    message_body: "Customer wants a house",
    email: "lead@example.com",
    phone: "+15125550100",
    prompt: "raw system prompt",
    completion: "raw model response",
    transcript: "call transcript",
    authorization: "Bearer secret",
    fair_housing_content: "sensitive",
    lending_content: "sensitive",
    legal_content: "sensitive",
  });

  assert.deepEqual(event?.properties, {
    tenant_id: "acme",
    component: "command-center",
    error_code: "load_failed",
  });
  assert.doesNotMatch(JSON.stringify(event), /Customer|lead@example|1512555|system prompt|model response|Bearer|sensitive/);
});

test("product analytics bounds property values and exception details", () => {
  const event = sanitizeProductAnalyticsEvent("command_center_trace_opened", {
    tenant_id: "x".repeat(500),
    attempt_count_bucket: "11-50",
  });
  assert.equal(String(event?.properties.tenant_id).length, 80);

  const safe = safeAnalyticsException(
    new Error("Lead jane@example.com said my mortgage application was denied"),
    { component: "command-center", runtime: "client" },
  );
  assert.equal(safe.error.message, "application_error");
  assert.deepEqual(safe.properties, {
    component: "command-center",
    runtime: "client",
    error_code: "Error",
  });
});
