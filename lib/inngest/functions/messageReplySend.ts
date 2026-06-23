import {
  readReplyJobByDedupeKeyFromDatabase,
  upsertReplyJobInDatabase,
} from "@/lib/database";
import { inngest } from "@/lib/inngest/client";

export const messageReplySend = inngest.createFunction(
  {
    id: "message-reply-send",
    name: "Send omnichannel reply",
    triggers: [{ event: "message.reply.send" }],
  },
  async ({ event, step }) => {
    const dedupeKey = String(event.data?.dedupeKey || "").trim();
    if (!dedupeKey) return { ok: false, error: "missing_dedupe_key" };

    const job = await step.run("load reply job", async () => {
      return readReplyJobByDedupeKeyFromDatabase(dedupeKey);
    });
    if (!job) return { ok: false, error: "reply_job_not_found" };
    if (job.status === "sent") return { ok: true, skipped: "already_sent" };
    if (!String(job.replyText || "").trim() && !job.mediaJson?.length) {
      await step.run("mark send blocked", async () => {
        await upsertReplyJobInDatabase({
          dedupeKey,
          channel: job.channel,
          provider: job.provider,
          threadRef: job.threadRef,
          contactRef: job.contactRef,
          status: "send_blocked",
          error: "No generated reply body/media available.",
          nextAction: "human_review",
        });
      });
      return { ok: true, skipped: "missing_reply_body" };
    }

    return { ok: true, skipped: "channel_specific_sender_not_bound" };
  },
);
