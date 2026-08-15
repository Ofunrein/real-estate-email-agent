import { test } from "node:test";
import assert from "node:assert/strict";

import { parseWorkspaceMap, workspaceForEmail } from "@/lib/workspace";

test("workspace map isolates Realty ATX from Austin Realty", () => {
  const map = {
    "ofunrein123@gmail.com": { id: "austin-realty", name: "Austin Realty" },
    "ofunrein1234@gmail.com": { id: "realty-atx", name: "Realty ATX" },
  };
  assert.deepEqual(workspaceForEmail("ofunrein1234@gmail.com", map), { id: "realty-atx", name: "Realty ATX" });
  assert.equal(workspaceForEmail("unknown@example.com", map), null);
});

test("workspace config rejects duplicate tenant ids", () => {
  const configured = JSON.stringify({
    "one@example.com": { id: "same-client", name: "One" },
    "two@example.com": { id: "same-client", name: "Two" },
  });
  assert.throws(() => parseWorkspaceMap(configured), /Duplicate workspace id/);
});

test("workspace config rejects invalid client slugs instead of silently dropping them", () => {
  const configured = JSON.stringify({
    "new@example.com": { id: "Not A Slug", name: "New Client" },
  });
  assert.throws(() => parseWorkspaceMap(configured), /Invalid workspace configuration/);
});
