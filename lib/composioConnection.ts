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

export function composioExternalUserId(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9_.@-]/g, "_");
}

export function createComposioClient(): Composio {
  const apiKey = composioApiKey();
  if (!apiKey) throw new Error("COMPOSIO_API_KEY is required");
  return new Composio({ apiKey });
}

export async function createComposioGmailConnectLink(input: {
  userEmail: string;
  callbackUrl: string;
}) {
  const authConfigId = composioGmailAuthConfigId();
  if (!authConfigId) throw new Error("COMPOSIO_GMAIL_AUTH_CONFIG_ID is required");
  const composio = createComposioClient();
  const request = await composio.connectedAccounts.link(
    composioExternalUserId(input.userEmail),
    authConfigId,
    {
      callbackUrl: input.callbackUrl,
    },
  );
  return {
    id: request.id,
    redirectUrl: request.redirectUrl,
  };
}
