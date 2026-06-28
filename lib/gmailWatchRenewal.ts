import { google } from "googleapis";

import {
  markEmailAccountErrorForClientInDatabase,
  readConnectedGmailAccountsForWatchRenewal,
  updateEmailAccountGmailWatchInDatabase,
  updateEmailAccountTokenForClientInDatabase,
  type EmailAccountRecord,
} from "@/lib/database";
import {
  createGmailOAuthClient,
  gmailOAuthRedirectUri,
  type GmailTokenJson,
} from "@/lib/gmailConnection";
import {
  decryptEmailAccountToken,
  encryptEmailAccountToken,
} from "@/lib/emailAccountCrypto";

export type GmailWatchRenewalResult = {
  ok: boolean;
  topicName: string;
  scanned: number;
  renewed: number;
  failed: number;
  skipped: number;
  results: Array<{
    clientId: string;
    email: string;
    status: "renewed" | "failed" | "skipped";
    historyId?: string;
    expiration?: string;
    error?: string;
  }>;
};

function gmailWatchTopicName(): string {
  const explicit = process.env.GMAIL_PUBSUB_TOPIC || "";
  if (explicit) return explicit;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || "";
  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT_ID or GMAIL_PUBSUB_TOPIC is required for Gmail watch renewal.");
  }
  return `projects/${projectId}/topics/gmail-iris-push`;
}

async function renewAccountWatch(account: EmailAccountRecord, topicName: string): Promise<GmailWatchRenewalResult["results"][number]> {
  try {
    const token = decryptEmailAccountToken<GmailTokenJson>(account.token_json_encrypted);
    if (!token.refresh_token) {
      throw new Error("Connected Gmail account is missing refresh_token; reconnect Gmail from dashboard OAuth.");
    }

    const oauth = createGmailOAuthClient(gmailOAuthRedirectUri());
    oauth.setCredentials(token);
    oauth.on("tokens", (tokens) => {
      const nextToken = {
        ...token,
        ...tokens,
        refresh_token: tokens.refresh_token || token.refresh_token,
      };
      updateEmailAccountTokenForClientInDatabase(
        account.client_id,
        account.email,
        encryptEmailAccountToken(nextToken),
      ).catch(() => null);
    });

    const gmail = google.gmail({ version: "v1", auth: oauth });
    const watch = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName,
        labelIds: ["INBOX"],
        labelFilterBehavior: "INCLUDE",
      },
    });

    const historyId = String(watch.data.historyId || "");
    const expiration = watch.data.expiration
      ? new Date(Number(watch.data.expiration)).toISOString()
      : "";
    if (!historyId || !expiration) {
      throw new Error("Gmail watch response did not include historyId and expiration.");
    }

    await updateEmailAccountGmailWatchInDatabase({
      clientId: account.client_id,
      email: account.email,
      historyId,
      expiration,
    });

    return {
      clientId: account.client_id,
      email: account.email,
      status: "renewed",
      historyId,
      expiration,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markEmailAccountErrorForClientInDatabase(account.client_id, account.email, message).catch(() => null);
    return {
      clientId: account.client_id,
      email: account.email,
      status: "failed",
      error: message,
    };
  }
}

export async function registerGmailWatchForAccount(account: EmailAccountRecord): Promise<GmailWatchRenewalResult["results"][number]> {
  return renewAccountWatch(account, gmailWatchTopicName());
}

export async function renewDueGmailWatches(options: {
  renewWithinHours?: number;
  limit?: number;
  force?: boolean;
} = {}): Promise<GmailWatchRenewalResult> {
  const topicName = gmailWatchTopicName();
  const accounts = await readConnectedGmailAccountsForWatchRenewal({
    renewWithinHours: options.renewWithinHours ?? 48,
    limit: options.limit ?? 100,
    force: options.force,
  });

  const results: GmailWatchRenewalResult["results"] = [];
  for (const account of accounts) {
    results.push(await renewAccountWatch(account, topicName));
  }

  const renewed = results.filter((result) => result.status === "renewed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  return {
    ok: failed === 0,
    topicName,
    scanned: accounts.length,
    renewed,
    failed,
    skipped,
    results,
  };
}
