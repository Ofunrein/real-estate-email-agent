import { test } from "node:test";
import assert from "node:assert/strict";

import { mayUseSharedEnvironmentConnections } from "@/lib/workspace";

test("only Austin Realty may use shared provider credentials", () => {
  assert.equal(mayUseSharedEnvironmentConnections("default"), true);
  assert.equal(mayUseSharedEnvironmentConnections("realty-atx"), false);
});
