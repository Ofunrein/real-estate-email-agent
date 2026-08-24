import {
  findLeadInDatabase,
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
import { runInRequestWorkspace, setRequestWorkspace } from "@/lib/workspaceContext";
import { channelSuppression, type SuppressibleChannel } from "@/lib/contactSuppression";
import { checkUsageCap } from "@/lib/usageCaps";
import { writeRequestAuditEvent } from "@/lib/requestAudit";

export const messageReplySend = inngest.createFunction(
  {
    id: "message-reply-send",
    name: "Send omnichannel reply",
    retries: IRIS_REPLY_SEND_RETRIES,
    triggers: [{ event: "message.reply.send" }],
  },
  async ({ event, step }) => {
    const eventClientId = String(event.data?.clientId || "").trim();
    return runInRequestWorkspace(eventClientId, async () => {
    const dedupeKey = String(event.data?.dedupeKey || "").trim();
    if (!dedupeKey) return { ok: false, error: "missing_dedupe_key" };

    const job = await step.run("load reply job", async () => {
      if (eventClientId) setRequestWorkspace(eventClientId);
      return readReplyJobByDedupeKeyFromDatabase(dedupeKey);
    });
    if (!job) return { ok: false, error: "reply_job_not_found" };
    if (job.status === "sent") return { ok: true, skipped: "already_sent" };
    if (!String(job.replyText || "").trim() && !job.mediaJson?.length) {
      await step.run("mark send blocked", async () => {
        if (eventClientId) setRequestWorkspace(eventClientId);
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

    // Suppression is read from the STORED lead, never from job metadata. The
    // webhooks that queue these jobs attach smsConsent:"inbound_text", which
    // no opted-out pattern can ever match — so trusting metadata meant a lead
    // who texted STOP still got the next automated reply.
    const suppression = await step.run("check contact suppression", async () => {
      if (eventClientId) setRequestWorkspace(eventClientId);
      const lead = await findLeadInDatabase(
        job.channel === "email" ? { email: job.contactRef } : { phone: job.contactRef },
      ).catch(() => null);
      return channelSuppression(lead ?? undefined, job.channel as SuppressibleChannel);
    });
    if (suppression.suppressed) {
      await step.run("mark send suppressed", async () => {
        if (eventClientId) setRequestWorkspace(eventClientId);
        await upsertReplyJobInDatabase({
          dedupeKey, channel: job.channel, provider: job.provider, threadRef: job.threadRef,
          contactRef: job.contactRef, status: "needs_human", error: suppression.reason,
          nextAction: "human_review", metadata: { guardCode: suppression.code },
        });
      });
      return { ok: true, skipped: suppression.code };
    }

    // Spend circuit breaker. Parks the job for a human rather than dropping it,
    // so nothing is lost when a cap trips.
    const cap = await step.run("check client usage cap", async () => {
      if (eventClientId) setRequestWorkspace(eventClientId);
      return checkUsageCap(job.channel === "sms" || job.channel === "whatsapp" ? "sms" : "ai");
    });
    if (!cap.allowed) {
      await step.run("mark send over cap", async () => {
        if (eventClientId) setRequestWorkspace(eventClientId);
        await upsertReplyJobInDatabase({
          dedupeKey, channel: job.channel, provider: job.provider, threadRef: job.threadRef,
          contactRef: job.contactRef, status: "needs_human", error: cap.reason,
          nextAction: "human_review", metadata: { guardCode: cap.code, used: cap.used, limit: cap.limit },
        });
      });
      return { ok: true, skipped: cap.code };
    }

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
      if (eventClientId) setRequestWorkspace(eventClientId);
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
      if (eventClientId) setRequestWorkspace(eventClientId);
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
      // The audit row is what usage caps count. Without it the SMS and voice
      // caps read zero forever and can never trip, no matter the volume.
      await writeRequestAuditEvent({
        requestId: `reply-job:${job.id}`,
        route: "inngest:message-reply-send",
        method: "EVENT",
        channel: job.channel,
        provider: job.provider || job.channel,
        threadRef: job.threadRef,
        contactRef: job.contactRef,
        stage: "send",
        outcome: "sent",
      });
    });

    return { ok: true, status: "sent" };
    });
  },
);
