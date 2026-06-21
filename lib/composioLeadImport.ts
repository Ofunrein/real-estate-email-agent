import { composioExternalUserId, createComposioClient } from "@/lib/composioConnection";

export type ComposioImportConfig = {
  toolSlug: string;
  toolkit: string;
  userId: string;
  connectedAccountId?: string;
  arguments: Record<string, unknown>;
  resultPath: string;
};

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("COMPOSIO_IMPORT_ARGUMENTS_JSON must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function composioImportConfig(env: Record<string, string | undefined> = process.env): ComposioImportConfig | null {
  const toolSlug = env.COMPOSIO_IMPORT_TOOL_SLUG || "";
  if (!toolSlug.trim()) return null;
  const userEmail = env.COMPOSIO_IMPORT_USER_EMAIL || env.DASHBOARD_ADMIN_EMAIL || env.NEXTAUTH_EMAIL || "default";
  return {
    toolSlug,
    toolkit: env.COMPOSIO_IMPORT_TOOLKIT || "",
    userId: env.COMPOSIO_IMPORT_USER_ID || composioExternalUserId(userEmail),
    connectedAccountId: env.COMPOSIO_IMPORT_CONNECTED_ACCOUNT_ID || undefined,
    arguments: parseJsonObject(env.COMPOSIO_IMPORT_ARGUMENTS_JSON),
    resultPath: env.COMPOSIO_IMPORT_RESULT_PATH || "data.items",
  };
}

export function valueAtPath(value: unknown, path: string): unknown {
  if (!path || path === ".") return value;
  return path.split(".").filter(Boolean).reduce<unknown>((current, part) => {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === "object") return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

function normalizeRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["items", "results", "records", "contacts", "data"]) {
      const nested = normalizeRows(record[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

export function rowsFromComposioResult(result: unknown, resultPath = "data.items"): Record<string, unknown>[] {
  const direct = normalizeRows(valueAtPath(result, resultPath));
  if (direct.length) return direct;
  return normalizeRows(result);
}

export async function pullComposioLeadRows(env: Record<string, string | undefined> = process.env): Promise<{
  rows: Record<string, unknown>[];
  config: ComposioImportConfig;
}> {
  const config = composioImportConfig(env);
  if (!config) {
    throw new Error("Composio import is not configured. Set COMPOSIO_IMPORT_TOOL_SLUG plus COMPOSIO_IMPORT_RESULT_PATH for the connected CRM.");
  }
  const composio = createComposioClient();
  const result = await composio.tools.execute(config.toolSlug, {
    userId: config.userId,
    connectedAccountId: config.connectedAccountId,
    arguments: config.arguments,
    dangerouslySkipVersionCheck: true,
  });
  const rows = rowsFromComposioResult(result, config.resultPath);
  if (!rows.length) throw new Error(`Composio tool ${config.toolSlug} returned no importable rows at ${config.resultPath}`);
  return { rows, config };
}
