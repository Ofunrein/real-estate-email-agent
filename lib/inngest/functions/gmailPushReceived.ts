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
  type IrisEmailPollResult,
  type IrisEmailPollOptions,
} from "@/lib/irisEmail";
import { inngest } from "@/lib/inngest/client";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";
import { writeRequestAuditEvent } from "@/lib/requestAudit";

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

function mergePollResults(primary: IrisEmailPollResult, backlog?: IrisEmailPollResult): IrisEmailPollResult {
  if (!backlog) return primary;
  return {
    ok: true,
    dryRun: primary.dryRun || backlog.dryRun,
    processed: primary.processed + backlog.processed,
    recorded: primary.recorded + backlog.recorded,
    labeled: primary.labeled + backlog.labeled,
    sent: primary.sent + backlog.sent,
    results: [...primary.results, ...backlog.results],
  };
}

function workerOutcome(result: IrisEmailPollResult, dryRun: boolean): string {
  if (dryRun) return "skipped";
  if (result.sent > 0) return "sent";
  if (result.recorded > 0 || result.labeled > 0) return "received";
  if (result.processed > 0) return "skipped";
  return "skipped";
}

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
    const auditBase = {
      requestId: input.pubSubMessageId || `gmail-history:${input.historyId}`,
      route: "inngest:gmail-push-received",
      method: "EVENT",
      channel: "email",
      provider: "inngest",
      contactRef: input.emailAddress || "",
      providerMessageId: input.pubSubMessageId || input.historyId,
    };

    const settings = await step.run("load inbox settings", async () => {
      return databaseEnabled() ? await readInboxSettingsFromDatabase() : undefined;
    });

    if (settings && !channelEnabled(settings, "email")) {
      await step.run("audit email channel disabled", async () => {
        await writeRequestAuditEvent({
          ...auditBase,
          stage: "settings",
          outcome: "blocked",
          errorCode: "email_channel_disabled",
          metadata: { historyId: input.historyId },
        });
      });
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
          // Gmail History can occasionally advance without returning messageAdded
          // rows for the filtered history window. Do not silently skip; scan the
          // unread inbox before advancing the cursor.
          return processIrisEmailPoll(pollOptions);
        }
        const targeted = await processIrisEmailMessageIds(historyTarget.messageIds, pollOptions);
        const unreadBacklog = await processIrisEmailPoll({ ...pollOptions, limit: 10 });
        return mergePollResults(targeted, unreadBacklog);
      }
      return processIrisEmailPoll(pollOptions);
    }).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      await step.run("audit Gmail push failed", async () => {
        await writeRequestAuditEvent({
          ...auditBase,
          stage: "process",
          outcome: "failed",
          errorCode: "gmail_push_process_failed",
          errorMessage: message,
          metadata: {
            historyId: input.historyId,
            mode: historyTarget.mode,
            previousHistoryId: historyTarget.previousHistoryId,
            messageIds: historyTarget.messageIds,
            fallbackReason: historyTarget.reason || "",
            dryRun: pollOptions.dryRun,
            sendReplies: pollOptions.sendReplies,
          },
        });
      });
      throw error;
    });

    await step.run("advance Gmail history marker", async () => {
      if (pollOptions.dryRun) {
        await writeRequestAuditEvent({
          ...auditBase,
          stage: "cursor",
          outcome: "skipped",
          errorCode: "dry_run_cursor_not_advanced",
          metadata: { historyId: input.historyId },
        });
        return { skipped: "dry_run_does_not_advance_gmail_cursor", historyId: input.historyId };
      }
      await updateStoredHistoryId(input.historyId);
      return { historyId: input.historyId };
    });

    await step.run("audit Gmail push processed", async () => {
      await writeRequestAuditEvent({
        ...auditBase,
        stage: "process",
        outcome: workerOutcome(result, Boolean(pollOptions.dryRun)),
        metadata: {
          historyId: input.historyId,
          mode: historyTarget.mode,
          previousHistoryId: historyTarget.previousHistoryId,
          messageIds: historyTarget.messageIds,
          fallbackReason: historyTarget.reason || "",
          dryRun: pollOptions.dryRun,
          sendReplies: pollOptions.sendReplies,
          processed: result.processed,
          recorded: result.recorded,
          labeled: result.labeled,
          sent: result.sent,
          resultMessageIds: result.results.map((item) => item.messageId).slice(0, 25),
          skippedDuplicates: result.results.filter((item) => item.skippedDuplicate).length,
        },
      });
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
