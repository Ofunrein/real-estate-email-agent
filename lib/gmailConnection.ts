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

export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_LABELS_SCOPE = "https://www.googleapis.com/auth/gmail.labels";
export const GOOGLE_DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";
export const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export const GMAIL_AGENT_SCOPES = [
  GMAIL_MODIFY_SCOPE,
  GMAIL_LABELS_SCOPE,
  GOOGLE_SHEETS_SCOPE,
  GOOGLE_DRIVE_METADATA_SCOPE,
] as const;

export const GMAIL_AUTOSEND_SCOPES = [
  ...GMAIL_AGENT_SCOPES,
  GMAIL_SEND_SCOPE,
] as const;

export function gmailScopesForMode(mode?: string): string[] {
  const normalized = String(mode || "").trim().toLowerCase();
  return normalized === "autosend" || normalized === "send"
    ? [...GMAIL_AUTOSEND_SCOPES]
    : [...GMAIL_AGENT_SCOPES];
}

export function emailCapabilitiesForScopes(scopes: string[] = []) {
  const granted = new Set(scopes);
  return [
    { scope: GMAIL_MODIFY_SCOPE, label: "Read, thread, draft, and label workflow", granted: granted.has(GMAIL_MODIFY_SCOPE) },
    { scope: GMAIL_LABELS_SCOPE, label: "Create/update Iris Gmail labels", granted: granted.has(GMAIL_LABELS_SCOPE) || granted.has(GMAIL_MODIFY_SCOPE) },
    { scope: GMAIL_SEND_SCOPE, label: "Auto-send Gmail replies", granted: granted.has(GMAIL_SEND_SCOPE) },
    { scope: GOOGLE_SHEETS_SCOPE, label: "Read configured Google Sheets data", granted: granted.has(GOOGLE_SHEETS_SCOPE) },
    { scope: GOOGLE_DRIVE_METADATA_SCOPE, label: "Receive configured Google Sheets file-change events", granted: granted.has(GOOGLE_DRIVE_METADATA_SCOPE) },
  ];
}

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
  htmlBody?: string;
  threadId?: string;
  messageId?: string;
  references?: string;
  attachments?: Array<{ filename: string; contentType: string; path?: string; data?: Buffer }>;
};

export type GmailReplyResult = {
  threaded: boolean;
  mailboxEmail: string;
  messageId: string;
  threadId: string;
  fallbackReason?: string;
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

export function gmailConnectUrl(input: { request: NextRequest; operatorEmail: string; clientId: string; mode?: string }) {
  const redirectUri = gmailOAuthRedirectUri(input.request);
  const oauth = createGmailOAuthClient(redirectUri);
  return oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: gmailScopesForMode(input.mode),
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
  const session = await createIrisGmailSession();
  return session.gmail;
}

export async function createIrisGmailSession(): Promise<{ gmail: GmailClient; accountEmail: string; legacy: boolean }> {
  if (databaseEnabled()) {
    const account = await readDefaultEmailAccountFromDatabase();
    if (account) {
      const token = decryptEmailAccountToken<GmailTokenJson>(account.token_json_encrypted);
      const oauth = createGmailOAuthClient(gmailOAuthRedirectUri());
      return {
        gmail: gmailClientFromToken({
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
        }),
        accountEmail: account.email,
        legacy: false,
      };
    }
  }

  const oauth = legacyOAuthClient();
  return {
    gmail: gmailClientFromToken({ token: legacyToken(), oauth }),
    accountEmail: "legacy token",
    legacy: true,
  };
}

export function validGmailThreadId(value?: string) {
  return Boolean(value && /^[a-f0-9]{8,}$/i.test(value.trim()));
}

function gmailErrorCode(error: unknown): number {
  const candidate = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const value = candidate?.code ?? candidate?.status ?? candidate?.response?.status;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gmailErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const candidate = error as { message?: unknown; errors?: Array<{ message?: unknown }> };
  return String(candidate?.message || candidate?.errors?.[0]?.message || error || "");
}

export function isGmailNotFoundError(error: unknown): boolean {
  const message = gmailErrorMessage(error);
  return gmailErrorCode(error) === 404 || /requested entity was not found|not found/i.test(message);
}

export function isGmailAuthOrScopeError(error: unknown): boolean {
  const code = gmailErrorCode(error);
  return code === 401 || code === 403;
}

async function verifyGmailThread(gmail: GmailClient, threadId: string): Promise<void> {
  await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "minimal",
  });
}

export async function sendGmailReply(gmail: GmailClient, input: GmailReplyInput): Promise<GmailReplyResult> {
  return sendGmailReplyWithOptions(gmail, input, { mailboxEmail: "" });
}

export async function sendGmailReplyWithOptions(
  gmail: GmailClient,
  input: GmailReplyInput,
  options: { mailboxEmail?: string; fallbackUnthreadedOnMissingThread?: boolean } = {},
): Promise<GmailReplyResult> {
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
  if (!input.attachments?.length && input.htmlBody) {
    raw = Buffer.from([
      ...baseHeaders,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      input.htmlBody,
      `--${boundary}--`,
    ].join("\r\n")).toString("base64url");
  } else if (!input.attachments?.length) {
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
      const data = attachment.data ?? (attachment.path ? fs.readFileSync(attachment.path) : Buffer.alloc(0));
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
  const normalizedThreadId = validGmailThreadId(input.threadId) ? input.threadId?.trim() : "";
  const mailboxEmail = options.mailboxEmail || "";
  const fallbackEnabled = options.fallbackUnthreadedOnMissingThread !== false;

  async function send(threadId?: string): Promise<GmailReplyResult> {
    const body = threadId ? { ...requestBody, threadId } : { raw };
    const result = await gmail.users.messages.send({ userId: "me", requestBody: body });
    return {
      threaded: Boolean(threadId),
      mailboxEmail,
      messageId: String(result.data.id || ""),
      threadId: String(result.data.threadId || threadId || ""),
    };
  }

  if (!normalizedThreadId) {
    return send();
  }

  try {
    await verifyGmailThread(gmail, normalizedThreadId);
    return await send(normalizedThreadId);
  } catch (error) {
    if (!fallbackEnabled || isGmailAuthOrScopeError(error) || !isGmailNotFoundError(error)) {
      throw error;
    }
    const fresh = await send();
    return {
      ...fresh,
      threaded: false,
      fallbackReason: "Gmail thread was not found in the active sending mailbox, so Iris sent a fresh email.",
    };
  }
}

// Gmail only accepts a fixed palette. Map app hex colors to nearest supported Gmail color.
// Full palette: https://developers.google.com/gmail/api/reference/rest/v1/users.labels
const GMAIL_LABEL_COLORS: Record<string, { backgroundColor: string; textColor: string }> = {
  "#7c3aed": { backgroundColor: "#8e63ce", textColor: "#ffffff" }, // needs_reply (purple)
  "#dc2626": { backgroundColor: "#cc3a21", textColor: "#ffffff" }, // hot_lead (red)
  "#ea580c": { backgroundColor: "#e66550", textColor: "#ffffff" }, // showing (orange-red)
  "#0f766e": { backgroundColor: "#0b804b", textColor: "#ffffff" }, // seller/valuation (teal)
  "#2563eb": { backgroundColor: "#285bac", textColor: "#ffffff" }, // financing (blue)
  "#be123c": { backgroundColor: "#a61c00", textColor: "#ffffff" }, // needs_human (dark red)
  "#64748b": { backgroundColor: "#999999", textColor: "#ffffff" }, // nurture (gray)
  "#334155": { backgroundColor: "#444444", textColor: "#ffffff" }, // closed (dark gray)
};

function gmailLabelColor(hexColor?: string): { backgroundColor: string; textColor: string } | undefined {
  if (!hexColor) return undefined;
  return GMAIL_LABEL_COLORS[hexColor.toLowerCase()] || GMAIL_LABEL_COLORS["#64748b"];
}

export async function ensureGmailLabel(
  gmail: GmailClient,
  name: string,
  color?: string,
): Promise<string> {
  const labels = await gmail.users.labels.list({ userId: "me" });
  const existing = labels.data.labels?.find((label) => label.name === name);
  if (existing?.id) {
    // Update color if it changed
    if (color) {
      const c = gmailLabelColor(color);
      if (c) {
        await gmail.users.labels.patch({
          userId: "me",
          id: existing.id,
          requestBody: { color: c },
        }).catch(() => null);
      }
    }
    return existing.id;
  }
  const c = color ? gmailLabelColor(color) : undefined;
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
      ...(c ? { color: c } : {}),
    },
  });
  if (!created.data.id) throw new Error(`Unable to create Gmail label ${name}`);
  return created.data.id;
}
