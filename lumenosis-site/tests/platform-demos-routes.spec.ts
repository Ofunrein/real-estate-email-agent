import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * Live route checks against the built server. The test server runs without
 * LUMENOSIS_PLATFORM_API_SECRET, so the platform API must fail closed with 503
 * and must never fall back to the shared-password cookie.
 */

const PLATFORM_PATHS = [
  "/api/platform/demos",
  "/api/platform/demos/room-1234/approve",
  "/api/platform/demos/room-1234/send",
];

test("platform routes never accept an unsigned request", async ({ request }) => {
  const list = await request.get("/api/platform/demos");
  expect([401, 503]).toContain(list.status());
  expect(list.headers()["cache-control"]).toContain("no-store");

  for (const path of PLATFORM_PATHS.slice(1)) {
    const response = await request.post(path, { data: {} });
    expect([401, 503]).toContain(response.status());
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(JSON.stringify(body)).not.toMatch(/signature|nonce|secret|token/i);
  }
});

test("a bogus signature is not accepted and leaks no detail", async ({ request }) => {
  const bodyDigest = createHmac("sha256", "lumenosis-platform-v1").update("{}").digest("hex");
  const response = await request.post("/api/platform/demos/room-1234/approve", {
    data: {},
    headers: {
      "content-type": "application/json",
      "x-lumenosis-timestamp": String(Date.now()),
      "x-lumenosis-nonce": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "x-lumenosis-signature": bodyDigest,
    },
  });
  expect([401, 503]).toContain(response.status());
});

test("platform auth does not accept the shared-password admin cookie", async ({ request }) => {
  const login = await request.post("/api/admin/login", {
    form: { password: "7458" },
    maxRedirects: 0,
  });
  expect([303, 302]).toContain(login.status());
  const response = await request.get("/api/platform/demos");
  expect([401, 503]).toContain(response.status());
});

test("the existing shared-password admin surface is unchanged", async ({ request }) => {
  const login = await request.get("/admin/demos/login");
  expect(login.status()).toBe(200);

  const approve = await request.post("/api/admin/demos/room-1234/approve", {
    maxRedirects: 0,
  });
  expect([303, 401, 404, 500, 503]).toContain(approve.status());

  const demo = await request.get(`/demo/${"a".repeat(43)}`, { maxRedirects: 0 });
  // /demo/[token] must still be served directly with no redirect hop added.
  expect(demo.status()).not.toBe(301);
  expect(demo.status()).not.toBe(302);
  expect(demo.status()).not.toBe(307);
  expect(demo.status()).not.toBe(308);
});
