import { inngest } from "@/lib/inngest/client";
import { renewDueGmailWatches } from "@/lib/gmailWatchRenewal";

export const gmailWatchRenewal = inngest.createFunction(
  {
    id: "gmail-watch-renewal",
    name: "Renew Gmail Pub/Sub watches",
    triggers: [{ cron: "0 8 * * *" }],
  },
  async ({ step }) => {
    const result = await step.run("renew due Gmail watches", async () => {
      return renewDueGmailWatches({
        renewWithinHours: 48,
        limit: 100,
      });
    });

    return result;
  },
);
