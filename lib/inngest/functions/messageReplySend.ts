import {
  hasNewerInboundForThreadInDatabase,
  incrementReplyJobAttemptInDatabase,
  readInboxSettingsFromDatabase,
  readReplyJobByDedupeKeyFromDatabase,
  upsertReplyJobInDatabase,
} from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import { sendManualReply, type ManualReplyInput } from "@/lib/manualReply";
import { recordChannelInteraction } from "@/lib/channelIngest";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { planAgentAction } from "@/lib/agentActions";
import { agentActionForReplyJob, IRIS_REPLY_SEND_RETRIES, requireSuccessfulReplySend } from "@/lib/irisReplyDelivery";
import { claimProviderAction, completeProviderAction } from "@/lib/providerSendSafety";
import { DEFAULT_INBOX_SETTINGS } from "@/lib/inboxSettings";

export const messageReplySend = inngest.createFunction(
  {
    id: "message-reply-send",
    name: "Send omnichannel reply",
    retries: IRIS_REPLY_SEND_RETRIES,
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

    const action = agentActionForReplyJob(job);
    const settings = await readInboxSettingsFromDatabase().catch(() => DEFAULT_INBOX_SETTINGS);
    const guard = planAgentAction(action, settings);
    if (!guard.allowed) {
      await upsertReplyJobInDatabase({
        dedupeKey, channel: job.channel, provider: job.provider, threadRef: job.threadRef,
        contactRef: job.contactRef, status: guard.safeFallback === "draft" ? "send_blocked" : "needs_human",
        error: guard.reason, nextAction: guard.safeFallback === "draft" ? "review_send" : "human_review",
        metadata: { guardCode: guard.code },
      });
      return { ok: true, skipped: guard.code };
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

    const sent = await step.run("send through channel adapter", async () => {
      await incrementReplyJobAttemptInDatabase(dedupeKey);
      const safety = await claimProviderAction({
        requestId: `reply-job:${job.id}`,
        idempotencyKey: `reply-job:${job.id}`,
        action: "iris_reply_send",
        channel: job.channel,
        target: job.contactRef || "",
        threadRef: job.threadRef,
        payload: { body: job.replyText || "", mediaUrls: action.mediaUrls || [] },
      });
      if (!safety.ok) {
        if (safety.replay) return { ok: true as const };
        await upsertReplyJobInDatabase({
          dedupeKey, channel: job.channel, provider: job.provider, threadRef: job.threadRef,
          contactRef: job.contactRef, status: "send_failed", error: safety.error, nextAction: "retry_send",
        });
        throw new Error(`Iris ${job.channel} send blocked: ${safety.error}`);
      }
      const result = await sendManualReply({
        channel: job.channel as ManualReplyInput["channel"],
        to: job.contactRef || "",
        body: job.replyText || "",
        mediaUrls: action.mediaUrls,
        threadId: job.threadRef,
        subject: "Re: Your real estate request",
      });
      if (!result.ok) {
        await completeProviderAction(safety.key, false, result as unknown as Record<string, unknown>, result.error);
        await upsertReplyJobInDatabase({
          dedupeKey, channel: job.channel, provider: job.provider, threadRef: job.threadRef,
          contactRef: job.contactRef, status: "send_failed", error: result.error, nextAction: "retry_send",
        });
        requireSuccessfulReplySend(result, job.channel);
      }
      await completeProviderAction(safety.key, true, result as unknown as Record<string, unknown>);
      return result;
    });

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
