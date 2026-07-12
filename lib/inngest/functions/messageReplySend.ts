import {
  hasNewerInboundForThreadInDatabase,
  readReplyJobByDedupeKeyFromDatabase,
  upsertReplyJobInDatabase,
} from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import { sendManualReply, type ManualReplyInput } from "@/lib/manualReply";
import { recordChannelInteraction } from "@/lib/channelIngest";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

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

    if (!["sms", "whatsapp", "email", "instagram", "messenger"].includes(job.channel)) {
      return { ok: true, skipped: "channel_requires_inline_response" };
    }

    const generatedAt = String(job.metadata?.generatedAt || job.updatedAt || "");
    if (generatedAt && await hasNewerInboundForThreadInDatabase(job.threadRef, generatedAt)) {
      await upsertReplyJobInDatabase({
        dedupeKey, channel: job.channel, provider: job.provider, threadRef: job.threadRef,
        contactRef: job.contactRef, status: "superseded", nextAction: "regenerate",
        metadata: { supersededReason: "newer_inbound_message" },
      });
      return { ok: true, skipped: "newer_inbound_message" };
    }

    const mediaUrls = (job.mediaJson || []).map((item) => {
      return item && typeof item === "object" ? String((item as Record<string, unknown>).url || "") : "";
    }).filter(Boolean);
    const sent = await step.run("send through channel adapter", async () => sendManualReply({
      channel: job.channel as ManualReplyInput["channel"],
      to: job.contactRef || "",
      body: job.replyText || "",
      mediaUrls,
      threadId: job.threadRef,
      subject: "Re: Your real estate request",
    }));
    if (!sent.ok) {
      await upsertReplyJobInDatabase({
        dedupeKey, channel: job.channel, provider: job.provider, threadRef: job.threadRef,
        contactRef: job.contactRef, status: "send_failed", error: sent.error, nextAction: "human_review",
      });
      return { ok: false, error: sent.error };
    }

    await step.run("persist outbound reply", async () => {
      await recordChannelInteraction({
        channel: job.channel as ManualReplyInput["channel"], direction: "outbound", agentName: IRIS_AGENT_NAME,
        phone: job.channel === "email" ? "" : job.contactRef, email: job.channel === "email" ? job.contactRef : "",
        source: job.provider || job.channel, threadRef: job.threadRef, eventType: `${job.channel}_ai_reply`,
        messageText: job.replyText, summary: `Iris ${job.channel} reply`, aiAction: "auto_send",
        status: "sent", providerMetadata: { replyJobId: job.id, contextFingerprint: job.metadata?.contextFingerprint || "" },
      });
      await upsertReplyJobInDatabase({
        dedupeKey, channel: job.channel, provider: job.provider, threadRef: job.threadRef,
        contactRef: job.contactRef, status: "sent", nextAction: "await_reply",
        metadata: { deliveredAt: new Date().toISOString() },
      });
    });

    return { ok: true, status: "sent" };
  },
);
