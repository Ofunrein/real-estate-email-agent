import {
  databaseEnabled,
  readInboxSettingsFromDatabase,
} from "@/lib/database";
import { processIrisEmailPoll, type IrisEmailPollOptions } from "@/lib/irisEmail";
import { inngest } from "@/lib/inngest/client";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";

export type GmailPushReceivedEvent = {
  historyId: string;
  emailAddress?: string;
  pubSubMessageId?: string;
  receivedAt?: string;
};

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

    const result = await step.run("process unread Gmail", async () => {
      return processIrisEmailPoll(pollOptions);
    });

    return {
      ok: true,
      historyId: input.historyId,
      emailAddress: input.emailAddress || "",
      dryRun: pollOptions.dryRun,
      sendReplies: pollOptions.sendReplies,
      processed: result.processed,
      recorded: result.recorded,
      sent: result.sent,
    };
  },
);
