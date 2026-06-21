import { cron } from "inngest";

import { databaseEnabled, readInboxSettingsFromDatabase } from "@/lib/database";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";
import { inngest } from "@/lib/inngest/client";
import { processIrisEmailPoll, type IrisEmailPollResult } from "@/lib/irisEmail";
import { irisEmailCronDryRun, irisEmailCronSendReplies } from "@/lib/irisEmailCron";

type IrisEmailMinutePollResult =
  | IrisEmailPollResult
  | {
    ok: true;
    skipped: true;
    channel: "email";
    reason: string;
    dryRun: boolean;
  };

function pollLimit(): number {
  const parsed = Number(process.env.IRIS_EMAIL_INGGEST_LIMIT || process.env.IRIS_EMAIL_CRON_LIMIT || "10");
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(Math.round(parsed), 50));
}

export const irisEmailMinutePoll = inngest.createFunction(
  {
    id: "iris-email-minute-poll",
    name: "Iris email 1-minute poll",
    triggers: [cron("* * * * *")],
    concurrency: { limit: 1 },
  },
  async ({ step }): Promise<IrisEmailMinutePollResult> => {
    const params = new URLSearchParams();
    const dryRun = irisEmailCronDryRun(params);

    const settings = await step.run("load email inbox settings", async () => {
      return databaseEnabled() ? await readInboxSettingsFromDatabase() : null;
    });

    if (settings && !channelEnabled(settings, "email")) {
      return {
        ok: true,
        skipped: true,
        channel: "email",
        reason: "Email channel disabled in inbox settings.",
        dryRun,
      };
    }

    const sendReplies = await step.run("resolve email auto-send policy", async () => {
      return irisEmailCronSendReplies(
        params,
        !settings || shouldAutoSendForChannel(settings, "email"),
      );
    });

    return await step.run("poll Gmail and process Iris replies", async () => {
      return processIrisEmailPoll({
        dryRun,
        sendReplies,
        limit: pollLimit(),
      });
    });
  },
);
