// Outbound voice calls + followup-queue selection.
//
// selectVoiceFollowups() runs the shared cadence over each lead's cross-channel
// history and returns only the leads that are due for a VOICE touch right now
// (action=send, channel=voice) — i.e. consent + call-window + pacing already
// satisfied by nextTouch(). The followup script and /api/aria/outbound use it.
//
// placeOutboundCall() asks Vapi to dial a lead with Aria's assistant. The HTTP
// layer is injected so it is unit-testable.

import { nextTouch, type TouchDecision } from "@/lib/cadence";
import type { CadenceConfig } from "@/lib/clientConfig";
import type { SheetRow } from "@/lib/sheetSchema";
import { sendTheoSms } from "@/lib/twilioSms";

const VAPI_BASE = "https://api.vapi.ai";

export type OutboundConfig = {
  apiKey: string;
  assistantId: string;
  phoneNumberId: string;
  apiBase?: string;
};

export type OutboundRequest = (body: Record<string, unknown>) => Promise<{ ok: boolean; id?: string; error?: string }>;
export type OutboundSmsSender = (to: string, body: string) => Promise<unknown>;

function realRequest(config: OutboundConfig): OutboundRequest {
  const base = config.apiBase || VAPI_BASE;
  return async (body) => {
    const response = await fetch(`${base}/call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return { ok: false, error: String(payload.message || response.statusText) };
    }
    return { ok: true, id: String(payload.id || "") };
  };
}

// Ask Vapi to place an outbound call to the customer with Aria's assistant.
export async function placeOutboundCall(
  config: OutboundConfig,
  input: { customerNumber: string },
  request?: OutboundRequest,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!config.apiKey || !config.assistantId || !config.phoneNumberId) {
    return { ok: false, error: "Missing VAPI_API_KEY, VAPI_ASSISTANT_ID, or VAPI_PHONE_NUMBER_ID" };
  }
  if (!input.customerNumber) return { ok: false, error: "Missing customer number" };
  const send = request || realRequest(config);
  return send({
    assistantId: config.assistantId,
    phoneNumberId: config.phoneNumberId,
    customer: { number: input.customerNumber },
  });
}

export function outboundAttemptSmsBody(input: { agentName?: string; companyName?: string; callbackNumber?: string; context?: string } = {}): string {
  const agentName = input.agentName || process.env.AGENT_NAME_VOICE || "Aria";
  const companyName = input.companyName || process.env.CLIENT_NAME || "Austin Realty";
  const callbackNumber = input.callbackNumber || process.env.ARIA_CALLBACK_NUMBER || process.env.TWILIO_FROM || "";
  const context = input.context?.trim();
  return [
    `Hi, this is ${agentName} with ${companyName}. I just tried reaching you by phone.`,
    context ? `I was calling about ${context}.` : "I was calling about your real estate request.",
    callbackNumber ? `You can call or text back here, or reach us at ${callbackNumber}.` : "You can reply here whenever it is easier.",
  ].join(" ");
}

export async function sendOutboundAttemptSms(
  to: string,
  input: { agentName?: string; companyName?: string; callbackNumber?: string; context?: string } = {},
  sender: OutboundSmsSender = sendTheoSms,
): Promise<{ ok: boolean; error?: string }> {
  if (!to) return { ok: false, error: "Missing SMS recipient" };
  const result = await sender(to, outboundAttemptSmsBody(input));
  const maybe = result as { sent?: boolean; skipped?: boolean; error?: string } | undefined;
  if (maybe && maybe.sent === false) return { ok: false, error: maybe.error || "SMS not sent" };
  return { ok: true };
}

export type LeadWithEvents = { lead: SheetRow; events: SheetRow[] };

export type FollowupCandidate = {
  lead: SheetRow;
  decision: TouchDecision;
};

// Every lead's cadence decision (for visibility/logging).
export function evaluateFollowups(
  leads: LeadWithEvents[],
  config: CadenceConfig,
  nowMs: number,
  timezone?: string,
): FollowupCandidate[] {
  return leads.map(({ lead, events }) => ({
    lead,
    decision: nextTouch({ lead, events, config, nowMs, timezone }),
  }));
}

// Only the leads due for a voice call right now.
export function selectVoiceFollowups(
  leads: LeadWithEvents[],
  config: CadenceConfig,
  nowMs: number,
  timezone?: string,
): FollowupCandidate[] {
  return evaluateFollowups(leads, config, nowMs, timezone).filter(
    (candidate) => candidate.decision.action === "send" && candidate.decision.channel === "voice" && Boolean(candidate.lead.phone),
  );
}
