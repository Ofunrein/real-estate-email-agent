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
    const workspaces = configuredWorkspaces();
    const firstEmail = Object.keys(workspaces)[0];
    viewer = viewerForEmail(firstEmail, workspaces);
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
