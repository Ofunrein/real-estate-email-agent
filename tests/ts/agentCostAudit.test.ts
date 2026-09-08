import { test } from "node:test";
import assert from "node:assert/strict";

import { metricStatusIsFailure } from "@/lib/agentCostAudit";

// D2 regression guard. See docs/audits/2026-09-model-routing/07-gauntlet-round1-partial.md.
// TheoMetric.status is an open string, not a boolean. Before this fix the ledger
// recorded every successful "no rows matched" lookup as `failed`, permanently
// distorting successRate/errorRate in the append-only usage_cost_ledger.

test("only the explicit failure vocabulary counts as a failure", () => {
  for (const status of ["failed", "error", "timeout", "rejected"]) {
    assert.equal(metricStatusIsFailure(status), true, `${status} must be a failure`);
  }
});

test("successful non-ok outcomes are not failures", () => {
  // lib/theoData.ts:123 emits found/no_data; lib/publicPropertyData.ts does the same.
  for (const status of ["ok", "found", "no_data", "skipped", "cached"]) {
    assert.equal(metricStatusIsFailure(status), false, `${status} must not be a failure`);
  }
});

test("status classification is case- and whitespace-insensitive", () => {
  assert.equal(metricStatusIsFailure(" FAILED "), true);
  assert.equal(metricStatusIsFailure("Timeout"), true);
  assert.equal(metricStatusIsFailure("  No_Data  "), false);
});

test("absent status is not reported as a failure", () => {
  // An unset status is unknown, not evidence of an error; inventing failures is
  // exactly the dishonesty D2 describes.
  assert.equal(metricStatusIsFailure(""), false);
  assert.equal(metricStatusIsFailure(null), false);
  assert.equal(metricStatusIsFailure(undefined), false);
});
