import { composioExternalUserId, createComposioClient } from "@/lib/composioConnection";
import { providerNotConnected, providerUnavailable } from "../provider-errors";

type ComposioClient = ReturnType<typeof createComposioClient>;

export type ComposioProviderContext = {
  userEmail: string;
  connectedAccountId?: string;
  provider: string;
};

export type ComposioToolRequest = {
  context: ComposioProviderContext;
  envSlug?: string;
  fallbackSlugs: string[];
  args?: Record<string, unknown>;
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toolMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(tool|slug|action).*(not found|unknown|unavailable|invalid)|404/i.test(message);
}

function connectionMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(connected account|connection|auth|oauth).*(not found|missing|expired|inactive|unauthorized)|401|403/i.test(message);
}

export async function executeComposioTool(input: ComposioToolRequest): Promise<Record<string, unknown>> {
  const connectedAccountId = input.context.connectedAccountId?.trim();
  if (!connectedAccountId) {
    throw providerNotConnected(input.context.provider, `${input.context.provider} requires a Composio connected account id`);
  }

  let composio: ComposioClient;
  try {
    composio = createComposioClient();
  } catch (error) {
    throw providerUnavailable(input.context.provider, `${input.context.provider} is unavailable: ${error instanceof Error ? error.message : String(error)}`, error);
  }

  const slugs = [input.envSlug, ...input.fallbackSlugs].filter((slug): slug is string => Boolean(slug?.trim()));
  const uniqueSlugs = Array.from(new Set(slugs));
  if (!uniqueSlugs.length) {
    throw providerUnavailable(input.context.provider, `${input.context.provider} has no configured Composio tool slug`);
  }

  const userId = composioExternalUserId(input.context.userEmail);
  const misses: string[] = [];
  for (const slug of uniqueSlugs) {
    try {
      const result = await composio.tools.execute(slug, {
        userId,
        connectedAccountId,
        arguments: input.args || {},
        dangerouslySkipVersionCheck: true,
      });
      return jsonRecord(result);
    } catch (error) {
      if (connectionMissing(error)) {
        throw providerNotConnected(input.context.provider, `${input.context.provider} connected account is not usable`, error);
      }
      if (toolMissing(error)) {
        misses.push(slug);
        continue;
      }
      throw providerUnavailable(input.context.provider, `${input.context.provider} Composio tool ${slug} failed`, error);
    }
  }

  throw providerUnavailable(
    input.context.provider,
    `${input.context.provider} is unavailable: none of these Composio tool slugs exist in this workspace (${misses.join(", ")})`,
  );
}

export function resultItems(result: Record<string, unknown>): Record<string, unknown>[] {
  const queue: unknown[] = [result];
  while (queue.length) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    }
    if (!value || typeof value !== "object") continue;
    const source = value as Record<string, unknown>;
    for (const key of ["items", "results", "events", "contacts", "data", "value"]) {
      if (key in source) queue.push(source[key]);
    }
  }
  return [];
}

export function resultString(result: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
