import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  approveDemo,
  listDemos,
  platformApiConfig,
  platformApiConfigured,
  sendDemoOutreach,
  signedHeaders,
} from "@/lib/demoAdminClient";

const SCHEME = "lumenosis-platform-v1";
// Non-secret fixture value. Contains "example" so scripts/scan-secrets.py
// recognizes it as a placeholder rather than a real credential.
const SECRET = "example-platform-signing-key-not-real";

const CONFIGURED = {
  LUMENOSIS_PLATFORM_API_URL: "https://lumenosis.com",
  LUMENOSIS_PLATFORM_API_SECRET: SECRET,
} as unknown as NodeJS.ProcessEnv;

/**
 * Independent re-implementation of the site's verifier (lib/platform-auth.ts in
 * lumenosis-site). Deliberately NOT imported: this is the cross-repo contract, so
 * the test must fail if either side changes the signing rules unilaterally.
 */
function verify(input: {
  secret: string;
  method: string;
  path: string;
  body: string;
  headers: Record<string, string>;
  now?: number;
}) {
  const timestamp = input.headers["x-lumenosis-timestamp"];
  const nonce = input.headers["x-lumenosis-nonce"];
  const signature = input.headers["x-lumenosis-signature"];
  if (!timestamp || !nonce || !signature) return false;
  if (Math.abs((input.now ?? Date.now()) - Number(timestamp)) > 5 * 60_000) return false;

  const bodyDigest = createHmac("sha256", SCHEME).update(input.body).digest("hex");
  const payload = [SCHEME, input.method.toUpperCase(), input.path, timestamp, nonce, bodyDigest].join("\n");
  const expected = createHmac("sha256", input.secret).update(payload).digest("hex");
  return signature === expected;
}

test("signed headers verify against an independent implementation of the site verifier", () => {
  const headers = signedHeaders({ secret: SECRET, method: "POST", path: "/api/platform/demos/abc/send", body: "{}" });
  assert.equal(verify({ secret: SECRET, method: "POST", path: "/api/platform/demos/abc/send", body: "{}", headers }), true);
});

test("a signature from a different secret is rejected", () => {
  const headers = signedHeaders({ secret: "example-other-signing-key-not-real", method: "GET", path: "/api/platform/demos", body: "" });
  assert.equal(verify({ secret: SECRET, method: "GET", path: "/api/platform/demos", body: "", headers }), false);
});

test("the signature is bound to the path, so it cannot be replayed on another endpoint", () => {
  const headers = signedHeaders({ secret: SECRET, method: "POST", path: "/api/platform/demos/abc/approve", body: "{}" });
  // Same signature presented against the send endpoint must not verify.
  assert.equal(verify({ secret: SECRET, method: "POST", path: "/api/platform/demos/abc/send", body: "{}", headers }), false);
});

test("the signature is bound to the method", () => {
  const headers = signedHeaders({ secret: SECRET, method: "GET", path: "/api/platform/demos", body: "" });
  assert.equal(verify({ secret: SECRET, method: "POST", path: "/api/platform/demos", body: "", headers }), false);
});

test("the signature is bound to the exact body bytes", () => {
  const headers = signedHeaders({ secret: SECRET, method: "POST", path: "/api/platform/demos/abc/send", body: "{}" });
  assert.equal(
    verify({ secret: SECRET, method: "POST", path: "/api/platform/demos/abc/send", body: '{"force":true}', headers }),
    false,
  );
});

test("a stale timestamp fails the skew window", () => {
  const stale = String(Date.now() - 10 * 60_000);
  const headers = signedHeaders({ secret: SECRET, method: "GET", path: "/api/platform/demos", body: "", timestamp: stale });
  assert.equal(verify({ secret: SECRET, method: "GET", path: "/api/platform/demos", body: "", headers }), false);
});

test("each request carries a fresh nonce so the server can detect replay", () => {
  const a = signedHeaders({ secret: SECRET, method: "GET", path: "/api/platform/demos", body: "" });
  const b = signedHeaders({ secret: SECRET, method: "GET", path: "/api/platform/demos", body: "" });
  assert.notEqual(a["x-lumenosis-nonce"], b["x-lumenosis-nonce"]);
});

test("the secret never appears in the outgoing headers", () => {
  const headers = signedHeaders({ secret: SECRET, method: "GET", path: "/api/platform/demos", body: "" });
  assert.equal(JSON.stringify(headers).includes(SECRET), false);
});

test("config requires both halves and is otherwise unconfigured", () => {
  assert.equal(platformApiConfigured({} as NodeJS.ProcessEnv), false);
  assert.equal(platformApiConfigured({ LUMENOSIS_PLATFORM_API_URL: "https://lumenosis.com" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(platformApiConfigured({ LUMENOSIS_PLATFORM_API_SECRET: SECRET } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(platformApiConfigured(CONFIGURED), true);
  assert.equal(platformApiConfig(CONFIGURED)?.baseUrl, "https://lumenosis.com");
});

test("a trailing slash on the base URL does not produce a double slash", () => {
  const config = platformApiConfig({
    LUMENOSIS_PLATFORM_API_URL: "https://lumenosis.com/",
    LUMENOSIS_PLATFORM_API_SECRET: SECRET,
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(config?.baseUrl, "https://lumenosis.com");
});

test("every call reports not_configured without performing a request when env is missing", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;

  for (const result of [
    await listDemos({} as NodeJS.ProcessEnv, fetchImpl),
    await approveDemo("abc", {} as NodeJS.ProcessEnv, fetchImpl),
    await sendDemoOutreach("abc", {} as NodeJS.ProcessEnv, fetchImpl),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "not_configured");
  }
  assert.equal(called, false, "must not contact the network when unconfigured");
});

test("listDemos returns parsed demos and signs the request it sends", async () => {
  let seen: { url: string; headers: Record<string, string> } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), headers: init.headers as Record<string, string> };
    return new Response(JSON.stringify({ demos: [{ id: "d1", fullName: "Dana Reed", demoUrl: "https://lumenosis.com/demo/tok" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const result = await listDemos(CONFIGURED, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.data.demos[0].id, "d1");
  assert.equal(seen!.url, "https://lumenosis.com/api/platform/demos");
  assert.equal(
    verify({ secret: SECRET, method: "GET", path: "/api/platform/demos", body: "", headers: seen!.headers }),
    true,
  );
});

test("the client preserves the site's demo URL verbatim and never rebuilds a token", async () => {
  const demoUrl = "https://lumenosis.com/demo/E5rW-existing-token_abc";
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ demos: [{ id: "d1", demoUrl }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  const result = await listDemos(CONFIGURED, fetchImpl);
  assert.equal(result.ok === true && result.data.demos[0].demoUrl, demoUrl);
});

test("id path segments are encoded, so a crafted id cannot escape the endpoint", async () => {
  let path = "";
  const fetchImpl = (async (url: string) => {
    path = new URL(String(url)).pathname;
    return new Response(JSON.stringify({ ok: true, approved: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  await approveDemo("../send", CONFIGURED, fetchImpl);
  assert.equal(path, "/api/platform/demos/..%2Fsend/approve");
});

test("upstream statuses map to distinct, non-leaking client reasons", async () => {
  const cases: Array<[number, string]> = [
    [401, "unauthorized"],
    [403, "unauthorized"],
    [503, "not_configured"],
    [500, "unavailable"],
    [404, "unavailable"],
  ];

  for (const [status, reason] of cases) {
    const fetchImpl = (async () => new Response("{}", { status })) as unknown as typeof fetch;
    const result = await sendDemoOutreach("abc", CONFIGURED, fetchImpl);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, reason, `status ${status}`);
  }
});

test("a network failure is reported as unavailable rather than throwing", async () => {
  const fetchImpl = (async () => {
    throw new Error("ECONNREFUSED 10.0.0.1:443");
  }) as unknown as typeof fetch;

  const result = await listDemos(CONFIGURED, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "unavailable");
  // The detail is operator-facing copy, never the raw error with its address.
  assert.equal(result.ok === false && result.detail?.includes("10.0.0.1"), false);
});

test("malformed JSON is reported as unavailable rather than throwing", async () => {
  const fetchImpl = (async () =>
    new Response("not json", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  const result = await listDemos(CONFIGURED, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "unavailable");
});
