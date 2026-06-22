import { cron } from "inngest";

import { inngest } from "@/lib/inngest/client";
import { pollComposioSocial, type ComposioSocialPollResult } from "@/lib/composioSocialPoll";

function socialPollUserEmail(): string {
  return (
    process.env.DASHBOARD_ADMIN_EMAIL ||
    process.env.COMPOSIO_INSTAGRAM_USER_EMAIL ||
    process.env.COMPOSIO_FACEBOOK_USER_EMAIL ||
    "ofunrein123@gmail.com"
  );
}

function socialPollLimit(): number {
  const parsed = Number(process.env.COMPOSIO_SOCIAL_INNGEST_LIMIT || process.env.COMPOSIO_SOCIAL_POLL_LIMIT || "25");
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(Math.round(parsed), 50));
}

function socialPollLookbackMinutes(): number {
  const parsed = Number(process.env.COMPOSIO_SOCIAL_POLL_LOOKBACK_MINUTES || "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(Math.round(parsed), 60 * 24));
}

export const composioSocialMinutePoll = inngest.createFunction(
  {
    id: "composio-social-minute-poll",
    name: "Composio social 1-minute poll",
    triggers: [cron("* * * * *")],
    concurrency: { limit: 1 },
  },
  async ({ step }): Promise<ComposioSocialPollResult> => {
    return await step.run("poll Composio social DMs and process Iris replies", async () => {
      return pollComposioSocial({
        userEmail: socialPollUserEmail(),
        channels: ["instagram", "messenger"],
        limit: socialPollLimit(),
        sinceMinutes: socialPollLookbackMinutes(),
      });
    });
  },
);
