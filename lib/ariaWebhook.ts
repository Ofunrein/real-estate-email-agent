// Shared Aria webhook logic, kept out of the Next route files so it is
// unit-testable with plain payloads and injected deps (no NextRequest, DB, or
// network). Both /api/webhooks/aria-voice and /api/webhooks/aria-tools/[tool]
// delegate here.

import { recordChannelInteraction, type ChannelIngestInput } from "@/lib/channelIngest";
import { upsertVoiceCallToDatabase, type VoiceCallRecord } from "@/lib/database";
import { runAriaTool } from "@/lib/ariaTools";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { clientConfig } from "@/lib/clientConfig";
import { notifyAgent, type NotifyEvent } from "@/lib/notify";
import {
  formatToolResults,
  parseCallMeta,
  parseEndOfCallReport,
  parseToolCalls,
} from "@/lib/vapi";

// Map a tool's ai_action to an agent-notification type (or "" to skip).
function notifyTypeForAction(action: string): string {
  switch (action) {
    case "showing_booked":
      return "showing_booked";
    case "showing_cancelled":
      return "showing_cancelled";
    case "showing_rescheduled":
      return "showing_rescheduled";
    case "lead_qualified":
      return "lead_qualified";
    default:
      return "";
  }
}

function timezone(): string {
  return process.env.CALENDAR_TIMEZONE || "America/Chicago";
}

function clockContext(nowMs: number): { localHour: number; dayKey: string } {
  const tz = timezone();
  let localHour = new Date(nowMs).getUTCHours();
  let dayKey = new Date(nowMs).toISOString().slice(0, 10);
  try {
    localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date(nowMs)));
    dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  } catch {
    // fall back to UTC computed above
  }
  return { localHour, dayKey };
}

export type ToolCallDeps = {
  runTool: typeof runAriaTool;
  record: (input: ChannelIngestInput) => Promise<unknown>;
  notify: (event: NotifyEvent, ctx: { localHour: number; dayKey: string; recentKeys: Set<string> }) => Promise<unknown>;
};

const defaultToolDeps: ToolCallDeps = {
  runTool: runAriaTool,
  record: recordChannelInteraction,
  notify: (event, ctx) => notifyAgent(event, clientConfig().notify, ctx),
};

// Dispatch every tool call in the payload, persist one event each, and return
// the Vapi response body `{ results: [{ toolCallId, result }] }`.
export async function handleAriaToolCalls(
  payload: Record<string, unknown>,
  deps: ToolCallDeps = defaultToolDeps,
): Promise<{ results: Array<{ toolCallId: string; result: string }> }> {
  const meta = parseCallMeta(payload);
  const calls = parseToolCalls(payload);
  const results: Array<{ id: string; result: string }> = [];
  const clock = clockContext(Date.now());
  const recentKeys = new Set<string>();

  for (const call of calls) {
    const outcome = await deps.runTool(call.name, call.args, {
      phone: meta.phone,
      callId: meta.callId,
      threadRef: meta.threadRef,
    });
    await deps.record(outcome.ingest).catch(() => undefined);

    const notifyType = notifyTypeForAction(outcome.ingest.aiAction || "");
    if (notifyType) {
      await deps
        .notify(
          {
            type: notifyType,
            leadName: outcome.ingest.fullName,
            leadPhone: meta.phone,
            summary: outcome.ingest.summary,
            threadRef: meta.threadRef,
          },
          { ...clock, recentKeys },
        )
        .catch(() => undefined);
    }

    results.push({ id: call.id, result: outcome.result });
  }

  return formatToolResults(results);
}

export type EndOfCallDeps = {
  upsertCall: (call: VoiceCallRecord) => Promise<void>;
  record: (input: ChannelIngestInput) => Promise<unknown>;
  notify: (event: NotifyEvent, ctx: { localHour: number; dayKey: string }) => Promise<unknown>;
};

const defaultEndDeps: EndOfCallDeps = {
  upsertCall: upsertVoiceCallToDatabase,
  record: recordChannelInteraction,
  notify: (event, ctx) => notifyAgent(event, clientConfig().notify, ctx),
};

function wasTransferred(endedReason: string): boolean {
  return /forward|transfer/i.test(endedReason || "");
}

// Persist the final call record (voice_calls) plus a conversation event.
export async function handleAriaEndOfCall(
  payload: Record<string, unknown>,
  deps: EndOfCallDeps = defaultEndDeps,
): Promise<VoiceCallRecord> {
  const report = parseEndOfCallReport(payload);
  const threadRef = `voice:${report.callId}`;

  const call: VoiceCallRecord = {
    call_id: report.callId,
    thread_ref: threadRef,
    direction: "inbound",
    phone: report.phone,
    started_at: report.startedAt,
    ended_at: report.endedAt,
    duration_sec: report.durationSec,
    disposition: report.endedReason,
    ended_reason: report.endedReason,
    summary: report.summary,
    transcript: report.transcript,
    recording_url: report.recordingUrl,
  };

  await deps.upsertCall(call);
  await deps
    .record({
      channel: "voice",
      direction: "inbound",
      agentName: IRIS_AGENT_NAME,
      phone: report.phone,
      source: "vapi",
      threadRef,
      eventType: "voice_call_completed",
      messageText: report.transcript,
      summary: report.summary || "Voice call completed.",
      transcriptUrl: "",
      recordingUrl: report.recordingUrl,
      aiAction: "call_completed",
      nextAction: "review_call_summary",
      status: "received",
    })
    .catch(() => undefined);

  if (wasTransferred(report.endedReason)) {
    await deps
      .notify(
        {
          type: "transfer_to_human",
          leadPhone: report.phone,
          summary: report.summary || "Live call transferred to a human.",
          reason: report.endedReason,
          threadRef,
        },
        clockContext(Date.now()),
      )
      .catch(() => undefined);
  }

  return call;
}
