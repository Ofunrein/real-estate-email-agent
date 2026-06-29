import {
  databaseEnabled,
  readDefaultEmailAccountFromDatabase,
  readInboxSettingsFromDatabase,
  updateEmailAccountGmailHistoryCursorInDatabase,
} from "@/lib/database";
import {
  createIrisGmailSession,
} from "@/lib/gmailConnection";
import {
  processIrisEmailMessageIds,
  processIrisEmailPoll,
  type IrisEmailPollOptions,
} from "@/lib/irisEmail";
import { inngest } from "@/lib/inngest/client";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";

export type GmailPushReceivedEvent = {
  historyId: string;
  emailAddress?: string;
  pubSubMessageId?: string;
  receivedAt?: string;
};

type GmailHistoryTargetResult = {
  mode: "history" | "fallback";
  messageIds: string[];
  previousHistoryId: string;
  nextHistoryId: string;
  reason?: string;
};

function gmailHistoryErrorCode(error: unknown): number {
  const candidate = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const value = candidate?.code ?? candidate?.status ?? candidate?.response?.status;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gmailHistoryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const candidate = error as { message?: unknown; errors?: Array<{ message?: unknown }> };
  return String(candidate?.message || candidate?.errors?.[0]?.message || error || "");
}

async function messageIdsFromGmailHistory(nextHistoryId: string): Promise<GmailHistoryTargetResult> {
  if (!databaseEnabled()) {
    return { mode: "fallback", messageIds: [], previousHistoryId: "", nextHistoryId, reason: "database_disabled" };
  }
  const account = await readDefaultEmailAccountFromDatabase();
  const previousHistoryId = account?.gmail_history_cursor_id || account?.gmail_watch_history_id || "";
  if (!account || !previousHistoryId) {
    return { mode: "fallback", messageIds: [], previousHistoryId, nextHistoryId, reason: "missing_previous_history_id" };
  }

  const session = await createIrisGmailSession();
  const ids = new Set<string>();
  let pageToken = "";
  try {
    do {
      const listed = await session.gmail.users.history.list({
        userId: "me",
        startHistoryId: previousHistoryId,
        historyTypes: ["messageAdded"],
        labelId: "INBOX",
        pageToken: pageToken || undefined,
      });
      for (const item of listed.data.history || []) {
        for (const added of item.messagesAdded || []) {
          const id = added.message?.id;
          if (id) ids.add(id);
        }
      }
      pageToken = listed.data.nextPageToken || "";
    } while (pageToken && ids.size < 25);
  } catch (error) {
    const code = gmailHistoryErrorCode(error);
    const message = gmailHistoryErrorMessage(error);
    return {
      mode: "fallback",
      messageIds: [],
      previousHistoryId,
      nextHistoryId,
      reason: code === 404 ? "history_id_too_old" : message.slice(0, 120),
    };
  }

  return {
    mode: "history",
    messageIds: [...ids].slice(0, 25),
    previousHistoryId,
    nextHistoryId,
  };
}

async function updateStoredHistoryId(nextHistoryId: string): Promise<void> {
  if (!databaseEnabled() || !nextHistoryId) return;
  const account = await readDefaultEmailAccountFromDatabase();
  if (!account) return;
  await updateEmailAccountGmailHistoryCursorInDatabase({
    clientId: account.client_id,
    email: account.email,
    historyId: nextHistoryId,
  });
}

export const gmailPushReceived = inngest.createFunction(
  {
    id: "gmail-push-received",
    name: "Process Gmail Pub/Sub push",
    triggers: [{ event: "gmail.push.received" }],
    retries: 3,
  },
  async ({ event, step }) => {
    const input = event.data as GmailPushReceivedEvent;
    if (!input.historyId) return { ok: false, error: "missing_history_id" };

    const settings = await step.run("load inbox settings", async () => {
      return databaseEnabled() ? await readInboxSettingsFromDatabase() : undefined;
    });

    if (settings && !channelEnabled(settings, "email")) {
      return { ok: true, skipped: "email_channel_disabled", historyId: input.historyId };
    }

    const emailLive = process.env.IRIS_EMAIL_LIVE === "true";
    const sendReplies = !settings || shouldAutoSendForChannel(settings, "email");
    const pollOptions: IrisEmailPollOptions = {
      dryRun: !emailLive,
      sendReplies: process.env.IRIS_EMAIL_SEND_REPLIES === "true" && emailLive && sendReplies,
      limit: 10,
    };

    const historyTarget = await step.run("resolve Gmail history target", async () => {
      return messageIdsFromGmailHistory(input.historyId);
    });

    const result = await step.run("process Gmail messages", async () => {
      if (historyTarget.mode === "history") {
        if (!historyTarget.messageIds.length) {
          return { ok: true, dryRun: pollOptions.dryRun, processed: 0, recorded: 0, labeled: 0, sent: 0, results: [] };
        }
        return processIrisEmailMessageIds(historyTarget.messageIds, pollOptions);
      }
      return processIrisEmailPoll(pollOptions);
    });

    await step.run("advance Gmail history marker", async () => {
      await updateStoredHistoryId(input.historyId);
      return { historyId: input.historyId };
    });

    return {
      ok: true,
      historyId: input.historyId,
      emailAddress: input.emailAddress || "",
      mode: historyTarget.mode,
      previousHistoryId: historyTarget.previousHistoryId,
      messageIds: historyTarget.messageIds,
      fallbackReason: historyTarget.reason || "",
      dryRun: pollOptions.dryRun,
      sendReplies: pollOptions.sendReplies,
      processed: result.processed,
      recorded: result.recorded,
      sent: result.sent,
    };
  },
);
