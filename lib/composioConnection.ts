import { Composio } from "@composio/core";

function composioApiKey(): string {
  return process.env.COMPOSIO_API_KEY || "";
}

export function composioEnabled(): boolean {
  return Boolean(composioApiKey());
}

export function composioGmailAuthConfigId(): string {
  return process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID || "";
}

export type ComposioConnectChannel = "gmail" | "instagram" | "facebook" | "whatsapp";

const CHANNEL_AUTH_CONFIG_ENV: Record<ComposioConnectChannel, string> = {
  gmail: "COMPOSIO_GMAIL_AUTH_CONFIG_ID",
  instagram: "COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID",
  facebook: "COMPOSIO_FACEBOOK_AUTH_CONFIG_ID",
  whatsapp: "COMPOSIO_WHATSAPP_AUTH_CONFIG_ID",
};

const CHANNEL_TOOLKIT: Record<Exclude<ComposioConnectChannel, "gmail">, string> = {
  instagram: "instagram",
  facebook: "facebook",
  whatsapp: "whatsapp",
};

export function composioExternalUserId(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9_.@-]/g, "_");
}

export function createComposioClient(): Composio {
  const apiKey = composioApiKey();
  if (!apiKey) throw new Error("COMPOSIO_API_KEY is required");
  return new Composio({ apiKey });
}

export function composioAuthConfigId(channel: ComposioConnectChannel): string {
  return process.env[CHANNEL_AUTH_CONFIG_ENV[channel]] || "";
}

export function composioToolkit(channel: Exclude<ComposioConnectChannel, "gmail">): string {
  return CHANNEL_TOOLKIT[channel];
}

function linkResponsePayload(request: unknown): { id?: string; redirectUrl?: string } {
  const payload = request as { id?: string; redirectUrl?: string; redirect_url?: string; url?: string };
  return {
    id: payload.id,
    redirectUrl: payload.redirectUrl || payload.redirect_url || payload.url,
  };
}

export async function createComposioGmailConnectLink(input: {
  userEmail: string;
  callbackUrl: string;
}) {
  const authConfigId = composioAuthConfigId("gmail");
  if (!authConfigId) throw new Error(`${CHANNEL_AUTH_CONFIG_ENV.gmail} is required`);
  const composio = createComposioClient();
  const request = await composio.connectedAccounts.link(
    composioExternalUserId(input.userEmail),
    authConfigId,
    {
      callbackUrl: input.callbackUrl,
    },
  );
  return linkResponsePayload(request);
}

export async function createComposioConnectLink(input: {
  channel: ComposioConnectChannel;
  userEmail: string;
  callbackUrl: string;
}) {
  if (input.channel === "gmail") return createComposioGmailConnectLink(input);

  const composio = createComposioClient();
  const userId = composioExternalUserId(input.userEmail);
  const authConfigId = composioAuthConfigId(input.channel);
  const toolkit = composioToolkit(input.channel);
  const maybeComposio = composio as unknown as {
    create?: (userId: string) => Promise<{
      authorize?: (toolkit: string, options: { callbackUrl: string; authConfigId?: string }) => Promise<unknown>;
    }>;
    connectedAccounts?: {
      link?: (userId: string, authConfigId: string, options: { callbackUrl: string }) => Promise<unknown>;
    };
  };

  if (typeof maybeComposio.create === "function") {
    const session = await maybeComposio.create(userId);
    if (typeof session.authorize !== "function") {
      throw new Error("Composio session authorize is unavailable in the installed SDK");
    }
    return linkResponsePayload(await session.authorize(toolkit, {
      callbackUrl: input.callbackUrl,
      ...(authConfigId ? { authConfigId } : {}),
    }));
  }

  if (!authConfigId) throw new Error(`${CHANNEL_AUTH_CONFIG_ENV[input.channel]} is required with this Composio SDK version`);
  if (!maybeComposio.connectedAccounts?.link) {
    throw new Error("Composio connect link API is unavailable in the installed SDK");
  }
  return linkResponsePayload(await maybeComposio.connectedAccounts.link(userId, authConfigId, {
    callbackUrl: input.callbackUrl,
  }));
}
