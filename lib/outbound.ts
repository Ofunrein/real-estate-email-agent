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
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import type { CadenceConfig } from "@/lib/clientConfig";
import type { SheetRow } from "@/lib/sheetSchema";
import { sendTheoSms } from "@/lib/twilioSms";
import { requestWorkspaceId } from "@/lib/workspaceContext";
import { mayUseSharedEnvironmentConnections } from "@/lib/workspace";

const VAPI_BASE = "https://api.vapi.ai";

export type OutboundConfig = {
  apiKey: string;
  assistantId: string;
  phoneNumberId: string;
  apiBase?: string;
};

export type OutboundCallInput = {
  customerNumber: string;
  leadName?: string;
  leadEmail?: string;
  companyName?: string;
  agentName?: string;
  callReason?: string;
  leadContext?: string;
  preferredChannel?: string;
  clientId?: string;
  trigger?: string;
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

function clean(value?: string): string {
  return String(value || "").trim();
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length >= value.replace(/\s/g, "").length - 2;
}

function defaultVoiceCompanyName() {
  return process.env.ARIA_CLIENT_NAME || process.env.TEAM_NAME || process.env.CLIENT_NAME || "Austin Realty";
}

function outboundCallReason(input: OutboundCallInput): string {
  const reason = clean(input.callReason);
  if (reason && reason.length <= 120) return reason;
  return "your real estate request";
}

export function outboundFirstMessage(input: OutboundCallInput): string {
  const agentName = clean(input.agentName) || process.env.AGENT_NAME_VOICE || IRIS_AGENT_NAME;
  const companyName = clean(input.companyName) || defaultVoiceCompanyName();
  const callReason = outboundCallReason(input);
  const leadName = clean(input.leadName);
  if (leadName) {
    if (!looksLikePhone(leadName)) {
      return `Hi ${leadName}, this is ${agentName} with ${companyName}. I'm calling about ${callReason}. Do you have a quick minute?`;
    }
  }
  return `Hi, this is ${agentName} with ${companyName}. I'm calling about your real estate request. Do you have a quick minute?`;
}

function outboundCallBody(config: OutboundConfig, input: OutboundCallInput): Record<string, unknown> {
  const agentName = clean(input.agentName) || process.env.AGENT_NAME_VOICE || IRIS_AGENT_NAME;
  const companyName = clean(input.companyName) || defaultVoiceCompanyName();
  const callReason = outboundCallReason(input);
  const leadName = clean(input.leadName);
  const leadEmail = clean(input.leadEmail);
  const leadContext = clean(input.leadContext);
  const preferredChannel = clean(input.preferredChannel);
  const outboundFirstMessage = outboundFirstMessageForVariables(input);
  const customer: Record<string, unknown> = { number: input.customerNumber };
  if (leadName && !looksLikePhone(leadName)) customer.name = leadName;
  if (leadEmail) customer.email = leadEmail;

  return {
    assistantId: config.assistantId,
    phoneNumberId: config.phoneNumberId,
    customer,
    metadata: {
      direction: "outbound",
      trigger: clean(input.trigger) || "manual",
      clientId: clean(input.clientId) || process.env.CLIENT_ID || "default",
      leadPhone: input.customerNumber,
      leadEmail,
    },
    assistantOverrides: {
      firstMessageMode: "assistant-speaks-first",
      firstMessage: "{{outboundFirstMessage}}",
      variableValues: {
        outboundFirstMessage,
        leadName,
        clientName: companyName,
        agentName,
        callReason,
        leadContext,
        preferredChannel,
      },
    },
  };
}

function outboundFirstMessageForVariables(input: OutboundCallInput): string {
  return outboundFirstMessage(input);
}

// Ask Vapi to place an outbound call to the customer with Aria's assistant.
export async function placeOutboundCall(
  config: OutboundConfig,
  input: OutboundCallInput,
  request?: OutboundRequest,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!mayUseSharedEnvironmentConnections(requestWorkspaceId())) {
    return { ok: false, error: "Connect a workspace-specific Vapi account before placing calls" };
  }
  if (!config.apiKey || !config.assistantId || !config.phoneNumberId) {
    return { ok: false, error: "Missing VAPI_API_KEY, VAPI_ASSISTANT_ID, or VAPI_PHONE_NUMBER_ID" };
  }
  if (!input.customerNumber) return { ok: false, error: "Missing customer number" };
  const send = request || realRequest(config);
  return send(outboundCallBody(config, input));
}

export function outboundAttemptSmsBody(input: { agentName?: string; companyName?: string; callbackNumber?: string; context?: string } = {}): string {
  const agentName = input.agentName || process.env.AGENT_NAME_VOICE || IRIS_AGENT_NAME;
  const companyName = input.companyName || defaultVoiceCompanyName();
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
