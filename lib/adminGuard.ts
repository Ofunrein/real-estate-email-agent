import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { requireCommandCenterViewer } from "@/lib/authGuard";
import type { WorkspaceViewer } from "@/lib/workspace";

/**
 * Access decision for the `/admin` platform-administration surface.
 *
 * `deny-anonymous` sends the visitor to the login screen. `deny-tenant` sends a
 * signed-in tenant to their own dashboard root. Neither returns 404: a
 * distinguishable "not found" would let an unauthorised visitor probe whether the
 * platform-admin surface exists at all, and neither returns 403 in the UI, because
 * an authenticated tenant hitting `/admin` is far more likely to have followed a
 * stale link than to be attacking us.
 */
export type AdminAccess = "allow" | "deny-anonymous" | "deny-tenant";

export function adminAccessFor(viewer: WorkspaceViewer | null): AdminAccess {
  if (!viewer) return "deny-anonymous";
  return viewer.role === "platform_admin" ? "allow" : "deny-tenant";
}

/**
 * Server-component guard. Returns the viewer only for a `platform_admin`;
 * otherwise redirects and never returns.
 */
export async function requirePlatformAdmin(): Promise<WorkspaceViewer> {
  const viewer = await requireCommandCenterViewer();
  const access = adminAccessFor(viewer);
  if (access === "deny-anonymous") redirect("/login");
  if (access === "deny-tenant") redirect("/");
  return viewer as WorkspaceViewer;
}

/**
 * Route-handler guard. Mirrors `requirePlatformAdmin` for JSON endpoints, where a
 * redirect would be useless to the caller. The body carries no role detail.
 */
export async function requirePlatformAdminApi(): Promise<
  { ok: true; viewer: WorkspaceViewer } | { ok: false; response: NextResponse }
> {
  const viewer = await requireCommandCenterViewer();
  const access = adminAccessFor(viewer);
  if (access === "allow") return { ok: true, viewer: viewer as WorkspaceViewer };
  return {
    ok: false,
    response: NextResponse.json(
      { error: access === "deny-anonymous" ? "Authentication required" : "Not authorized" },
      { status: access === "deny-anonymous" ? 401 : 403, headers: { "Cache-Control": "private, no-store" } },
    ),
  };
}
