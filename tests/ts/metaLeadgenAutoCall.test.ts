import { test } from "node:test";
import assert from "node:assert/strict";

import { autoCallEnabled } from "@/lib/metaLeadgenFlags";

test("autoCallEnabled: dark-launched, defaults to false with no env var set", () => {
  const original = process.env.META_LEADGEN_AUTOCALL;
  delete process.env.META_LEADGEN_AUTOCALL;
  try {
    assert.equal(autoCallEnabled(), false);
  } finally {
    if (original === undefined) delete process.env.META_LEADGEN_AUTOCALL;
    else process.env.META_LEADGEN_AUTOCALL = original;
  }
});

test("autoCallEnabled: only true for the exact string 'true', not any truthy value", () => {
  const original = process.env.META_LEADGEN_AUTOCALL;
  try {
    for (const value of ["1", "yes", "TRUE", "on", ""]) {
      process.env.META_LEADGEN_AUTOCALL = value;
      assert.equal(autoCallEnabled(), false, `expected "${value}" to stay disabled`);
    }
    process.env.META_LEADGEN_AUTOCALL = "true";
    assert.equal(autoCallEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.META_LEADGEN_AUTOCALL;
    else process.env.META_LEADGEN_AUTOCALL = original;
  }
});
