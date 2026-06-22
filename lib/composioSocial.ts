import { composioExternalUserId, createComposioClient } from "@/lib/composioConnection";

export type ComposioSocialChannel = "instagram" | "messenger" | "whatsapp";

type SocialSenderConfig = {
  toolSlug: string;
  userId: string;
  connectedAccountId?: string;
  arguments: Record<string, unknown>;
};

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Composio social sender arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function configFor(channel: ComposioSocialChannel, env: Record<string, string | undefined> = process.env): SocialSenderConfig | null {
  const prefix = channel === "instagram"
    ? "COMPOSIO_INSTAGRAM"
    : channel === "whatsapp"
      ? "COMPOSIO_WHATSAPP"
      : "COMPOSIO_FACEBOOK";
  const toolSlug = env[`${prefix}_SEND_TOOL_SLUG`] || "";
  if (!toolSlug.trim()) return null;
  const userEmail = env[`${prefix}_USER_EMAIL`] || env.DASHBOARD_ADMIN_EMAIL || env.NEXTAUTH_EMAIL || "default";
  return {
    toolSlug,
    userId: env[`${prefix}_USER_ID`] || composioExternalUserId(userEmail),
    connectedAccountId: env[`${prefix}_CONNECTED_ACCOUNT_ID`] || undefined,
    arguments: parseJsonObject(env[`${prefix}_SEND_ARGUMENTS_JSON`]),
  };
}

function fillTemplate(value: unknown, replacements: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => replacements[key] ?? "");
  }
  if (Array.isArray(value)) return value.map((item) => fillTemplate(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, fillTemplate(item, replacements)]),
    );
  }
  return value;
}

export async function sendComposioSocialMessage(input: {
  channel: ComposioSocialChannel;
  to: string;
  body: string;
  mediaUrls?: string[];
  threadRef?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = configFor(input.channel);
  if (!config) {
    const envPrefix = input.channel === "instagram"
      ? "COMPOSIO_INSTAGRAM"
      : input.channel === "whatsapp"
        ? "COMPOSIO_WHATSAPP"
        : "COMPOSIO_FACEBOOK";
    return { ok: false, error: `${envPrefix}_SEND_TOOL_SLUG is required for manual ${input.channel} sends` };
  }
  const composio = createComposioClient();
  const args = fillTemplate(config.arguments, {
    to: input.to,
    recipient: input.to,
    body: input.body,
    text: input.body,
    message: input.body,
    mediaUrl: input.mediaUrls?.[0] || "",
    mediaUrlsJson: JSON.stringify(input.mediaUrls || []),
    threadRef: input.threadRef || input.to,
  }) as Record<string, unknown>;
  await composio.tools.execute(config.toolSlug, {
    userId: config.userId,
    connectedAccountId: config.connectedAccountId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
  return { ok: true };
}
