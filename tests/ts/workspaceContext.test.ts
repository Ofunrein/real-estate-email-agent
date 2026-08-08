import assert from "node:assert/strict";
import test from "node:test";

import { requestWorkspaceId, runInRequestWorkspace } from "../../lib/workspaceContext";

test("workspace context survives awaited work inside its tenant scope", async () => {
  const seen = await runInRequestWorkspace("ryse-realty", async () => {
    await Promise.resolve();
    return requestWorkspaceId();
  });
  assert.equal(seen, "ryse-realty");
});

test("workspace context is restored after tenant-scoped work", async () => {
  await runInRequestWorkspace("ryse-realty", async () => undefined);
  assert.equal(requestWorkspaceId(), undefined);
});
