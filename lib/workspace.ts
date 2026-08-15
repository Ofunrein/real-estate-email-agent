export type Workspace = { id: string; name: string };

type WorkspaceMap = Record<string, Workspace>;

const WORKSPACE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function clean(value: unknown): string {
  return String(value || "").trim();
}

export function workspaceForEmail(email: string | null | undefined, map: WorkspaceMap): Workspace | null {
  const key = clean(email).toLowerCase();
  const workspace = map[key];
  if (!workspace?.id || !workspace.name) return null;
  return { id: workspace.id, name: workspace.name };
}

export function parseWorkspaceMap(configured: string): WorkspaceMap {
  try {
    const parsed = JSON.parse(configured) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("WORKSPACE_EMAIL_MAP must be a JSON object");
    }

    const result: WorkspaceMap = {};
    const workspaceIds = new Set<string>();
    for (const [rawEmail, rawWorkspace] of Object.entries(parsed)) {
      const email = clean(rawEmail).toLowerCase();
      const workspace = workspaceForEmail(email, { [email]: rawWorkspace as Workspace });
      if (!email.includes("@") || !workspace || !WORKSPACE_ID.test(workspace.id)) {
        throw new Error(`Invalid workspace configuration for ${email || "unknown email"}`);
      }
      if (result[email]) throw new Error(`Duplicate workspace email: ${email}`);
      if (workspaceIds.has(workspace.id)) throw new Error(`Duplicate workspace id: ${workspace.id}`);
      result[email] = workspace;
      workspaceIds.add(workspace.id);
    }
    if (Object.keys(result).length === 0) throw new Error("WORKSPACE_EMAIL_MAP cannot be empty");
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("WORKSPACE_EMAIL_MAP must be valid JSON");
    throw error;
  }
}

export function configuredWorkspaces(): WorkspaceMap {
  const configured = clean(process.env.WORKSPACE_EMAIL_MAP);
  if (configured) return parseWorkspaceMap(configured);
  return {
    "ofunrein123@gmail.com": {
      id: process.env.CLIENT_ID || "default",
      name: process.env.CLIENT_NAME || "Lumenosis",
    },
  };
}

export function workspaceForConfiguredEmail(email: string | null | undefined): Workspace | null {
  return workspaceForEmail(email, configuredWorkspaces());
}

export function mayUseSharedEnvironmentConnections(
  workspaceId: string | undefined,
  configuredAllowlist = process.env.SHARED_ENV_WORKSPACE_IDS,
): boolean {
  const allowed = clean(configuredAllowlist)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (allowed.length > 0) return Boolean(workspaceId && allowed.includes(workspaceId));

  const workspaces = Object.values(configuredWorkspaces());
  return workspaces.length === 1 && (!workspaceId || workspaceId === workspaces[0]?.id);
}

export function configuredWorkspaceEmails(): string[] {
  return Object.keys(configuredWorkspaces());
}
