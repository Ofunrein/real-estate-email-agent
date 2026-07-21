import { test } from "node:test";
import assert from "node:assert/strict";

import { workspaceForEmail } from "@/lib/workspace";

test("workspace map isolates Realty ATX from Austin Realty", () => {
  const map = {
    "ofunrein123@gmail.com": { id: "austin-realty", name: "Austin Realty" },
    "ofunrein1234@gmail.com": { id: "realty-atx", name: "Realty ATX" },
  };
  assert.deepEqual(workspaceForEmail("ofunrein1234@gmail.com", map), { id: "realty-atx", name: "Realty ATX" });
  assert.equal(workspaceForEmail("unknown@example.com", map), null);
});
