import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyVisitorPage,
  sanitizeVisitorProperties,
  shouldCountVisitor,
} from "@/lib/visitorAnalytics";

test("classifies main demo and tenant demo paths without exposing identities", () => {
  assert.deepEqual(classifyVisitorPage("/demo/iris"), {
    page_kind: "main_demo",
    demo_slug: "iris",
  });
  assert.deepEqual(classifyVisitorPage("/d/acme/iris"), {
    page_kind: "client_demo",
    demo_slug: "iris",
    tenant_id: "acme",
  });
  assert.equal(classifyVisitorPage("/dashboard"), null);
});

test("visitor properties keep attribution but drop PII and content", () => {
  assert.deepEqual(sanitizeVisitorProperties({
    page_kind: "client_demo",
    demo_slug: "iris",
    tenant_id: "acme",
    referrer_host: "google.com",
    utm_source: "linkedin",
    device_class: "mobile",
    is_internal: false,
    is_test: false,
    email: "lead@example.com",
    message_body: "private",
    full_url: "https://example.com/?email=lead@example.com",
  }), {
    page_kind: "client_demo",
    demo_slug: "iris",
    tenant_id: "acme",
    referrer_host: "google.com",
    utm_source: "linkedin",
    device_class: "mobile",
    is_internal: false,
    is_test: false,
  });
});

test("internal, bot, and test traffic stays queryable but is excluded by default", () => {
  assert.equal(shouldCountVisitor({ is_internal: false, is_test: false, is_bot: false }), true);
  assert.equal(shouldCountVisitor({ is_internal: true, is_test: false, is_bot: false }), false);
  assert.equal(shouldCountVisitor({ is_internal: false, is_test: true, is_bot: false }), false);
  assert.equal(shouldCountVisitor({ is_internal: false, is_test: false, is_bot: true }), false);
});
