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

test("concurrent tenant scopes cannot observe each other", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const first = runInRequestWorkspace("first-client", async () => {
    await gate;
    return requestWorkspaceId();
  });
  const second = runInRequestWorkspace("second-client", async () => {
    release();
    await Promise.resolve();
    return requestWorkspaceId();
  });

  assert.deepEqual(await Promise.all([first, second]), ["first-client", "second-client"]);
  assert.equal(requestWorkspaceId(), undefined);
});
