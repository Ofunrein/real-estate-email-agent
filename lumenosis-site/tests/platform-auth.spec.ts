import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  expectedSignature,
  MAX_SKEW_MS,
  PLATFORM_SCHEME,
  platformApiConfigured,
  rememberNonce,
  signingPayload,
  verifyPlatformRequest,
} from "../lib/platform-auth";

const SECRET = ["platform", "api-secret-at-least-32-characters"].join("-");
const env = { LUMENOSIS_PLATFORM_API_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
const NOW = 1_760_000_000_000;

/** Mirror of the primary app's lib/demoAdminClient.ts signedHeaders(). */
function clientHeaders(input: {
  method: string;
  path: string;
  body: string;
  secret?: string;
  timestamp?: string;
  nonce?: string;
}) {
  const timestamp = input.timestamp ?? String(NOW);
  const nonce = input.nonce ?? "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const bodyDigest = createHmac("sha256", PLATFORM_SCHEME).update(input.body).digest("hex");
  const payload = [
    PLATFORM_SCHEME,
    input.method.toUpperCase(),
    input.path,
    timestamp,
    nonce,
    bodyDigest,
  ].join("\n");
  const signature = createHmac("sha256", input.secret ?? SECRET)
    .update(payload)
    .digest("hex");
  return new Headers({
    "content-type": "application/json",
    "x-lumenosis-timestamp": timestamp,
    "x-lumenosis-nonce": nonce,
    "x-lumenosis-signature": signature,
  });
}

function verify(overrides: Partial<Parameters<typeof verifyPlatformRequest>[0]> = {}) {
  const method = overrides.method ?? "GET";
  const path = overrides.path ?? "/api/platform/demos";
  const body = overrides.body ?? "";
  return verifyPlatformRequest({
    method,
    path,
    body,
    headers: overrides.headers ?? clientHeaders({ method, path, body }),
    env: overrides.env ?? env,
    now: overrides.now ?? NOW,
    nonceStore: overrides.nonceStore ?? new Map(),
    allowedMethods: overrides.allowedMethods,
  });
}

test("signing payload matches the primary app client byte for byte", () => {
  const payload = signingPayload({
    method: "post",
    path: "/api/platform/demos/x/approve",
    timestamp: String(NOW),
    nonce: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    body: "{}",
  });
  const digest = createHmac("sha256", PLATFORM_SCHEME).update("{}").digest("hex");
  expect(payload).toBe(
    [
      PLATFORM_SCHEME,
      "POST",
      "/api/platform/demos/x/approve",
      String(NOW),
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      digest,
    ].join("\n"),
  );
  expect(
    expectedSignature(SECRET, {
      method: "POST",
      path: "/api/platform/demos/x/approve",
      timestamp: String(NOW),
      nonce: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      body: "{}",
    }),
  ).toMatch(/^[a-f0-9]{64}$/);
});

test("a correctly signed request is accepted for GET and POST", () => {
  expect(verify()).toEqual({ ok: true });
  expect(verify({ method: "POST", path: "/api/platform/demos/abc/approve", body: "{}" })).toEqual({
    ok: true,
  });
});

test("missing or short secret is not_configured and never authenticates", () => {
  expect(platformApiConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  expect(
    platformApiConfigured({
      LUMENOSIS_PLATFORM_API_SECRET: "short",
    } as unknown as NodeJS.ProcessEnv),
  ).toBe(false);
  expect(verify({ env: {} as NodeJS.ProcessEnv })).toEqual({ ok: false, reason: "not_configured" });
});

test("wrong signature, wrong secret, and tampered body are all rejected", () => {
  expect(
    verify({
      headers: clientHeaders({
        method: "GET",
        path: "/api/platform/demos",
        body: "",
        secret: ["another", "secret-at-least-32-characters-x"].join("-"),
      }),
    }),
  ).toEqual({
    ok: false,
    reason: "bad_signature",
  });
  const headers = clientHeaders({ method: "POST", path: "/api/platform/demos/a/send", body: "{}" });
  expect(
    verify({ method: "POST", path: "/api/platform/demos/a/send", body: '{"x":1}', headers }),
  ).toEqual({ ok: false, reason: "bad_signature" });
  expect(
    verify({ method: "POST", path: "/api/platform/demos/b/send", body: "{}", headers }),
  ).toEqual({ ok: false, reason: "bad_signature" });
});

test("missing headers are rejected without detail", () => {
  expect(verify({ headers: new Headers({ "content-type": "application/json" }) })).toEqual({
    ok: false,
    reason: "missing_headers",
  });
});

test("clock skew is bounded in both directions", () => {
  const path = "/api/platform/demos";
  const stale = String(NOW - MAX_SKEW_MS - 1000);
  expect(
    verify({ headers: clientHeaders({ method: "GET", path, body: "", timestamp: stale }) }),
  ).toEqual({ ok: false, reason: "skew" });
  const future = String(NOW + MAX_SKEW_MS + 1000);
  expect(
    verify({ headers: clientHeaders({ method: "GET", path, body: "", timestamp: future }) }),
  ).toEqual({ ok: false, reason: "skew" });
  const edge = String(NOW - MAX_SKEW_MS + 1);
  expect(
    verify({ headers: clientHeaders({ method: "GET", path, body: "", timestamp: edge }) }),
  ).toEqual({ ok: true });
});

test("non-numeric timestamp and malformed nonce are rejected", () => {
  const bad = clientHeaders({ method: "GET", path: "/api/platform/demos", body: "" });
  bad.set("x-lumenosis-timestamp", "not-a-number");
  expect(verify({ headers: bad })).toEqual({ ok: false, reason: "bad_timestamp" });

  const shortNonce = clientHeaders({
    method: "GET",
    path: "/api/platform/demos",
    body: "",
    nonce: "abc",
  });
  expect(verify({ headers: shortNonce })).toEqual({ ok: false, reason: "bad_nonce" });
});

test("a replayed nonce is rejected within the skew window", () => {
  const store = new Map<string, number>();
  expect(verify({ nonceStore: store })).toEqual({ ok: true });
  expect(verify({ nonceStore: store })).toEqual({ ok: false, reason: "replay" });
});

test("nonce entries expire so the store cannot grow without bound", () => {
  const store = new Map<string, number>();
  expect(rememberNonce("n-0000000000000000", NOW, store)).toBe(true);
  expect(rememberNonce("n-0000000000000000", NOW, store)).toBe(false);
  expect(rememberNonce("n-0000000000000000", NOW + MAX_SKEW_MS + 1, store)).toBe(true);
  expect(store.size).toBe(1);
});

test("methods and content types are allowlisted", () => {
  expect(verify({ method: "DELETE" })).toEqual({ ok: false, reason: "bad_method" });
  expect(verify({ method: "POST", body: "{}", allowedMethods: ["GET"] })).toEqual({
    ok: false,
    reason: "bad_method",
  });
  const form = clientHeaders({ method: "POST", path: "/api/platform/demos", body: "{}" });
  form.set("content-type", "application/x-www-form-urlencoded");
  expect(
    verify({ method: "POST", path: "/api/platform/demos", body: "{}", headers: form }),
  ).toEqual({
    ok: false,
    reason: "bad_content_type",
  });
});
