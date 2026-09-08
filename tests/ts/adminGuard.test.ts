import { test } from "node:test";
import assert from "node:assert/strict";

import { adminAccessFor } from "@/lib/adminGuard";
import { bypassViewer } from "@/lib/authGuard";
import { parseWorkspaceMap, type WorkspaceViewer } from "@/lib/workspace";

const ADMIN: WorkspaceViewer = { workspaceId: "operator", workspaceName: "Lumenosis", role: "platform_admin" };
const TENANT: WorkspaceViewer = { workspaceId: "acme", workspaceName: "Acme Realty", role: "tenant_user" };

test("anonymous visitors are sent to login, never shown /admin", () => {
  assert.equal(adminAccessFor(null), "deny-anonymous");
});

test("signed-in tenants are redirected to their own dashboard root", () => {
  assert.equal(adminAccessFor(TENANT), "deny-tenant");
});

test("platform admins are allowed", () => {
  assert.equal(adminAccessFor(ADMIN), "allow");
});

test("only the platform_admin role is allowed, never a lookalike value", () => {
  for (const role of ["", "admin", "Platform_Admin", "platform-admin", "superuser"]) {
    const viewer = { ...TENANT, role: role as WorkspaceViewer["role"] };
    assert.equal(adminAccessFor(viewer), "deny-tenant", `role ${role || "(empty)"} must not be allowed`);
  }
});

// The bypass resolves the FIRST configured workspace. If that entry is the
// platform_admin one, an unauthenticated visitor to a bypass-enabled deploy would
// otherwise be handed the platform-admin surface.
test("auth bypass never yields platform_admin even when it is the first workspace", () => {
  const map = parseWorkspaceMap(JSON.stringify({
    "admin@example.com": { id: "operator", name: "Lumenosis", role: "platform_admin" },
    "tenant@example.com": { id: "acme", name: "Acme Realty" },
  }));

  const viewer = bypassViewer(map);
  assert.ok(viewer);
  assert.equal(viewer.role, "tenant_user");
  assert.equal(adminAccessFor(viewer), "deny-tenant");
});

test("auth bypass preserves the tenant workspace identity it resolved", () => {
  const map = parseWorkspaceMap(JSON.stringify({
    "tenant@example.com": { id: "acme", name: "Acme Realty" },
  }));

  assert.deepEqual(bypassViewer(map), {
    workspaceId: "acme",
    workspaceName: "Acme Realty",
    role: "tenant_user",
  });
});

test("auth bypass yields no viewer when no workspace is configured", () => {
  assert.equal(bypassViewer({}), null);
});
