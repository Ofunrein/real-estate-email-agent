import { composioExternalUserId, createComposioClient } from "@/lib/composioConnection";
import { listChannelConnections, type ChannelConnectionRecord } from "@/lib/channelConnections";

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

function savedChannelAndProvider(channel: ComposioSocialChannel) {
  return {
    savedChannel: channel === "messenger" ? "messenger" : channel,
    provider: channel === "messenger" ? "composio_facebook" : `composio_${channel}`,
  };
}

async function savedConnection(channel: ComposioSocialChannel): Promise<ChannelConnectionRecord | null> {
  const status = await listChannelConnections();
  const { savedChannel, provider } = savedChannelAndProvider(channel);
  const match = status.connections
    .filter((connection) =>
      connection.channel === savedChannel
      && connection.provider === provider
      && connection.status === "connected"
      && connection.connected_account_id
    )
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())[0];
  return match || null;
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

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasTemplateOrValue(args: Record<string, unknown>, key: string) {
  return typeof args[key] === "string" && String(args[key]).trim().length > 0;
}

function channelTextKey(args: Record<string, unknown>) {
  return hasTemplateOrValue(args, "message_text") ? "message_text" : "text";
}

export function buildComposioSocialSendArguments(
  channel: ComposioSocialChannel,
  args: Record<string, unknown>,
  input: { to: string; body: string; mediaUrls?: string[]; threadRef?: string },
) {
  const next = { ...args };
  next.to = input.to;
  next.recipient = input.to;
  next.body = input.body;
  next.message = input.body;
  if (channel === "instagram") {
    next.recipient_id = input.to;
    next[channelTextKey(next)] = input.body;
  } else if (channel === "messenger") {
    next.recipient_id = input.to;
    next[channelTextKey(next)] = input.body;
  } else {
    next.to_number = input.to;
    next.recipient_id = input.to;
    next[channelTextKey(next)] = input.body;
  }
  if (input.mediaUrls?.length) {
    next.media_url = input.mediaUrls[0];
    next.media_urls = input.mediaUrls;
    next.mediaUrls = input.mediaUrls;
  }
  if (input.threadRef) next.thread_ref = input.threadRef;
  return next;
}

export function composioSocialSendHealth(
  channel: ComposioSocialChannel,
  connection?: Pick<ChannelConnectionRecord, "metadata"> | null,
  env: Record<string, string | undefined> = process.env,
): { configured: boolean; outboundReady: boolean; missing: string[]; arguments: Record<string, unknown> } {
  let config: SocialSenderConfig | null = null;
  try {
    config = configFor(channel, env);
  } catch {
    config = null;
  }
  if (!config) {
    const prefix = channel === "instagram" ? "COMPOSIO_INSTAGRAM" : channel === "whatsapp" ? "COMPOSIO_WHATSAPP" : "COMPOSIO_FACEBOOK";
    return { configured: false, outboundReady: false, missing: [`${prefix}_SEND_TOOL_SLUG`], arguments: {} };
  }

  const metadataArgs = jsonRecord(connection?.metadata?.default_send_arguments);
  const args = { ...config.arguments, ...metadataArgs };
  const missing: string[] = [];

  if (channel === "instagram") {
    // Recipient and text are supplied from the live thread at send time.
  } else if (channel === "messenger") {
    if (!hasTemplateOrValue(args, "page_id")) missing.push("page_id");
    // Recipient and text are supplied from the live thread at send time.
  } else {
    if (!hasTemplateOrValue(args, "phone_number_id")) missing.push("phone_number_id");
    // Recipient and text are supplied from the live thread at send time.
  }

  return {
    configured: true,
    outboundReady: missing.length === 0,
    missing,
    arguments: args,
  };
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
  const saved = await savedConnection(input.channel);
  const connectedAccountId = saved?.connected_account_id || config.connectedAccountId || "";
  const baseArgs = {
    ...config.arguments,
    ...jsonRecord(saved?.metadata?.default_send_arguments),
  };
  const templatedArgs = fillTemplate(baseArgs, {
    to: input.to,
    recipient: input.to,
    body: input.body,
    text: input.body,
    message: input.body,
    mediaUrl: input.mediaUrls?.[0] || "",
    mediaUrlsJson: JSON.stringify(input.mediaUrls || []),
    threadRef: input.threadRef || input.to,
  }) as Record<string, unknown>;
  const args = buildComposioSocialSendArguments(input.channel, templatedArgs, input);
  await composio.tools.execute(config.toolSlug, {
    userId: saved?.external_user_id || config.userId,
    connectedAccountId: connectedAccountId || undefined,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
  return { ok: true };
}
