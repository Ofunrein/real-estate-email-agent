import type { WorkspaceViewer } from "@/lib/workspace";

export type CommandCenterScope =
  | { ok: true; tenantId: string | null; allTenants: boolean }
  | { ok: false; status: 403; error: "Tenant access denied" };

export function authorizeCommandCenterScope(
  viewer: WorkspaceViewer,
  requestedTenantId?: string | null,
): CommandCenterScope {
  const requested = String(requestedTenantId || "").trim();
  if (viewer.role === "platform_admin") {
    return {
      ok: true,
      tenantId: requested || null,
      allTenants: !requested,
    };
  }
  if (requested && requested !== viewer.workspaceId) {
    return { ok: false, status: 403, error: "Tenant access denied" };
  }
  return { ok: true, tenantId: viewer.workspaceId, allTenants: false };
}
