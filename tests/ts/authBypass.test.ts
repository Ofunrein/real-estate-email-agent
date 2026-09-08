import { test } from "node:test";
import assert from "node:assert/strict";

import { localAuthBypassEnabled } from "@/auth";

type EnvPatch = Record<string, string | undefined>;

function withEnv<T>(patch: EnvPatch, fn: () => T): T {
  const previous: EnvPatch = {};
  for (const key of Object.keys(patch)) previous[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("local bypass works in development when explicitly enabled", () => {
  const enabled = withEnv(
    { NODE_ENV: "development", VERCEL_ENV: undefined, ALLOW_LOCAL_AUTH_BYPASS: "1", ALLOW_PREVIEW_AUTH_BYPASS: undefined },
    localAuthBypassEnabled,
  );
  assert.equal(enabled, true);
});

test("bypass stays off in development unless the flag is set", () => {
  const enabled = withEnv(
    { NODE_ENV: "development", VERCEL_ENV: undefined, ALLOW_LOCAL_AUTH_BYPASS: undefined, ALLOW_PREVIEW_AUTH_BYPASS: undefined },
    localAuthBypassEnabled,
  );
  assert.equal(enabled, false);
});

test("preview bypass works on a Vercel preview deploy", () => {
  // NODE_ENV is "production" on preview builds, so the preview branch must key
  // off VERCEL_ENV rather than NODE_ENV.
  const enabled = withEnv(
    { NODE_ENV: "production", VERCEL_ENV: "preview", ALLOW_PREVIEW_AUTH_BYPASS: "1", ALLOW_LOCAL_AUTH_BYPASS: undefined },
    localAuthBypassEnabled,
  );
  assert.equal(enabled, true);
});

test("a production deploy never honours a bypass flag left set by mistake", () => {
  for (const patch of [
    { ALLOW_PREVIEW_AUTH_BYPASS: "1", ALLOW_LOCAL_AUTH_BYPASS: undefined },
    { ALLOW_PREVIEW_AUTH_BYPASS: undefined, ALLOW_LOCAL_AUTH_BYPASS: "1" },
    { ALLOW_PREVIEW_AUTH_BYPASS: "1", ALLOW_LOCAL_AUTH_BYPASS: "1" },
  ]) {
    const enabled = withEnv({ NODE_ENV: "production", VERCEL_ENV: "production", ...patch }, localAuthBypassEnabled);
    assert.equal(enabled, false, `production must refuse bypass for ${JSON.stringify(patch)}`);
  }
});

test("a production deploy refuses bypass even if NODE_ENV is misconfigured", () => {
  const enabled = withEnv(
    { NODE_ENV: "development", VERCEL_ENV: "production", ALLOW_LOCAL_AUTH_BYPASS: "1", ALLOW_PREVIEW_AUTH_BYPASS: "1" },
    localAuthBypassEnabled,
  );
  assert.equal(enabled, false);
});
