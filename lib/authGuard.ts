import { NextResponse } from "next/server";

import { auth, isAllowedAuthEmail, localAuthBypassEnabled } from "@/auth";
import {
  configuredWorkspaces,
  viewerForConfiguredEmail,
  viewerForEmail,
  workspaceForConfiguredEmail,
  type WorkspaceViewer,
} from "@/lib/workspace";
import { setRequestWorkspace } from "@/lib/workspaceContext";
import { databaseEnabled, ensureClientInDatabase } from "@/lib/database";

/**
 * Resolve the viewer for a development/preview auth bypass.
 *
 * The bypass picks the first configured workspace, which in a multi-tenant
 * WORKSPACE_EMAIL_MAP can be the `platform_admin` entry. Once `/admin` exists as
 * a real URL, that would hand the platform-admin surface to anyone who can reach
 * a deploy with the bypass flag set. The bypass therefore always downgrades to
 * `tenant_user`: it is a convenience for skipping the login screen, never a way
 * to acquire a role.
 */
export function bypassViewer(
  workspaces = configuredWorkspaces(),
): WorkspaceViewer | null {
  const firstEmail = Object.keys(workspaces)[0];
  const viewer = viewerForEmail(firstEmail, workspaces);
  if (!viewer) return null;
  return { ...viewer, role: "tenant_user" };
}

export async function requireDashboardAuth() {
  if (localAuthBypassEnabled()) {
    const workspace = workspaceForConfiguredEmail("ofunrein123@gmail.com");
    if (workspace) setRequestWorkspace(workspace.id);
    return { user: { email: "local-dev@lumenosis.test" } };
  }

  const session = await auth();
  const email = session?.user?.email;
  const workspace = workspaceForConfiguredEmail(email);

  if (!isAllowedAuthEmail(email) || !workspace) {
    return null;
  }

  setRequestWorkspace(workspace.id);
  if (databaseEnabled()) await ensureClientInDatabase(workspace.id, workspace.name);
  return session;
}

export async function requireCommandCenterViewer(): Promise<WorkspaceViewer | null> {
  let viewer: WorkspaceViewer | null = null;
  if (localAuthBypassEnabled()) {
    viewer = bypassViewer();
  } else {
    const session = await auth();
    const email = session?.user?.email;
    if (!isAllowedAuthEmail(email)) return null;
    viewer = viewerForConfiguredEmail(email);
  }
  if (!viewer) return null;

  setRequestWorkspace(viewer.workspaceId);
  if (databaseEnabled()) await ensureClientInDatabase(viewer.workspaceId, viewer.workspaceName);
  return viewer;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}
