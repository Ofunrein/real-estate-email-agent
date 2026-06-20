import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { google, type gmail_v1 } from "googleapis";
import type { NextRequest } from "next/server";

import {
  databaseEnabled,
  markEmailAccountErrorInDatabase,
  readDefaultEmailAccountFromDatabase,
  updateEmailAccountTokenInDatabase,
  upsertEmailAccountInDatabase,
} from "@/lib/database";
import {
  decryptEmailAccountToken,
  encryptEmailAccountToken,
} from "@/lib/emailAccountCrypto";

export type GmailTokenJson = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expiry_date?: number;
};

export type GmailClient = gmail_v1.Gmail;

export const GMAIL_AGENT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

type OAuthCredentials = {
  installed?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
};

export type GmailReplyInput = {
  to: string;
  subject?: string;
  body: string;
  threadId?: string;
  messageId?: string;
  references?: string;
  attachments?: Array<{ filename: string; contentType: string; path: string }>;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readJsonEnv<T>(name: string): T | null {
  const value = process.env[name];
  if (!value) return null;
  return JSON.parse(value) as T;
}

function oauthSecret(): string {
  return process.env.EMAIL_ACCOUNT_OAUTH_STATE_SECRET
    || process.env.AUTH_SECRET
    || process.env.CHANNEL_WEBHOOK_SECRET
    || "";
}

function appBaseUrl(request?: NextRequest): string {
  if (request) return new URL(request.url).origin;
  return (process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || "").replace(/\/$/, "");
}

export function gmailOAuthRedirectUri(request?: NextRequest): string {
  return process.env.GMAIL_OAUTH_REDIRECT_URI
    || `${appBaseUrl(request)}/api/settings/email-account/callback`;
}

function oauthClientConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error("GMAIL_OAUTH_CLIENT_ID/GMAIL_OAUTH_CLIENT_SECRET or AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET are required");
  }
  return { clientId, clientSecret };
}

export function createGmailOAuthClient(redirectUri: string) {
  const { clientId, clientSecret } = oauthClientConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function signedGmailOAuthState(input: { clientId: string; operatorEmail: string; next?: string }) {
  const secret = oauthSecret();
  if (!secret) throw new Error("AUTH_SECRET is required for Gmail OAuth state");
  const payload = Buffer.from(JSON.stringify({
    ...input,
    nonce: crypto.randomBytes(16).toString("base64url"),
    iat: Date.now(),
  }), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGmailOAuthState(value: string): { clientId: string; operatorEmail: string; next?: string } {
  const secret = oauthSecret();
  if (!secret) throw new Error("AUTH_SECRET is required for Gmail OAuth state");
  const [payload, signature] = value.split(".");
  if (!payload || !signature) throw new Error("Invalid Gmail OAuth state");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Invalid Gmail OAuth state signature");
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    clientId?: string;
    operatorEmail?: string;
    next?: string;
    iat?: number;
  };
  if (!decoded.iat || Date.now() - decoded.iat > 10 * 60 * 1000) {
    throw new Error("Expired Gmail OAuth state");
  }
  if (!decoded.clientId || !decoded.operatorEmail) {
    throw new Error("Incomplete Gmail OAuth state");
  }
  return {
    clientId: decoded.clientId,
    operatorEmail: decoded.operatorEmail,
    next: decoded.next,
  };
}

export function gmailConnectUrl(input: { request: NextRequest; operatorEmail: string; clientId: string }) {
  const redirectUri = gmailOAuthRedirectUri(input.request);
  const oauth = createGmailOAuthClient(redirectUri);
  return oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: [...GMAIL_AGENT_SCOPES],
    include_granted_scopes: true,
    state: signedGmailOAuthState({
      clientId: input.clientId,
      operatorEmail: input.operatorEmail,
      next: "/",
    }),
  });
}

function legacyOAuthClient() {
  const credentialsPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.GMAIL_CREDENTIALS_PATH || "credentials.json");
  const credentials = readJsonEnv<OAuthCredentials>("GMAIL_CREDENTIALS_JSON") || readJson<OAuthCredentials>(credentialsPath);
  const app = credentials.installed || credentials.web;
  if (!app?.client_id || !app.client_secret) {
    throw new Error("Gmail credentials are missing OAuth client data");
  }
  return new google.auth.OAuth2(app.client_id, app.client_secret, app.redirect_uris?.[0]);
}

function legacyToken(): GmailTokenJson {
  const tokenPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.GMAIL_TOKEN_PATH || "token.json");
  return readJsonEnv<GmailTokenJson>("GMAIL_TOKEN_JSON") || readJson<GmailTokenJson>(tokenPath);
}

function normalizeGmailTokenJson(tokens: object): GmailTokenJson {
  return Object.fromEntries(
    Object.entries(tokens).filter(([, value]) => value !== null && value !== undefined),
  ) as GmailTokenJson;
}

function gmailClientFromToken(input: {
  token: GmailTokenJson;
  oauth: ReturnType<typeof createGmailOAuthClient>;
  onTokens?: (tokens: GmailTokenJson) => void;
}): GmailClient {
  input.oauth.setCredentials(input.token);
  if (input.onTokens) {
    input.oauth.on("tokens", (tokens) => {
      input.onTokens?.(normalizeGmailTokenJson(tokens));
    });
  }
  return google.gmail({ version: "v1", auth: input.oauth });
}

export async function connectGmailAccountFromCode(input: {
  request: NextRequest;
  code: string;
  connectedBy: string;
}) {
  const oauth = createGmailOAuthClient(gmailOAuthRedirectUri(input.request));
  const { tokens } = await oauth.getToken(input.code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Reconnect with consent prompt enabled.");
  }
  oauth.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = String(profile.data.emailAddress || "").toLowerCase();
  if (!email) throw new Error("Unable to read connected Gmail account email");
  const token = tokens as GmailTokenJson;
  return upsertEmailAccountInDatabase({
    email,
    tokenJsonEncrypted: encryptEmailAccountToken(token),
    scopes: String(token.scope || "").split(/\s+/).filter(Boolean),
    connectedBy: input.connectedBy,
  });
}

export async function createIrisGmailClient(): Promise<GmailClient> {
  if (databaseEnabled()) {
    const account = await readDefaultEmailAccountFromDatabase();
    if (account) {
      const token = decryptEmailAccountToken<GmailTokenJson>(account.token_json_encrypted);
      const oauth = createGmailOAuthClient(gmailOAuthRedirectUri());
      return gmailClientFromToken({
        token,
        oauth,
        onTokens: (tokens) => {
          const nextToken = {
            ...token,
            ...tokens,
            refresh_token: tokens.refresh_token || token.refresh_token,
          };
          updateEmailAccountTokenInDatabase(
            account.email,
            encryptEmailAccountToken(nextToken),
          ).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            markEmailAccountErrorInDatabase(account.email, message).catch(() => {});
          });
        },
      });
    }
  }

  const oauth = legacyOAuthClient();
  return gmailClientFromToken({ token: legacyToken(), oauth });
}

export function validGmailThreadId(value?: string) {
  return Boolean(value && /^[a-f0-9]{8,}$/i.test(value.trim()));
}

export async function sendGmailReply(gmail: GmailClient, input: GmailReplyInput): Promise<void> {
  const subjectRaw = input.subject || "(no subject)";
  const subject = /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw}`;
  const boundary = `boundary_${Date.now().toString(36)}`;
  const baseHeaders = [
    `To: ${input.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    ...(input.messageId
      ? [`In-Reply-To: ${input.messageId}`, `References: ${((input.references || "") + " " + input.messageId).trim()}`]
      : []),
  ];

  let raw: string;
  if (!input.attachments?.length) {
    raw = Buffer.from([
      ...baseHeaders,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
    ].join("\r\n")).toString("base64url");
  } else {
    const parts: string[] = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
    ];
    for (const attachment of input.attachments) {
      const data = fs.readFileSync(attachment.path);
      parts.push(
        `--${boundary}`,
        `Content-Type: ${attachment.contentType}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        "",
        data.toString("base64"),
      );
    }
    parts.push(`--${boundary}--`);
    raw = Buffer.from([
      ...baseHeaders,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      ...parts,
    ].join("\r\n")).toString("base64url");
  }

  const requestBody: { raw: string; threadId?: string } = { raw };
  if (validGmailThreadId(input.threadId)) requestBody.threadId = input.threadId?.trim();
  await gmail.users.messages.send({ userId: "me", requestBody });
}
