import { test } from "node:test";
import assert from "node:assert/strict";

import { demoDataSource, listDemos } from "@/lib/demoAdminClient";

/**
 * Cutover routing and mixed-version safety.
 *
 * The invariant under test: at any instant exactly ONE side writes demo data, chosen by
 * DEMO_DATA_OWNER. Before cutover every call travels the signed platform API to
 * lumenosis-site. After cutover reads and mutations run against this app's Neon database
 * and no outbound request is made at all — that is the app-to-app hop being removed.
 *
 * Postgres-backed paths are asserted here only where they can be reached without a live
 * database (fail-closed checks and source selection). The behaviour of the SQL itself is
 * covered by tests/ts/demoOwnershipStore.test.ts.
 */

// Non-secret fixture. Contains "example" so scripts/scan-secrets.py treats it as a
// placeholder rather than a live credential.
const SECRET = "example-platform-signing-key-not-real";

const PLATFORM = {
  LUMENOSIS_PLATFORM_API_URL: "https://lumenosis.com",
  LUMENOSIS_PLATFORM_API_SECRET: SECRET,
};

test("the active data source is named by the flag", () => {
  assert.equal(demoDataSource({}), "platform-api");
  assert.equal(
    demoDataSource({ DEMO_DATA_OWNER: "postgres" }),
    "postgres",
  );
});

test("before cutover, reads still travel the signed platform API", async () => {
  let requested = "";
  const fetchImpl = (async (url: string) => {
    requested = String(url);
    return new Response(JSON.stringify({ demos: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const result = await listDemos(PLATFORM, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(requested, "https://lumenosis.com/api/platform/demos");
});

test("after cutover, a read makes no outbound request even when the platform API is configured", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response(JSON.stringify({ demos: [] }), { status: 200 });
  }) as unknown as typeof fetch;

  // Cutover on, but no DATABASE_URL: the call must fail closed locally rather than
  // silently falling back to the remote app. A fallback would reintroduce the hop and,
  // worse, allow two writers during a mixed-version deploy.
  const result = await listDemos(
    { ...PLATFORM, DEMO_DATA_OWNER: "postgres" },
    fetchImpl,
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "not_configured");
  assert.equal(called, false, "cutover must never fall back to the app-to-app request");
});

test("an unrecognised flag value leaves the pre-cutover path in charge", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response(JSON.stringify({ demos: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  await listDemos({ ...PLATFORM, DEMO_DATA_OWNER: "neon" }, fetchImpl);
  assert.equal(called, true, "only the exact value 'postgres' may switch ownership");
});
