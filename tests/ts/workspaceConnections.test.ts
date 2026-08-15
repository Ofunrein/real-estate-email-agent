import { test } from "node:test";
import assert from "node:assert/strict";

import { mayUseSharedEnvironmentConnections } from "@/lib/workspace";

test("shared provider credentials require an explicit tenant allowlist", () => {
  assert.equal(mayUseSharedEnvironmentConnections("default", "default"), true);
  assert.equal(mayUseSharedEnvironmentConnections("realty-atx", "default"), false);
});
