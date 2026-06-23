import {
  readReplyJobByDedupeKeyFromDatabase,
  upsertReplyJobInDatabase,
} from "@/lib/database";
import { inngest } from "@/lib/inngest/client";

export const messageReplyGenerate = inngest.createFunction(
  {
    id: "message-reply-generate",
    name: "Generate omnichannel reply",
    triggers: [{ event: "message.reply.generate" }],
  },
  async ({ event, step }) => {
    const dedupeKey = String(event.data?.dedupeKey || "").trim();
    if (!dedupeKey) return { ok: false, error: "missing_dedupe_key" };

    const job = await step.run("load reply job", async () => {
      return readReplyJobByDedupeKeyFromDatabase(dedupeKey);
    });
    if (!job) return { ok: false, error: "reply_job_not_found" };
    if (job.status === "sent") return { ok: true, skipped: "already_sent" };
    if (job.status === "duplicate_suppressed") return { ok: true, skipped: "duplicate_suppressed" };

    await step.run("mark generation delegated", async () => {
      await upsertReplyJobInDatabase({
        dedupeKey,
        channel: job.channel,
        provider: job.provider,
        threadRef: job.threadRef,
        contactRef: job.contactRef,
        status: "generation_delegated",
        modelClassify: "claude-3-5-haiku",
        modelReply: "claude-sonnet-4-6",
        nextAction: "channel_pipeline",
        metadata: { note: "Channel pollers/webhooks run the existing property-aware reply engine until all ingress is moved here." },
      });
    });

    return { ok: true, status: "generation_delegated" };
  },
);
