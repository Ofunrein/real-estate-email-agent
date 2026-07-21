import { NextResponse } from "next/server";

import { auth, isAllowedAuthEmail, localAuthBypassEnabled } from "@/auth";
import { workspaceForConfiguredEmail } from "@/lib/workspace";
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

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}
