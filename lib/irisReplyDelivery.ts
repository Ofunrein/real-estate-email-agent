import type { AgentActionInput, AgentActionKind } from "@/lib/agentActions";
import type { ReplyJobRecord } from "@/lib/database";
import type { ManualReplyResult } from "@/lib/manualReply";

const REPLAYABLE_STATUSES = new Set(["send_failed"]);
export const IRIS_REPLY_SEND_RETRIES = 4;

export function isReplyJobReplayable(status: string): boolean {
  return REPLAYABLE_STATUSES.has(status);
}

export function requireSuccessfulReplySend(result: ManualReplyResult, channel: string): asserts result is Extract<ManualReplyResult, { ok: true }> {
  if (!result.ok) throw new Error(`Iris ${channel} send failed: ${result.error}`);
}

function actionForChannel(channel: string): AgentActionKind {
  if (channel === "email") return "send_email";
  if (channel === "instagram" || channel === "messenger") return "send_social_dm";
  return "send_text";
}

export function agentActionForReplyJob(job: ReplyJobRecord): AgentActionInput {
  const lead = job.metadata?.lead && typeof job.metadata.lead === "object"
    ? job.metadata.lead as Record<string, unknown>
    : {};
  return {
    action: actionForChannel(job.channel),
    actorAgent: "Iris",
    channel: job.channel as AgentActionInput["channel"],
    to: job.contactRef,
    body: job.replyText,
    mediaUrls: (job.mediaJson || []).map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).url || "") : "").filter(Boolean),
    threadRef: job.threadRef,
    lead: {
      fullName: String(lead.fullName || ""),
      phone: String(lead.phone || (job.channel === "email" ? "" : job.contactRef)),
      email: String(lead.email || (job.channel === "email" ? job.contactRef : "")),
      preferredChannel: String(lead.preferredChannel || job.channel),
      smsConsent: String(lead.smsConsent || ""),
    },
    context: {
      captured: true,
      trigger: "inbound_message",
      reason: String(job.metadata?.reason || "Iris generated reply"),
    },
    source: "iris_reply_pipeline",
  };
}
