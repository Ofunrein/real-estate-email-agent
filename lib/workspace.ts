export type Workspace = { id: string; name: string };

type WorkspaceMap = Record<string, Workspace>;

function clean(value: unknown): string {
  return String(value || "").trim();
}

export function workspaceForEmail(email: string | null | undefined, map: WorkspaceMap): Workspace | null {
  const key = clean(email).toLowerCase();
  const workspace = map[key];
  if (!workspace?.id || !workspace.name) return null;
  return { id: workspace.id, name: workspace.name };
}

export function configuredWorkspaces(): WorkspaceMap {
  const configured = clean(process.env.WORKSPACE_EMAIL_MAP);
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as WorkspaceMap;
      return Object.fromEntries(Object.entries(parsed).flatMap(([email, workspace]) => {
        const normalized = workspaceForEmail(email, { [email]: workspace });
        return normalized ? [[email.toLowerCase(), normalized]] : [];
      }));
    } catch {
      throw new Error("WORKSPACE_EMAIL_MAP must be valid JSON");
    }
  }
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

export function configuredWorkspaceEmails(): string[] {
  return Object.keys(configuredWorkspaces());
}
