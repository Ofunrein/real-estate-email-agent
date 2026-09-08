import { test } from "node:test";
import assert from "node:assert/strict";

import { authorizeCommandCenterScope } from "@/lib/commandCenterAuth";
import { parseWorkspaceMap, viewerForEmail } from "@/lib/workspace";

test("workspace roles default tenant users and preserve explicit platform admins", () => {
  const map = parseWorkspaceMap(JSON.stringify({
    "tenant@example.com": { id: "acme", name: "Acme Realty" },
    "admin@example.com": { id: "operator", name: "Lumenosis", role: "platform_admin" },
  }));

  assert.deepEqual(viewerForEmail("tenant@example.com", map), {
    workspaceId: "acme",
    workspaceName: "Acme Realty",
    role: "tenant_user",
  });
  assert.deepEqual(viewerForEmail("admin@example.com", map), {
    workspaceId: "operator",
    workspaceName: "Lumenosis",
    role: "platform_admin",
  });
});

test("workspace config rejects unknown roles", () => {
  assert.throws(
    () => parseWorkspaceMap(JSON.stringify({
      "admin@example.com": { id: "operator", name: "Lumenosis", role: "superuser" },
    })),
    /Invalid workspace role/,
  );
});

test("tenant users can request only their own command-center scope", () => {
  const viewer = { workspaceId: "acme", workspaceName: "Acme", role: "tenant_user" as const };
  assert.deepEqual(authorizeCommandCenterScope(viewer), { ok: true, tenantId: "acme", allTenants: false });
  assert.deepEqual(authorizeCommandCenterScope(viewer, "acme"), { ok: true, tenantId: "acme", allTenants: false });
  assert.deepEqual(authorizeCommandCenterScope(viewer, "bravo"), {
    ok: false,
    status: 403,
    error: "Tenant access denied",
  });
});

test("platform admins can request all tenants or one tenant", () => {
  const viewer = { workspaceId: "operator", workspaceName: "Lumenosis", role: "platform_admin" as const };
  assert.deepEqual(authorizeCommandCenterScope(viewer), { ok: true, tenantId: null, allTenants: true });
  assert.deepEqual(authorizeCommandCenterScope(viewer, "acme"), { ok: true, tenantId: "acme", allTenants: false });
});
