import { test } from "node:test";
import assert from "node:assert/strict";

import { blockLoadTestMutation, isLoadTestRequest, providerDryRunEnabled } from "@/lib/loadTestGuard";

test("load-test guard identifies marked requests", () => {
  assert.equal(isLoadTestRequest({ method: "GET", headers: new Headers({ "x-iris-load-test": "1" }) }), true);
  assert.equal(isLoadTestRequest({ method: "GET", headers: new Headers() }), false);
});

test("load-test guard blocks marked mutations only", () => {
  const post = blockLoadTestMutation({ method: "POST", headers: new Headers({ "x-load-test": "1" }) });
  assert.equal(post?.status, 423);

  const get = blockLoadTestMutation({ method: "GET", headers: new Headers({ "x-load-test": "1" }) });
  assert.equal(get, null);
});

test("provider dry-run env parser accepts true-ish values", () => {
  const previous = process.env.IRIS_PROVIDER_DRY_RUN;
  process.env.IRIS_PROVIDER_DRY_RUN = "yes";
  assert.equal(providerDryRunEnabled(), true);
  process.env.IRIS_PROVIDER_DRY_RUN = "0";
  assert.equal(providerDryRunEnabled(), false);
  if (previous === undefined) delete process.env.IRIS_PROVIDER_DRY_RUN;
  else process.env.IRIS_PROVIDER_DRY_RUN = previous;
});
