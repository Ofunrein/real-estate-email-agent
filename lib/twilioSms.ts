import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { mediaProxyUrl } from "@/lib/mediaProxy";
import { finalizeOutboundTextBody, finalizeOutboundTextWithMedia } from "@/lib/smsFormatting";
import { requestWorkspaceId } from "@/lib/workspaceContext";
import { mayUseSharedEnvironmentConnections } from "@/lib/workspace";

export type TwilioSendResult = {
  sent: boolean;
  skipped: boolean;
  sid: string;
  error: string;
  mediaCount: number;
};

function envFlag(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function smsAgentEnabled(): boolean {
  return envFlag(process.env.ENABLE_SMS_AGENT);
}

function missingConfig(): string {
  const missing = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"].filter((key) => !process.env[key]);
  return missing.join(", ");
}

/**
 * Where Twilio reports delivery state. Without it a send is recorded as "sent"
 * the moment Twilio returns a SID, so carrier rejections — including 21610,
 * Twilio's own "recipient has opted out" — are never observed.
 */
export function twilioStatusCallbackUrl(): string {
  const base = (process.env.TWILIO_WEBHOOK_BASE_URL || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) return "";
  const secret = (process.env.CHANNEL_WEBHOOK_SECRET || "").trim();
  try {
    const url = new URL("/api/webhooks/twilio-status", base);
    // The route verifies the Twilio signature; the secret only matches the
    // existing webhook convention and is not what authenticates the caller.
    if (secret) url.searchParams.set("secret", secret);
    return url.toString();
  } catch {
    return "";
  }
}

function smsRecipientAddress(value: string): string {
  return value.replace(/^(?:rcs|sms):/i, "").trim();
}

function recipientDigits(value: string): string {
  return smsRecipientAddress(value).replace(/\D/g, "");
}

export function isUnsafeSmsRecipient(value: string): boolean {
  const digits = recipientDigits(value);
  if (!digits) return true;
  if (digits.length < 8 || digits.length > 15) return true;
  if (/^0+$/.test(digits)) return true;
  // NANP 555 numbers are reserved or test-like. Never let smoke tests hit Twilio.
  if (digits.length === 11 && digits.startsWith("1") && digits.slice(4, 7) === "555") return true;
  if (digits.length === 10 && digits.slice(3, 6) === "555") return true;
  if (digits.startsWith("1555")) return true;
  return false;
}

function cleanMediaUrls(mediaUrls: string[] = []): string[] {
  return mediaUrls
    .map((url) => url.trim())
    .filter((url) => /^https:\/\//i.test(url))
    .map((url) => mediaProxyUrl(url))
    .slice(0, Math.max(0, Number(process.env.SMS_MAX_IMAGES || "3")));
}


export function smsMessageWithMediaLog(body: string, mediaUrls: string[] = []): string {
  // Media URLs are paragraphs too. "MMS image: https://…" put a label on the URL's own line,
  // and this text is what the dashboard renders for the outbound event.
  return finalizeOutboundTextWithMedia(body, cleanMediaUrls(mediaUrls));
}

/**
 * The LAST thing that touches an outbound SMS body before it is serialized into the Twilio
 * form POST. Every reply generator already normalizes, but this is the transport boundary and
 * it must not depend on that: any caller, including a future LLM path, ships through here.
 *
 * Martin's screenshots of the live thread showed exactly what happens without it - a whole
 * listing roundup arriving as one run-on paragraph with the next numbered listing starting
 * immediately after `/zpid/`.
 *
 * Delegates to the shared cross-channel finalizer so SMS cannot drift away from WhatsApp,
 * social DMs and website chat, and so no tenant gets its own spacing.
 */
export function finalizeOutboundSmsBody(body: string): string {
  return finalizeOutboundTextBody(body);
}

/**
 * Suppression at the transport boundary.
 *
 * Enforcing this only in messageReplySend left every other automated sender
 * unguarded — speed-to-lead from Meta lead forms, the Olivia website reply,
 * appointment confirmations, cadence tasks. Rather than patch each call site
 * and hope the next one remembers, the check lives where the message actually
 * leaves, exactly like finalizeOutboundSmsBody above it.
 *
 * `operatorInitiated` is the deliberate escape hatch: a human replying from the
 * dashboard is an accountable decision and is not blocked. Nothing else may
 * pass it.
 *
 * No-ops when the database is unavailable — a suppression lookup that cannot
 * run must not silently stop a client's agent. The reply-send path does its own
 * check with the lead already loaded, so the important case is still covered.
 */
async function suppressedRecipient(recipient: string): Promise<string> {
  if (!process.env.DATABASE_URL) return "";
  try {
    const { findLeadInDatabase } = await import("@/lib/database");
    const { channelSuppression } = await import("@/lib/contactSuppression");
    const lead = await findLeadInDatabase({ phone: recipient });
    if (!lead) return "";
    const verdict = channelSuppression(lead, "sms");
    return verdict.suppressed ? verdict.reason : "";
  } catch {
    return "";
  }
}

export async function sendTheoSms(
  to: string,
  body: string,
  mediaUrls: string[] = [],
  options: { operatorInitiated?: boolean } = {},
): Promise<TwilioSendResult> {
  const cleanUrls = cleanMediaUrls(mediaUrls);
  if (!mayUseSharedEnvironmentConnections(requestWorkspaceId())) {
    return { sent: false, skipped: true, sid: "", error: "Connect a workspace-specific Twilio account before sending SMS", mediaCount: cleanUrls.length };
  }
  if (!smsAgentEnabled()) {
    return { sent: false, skipped: true, sid: "", error: "ENABLE_SMS_AGENT is not true", mediaCount: cleanUrls.length };
  }

  const missing = missingConfig();
  if (missing) {
    return { sent: false, skipped: true, sid: "", error: `Missing Twilio config: ${missing}`, mediaCount: cleanUrls.length };
  }

  const recipient = smsRecipientAddress(to);
  const message = finalizeOutboundSmsBody(body);
  if (!recipient || (!message && !cleanUrls.length)) {
    return { sent: false, skipped: true, sid: "", error: "Missing SMS recipient or message media", mediaCount: cleanUrls.length };
  }
  if (isUnsafeSmsRecipient(recipient)) {
    return {
      sent: false,
      skipped: true,
      sid: "",
      error: `Blocked unsafe SMS recipient: ${recipient}`,
      mediaCount: cleanUrls.length,
    };
  }

  if (!options.operatorInitiated) {
    const suppressed = await suppressedRecipient(recipient);
    if (suppressed) {
      return { sent: false, skipped: true, sid: "", error: suppressed, mediaCount: cleanUrls.length };
    }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const fromNumber = (process.env.TWILIO_FROM || "").trim();
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim();
  if (!fromNumber && !messagingServiceSid) {
    return {
      sent: false,
      skipped: true,
      sid: "",
      error: "TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID is required for SMS replies",
      mediaCount: cleanUrls.length,
    };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams({ To: recipient });
  // A2P 10DLC binds carrier campaign registration to the Messaging Service, not
  // to the number. Sending with a bare From leaves the traffic unregistered
  // (30032/30007 filtering at volume) and bypasses the service's own opt-out
  // handling. Prefer the service; keep From for deployments without one.
  if (messagingServiceSid) {
    form.set("MessagingServiceSid", messagingServiceSid);
  } else {
    form.set("From", fromNumber);
  }
  const statusCallback = twilioStatusCallbackUrl();
  if (statusCallback) form.set("StatusCallback", statusCallback);
  if (message) {
    form.append("Body", message);
  }
  for (const mediaUrl of cleanUrls) {
    form.append("MediaUrl", mediaUrl);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        sent: false,
        skipped: false,
        sid: "",
        error: String(payload.message || response.statusText || "Twilio send failed"),
        mediaCount: cleanUrls.length,
      };
    }
    return { sent: true, skipped: false, sid: String(payload.sid || ""), error: "", mediaCount: cleanUrls.length };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      sid: "",
      error: error instanceof Error ? error.message : "Twilio send failed",
      mediaCount: cleanUrls.length,
    };
  }
}

export function agentAlertPhone(): string {
  return (process.env.AGENT_PHONE || process.env.TEAM_LEAD_PHONE || "").trim();
}

export async function sendTheoHandoffAlert(input: {
  leadPhone: string;
  leadName?: string;
  reason: string;
  summary: string;
  threadRef: string;
}): Promise<TwilioSendResult> {
  const to = agentAlertPhone();
  if (!to) {
    return { sent: false, skipped: true, sid: "", error: "AGENT_PHONE is not configured", mediaCount: 0 };
  }

  const lead = input.leadName || input.leadPhone || "Unknown lead";
  const body = [
    `${IRIS_AGENT_NAME} handoff: ${lead}`,
    `Reason: ${input.reason || "Needs human review"}`,
    `Lead phone: ${input.leadPhone || "unknown"}`,
    `Thread: ${input.threadRef || "sms thread"}`,
    input.summary ? `Summary: ${input.summary}` : "",
  ].filter(Boolean).join("\n").slice(0, 900);

  // Alert to the agent's own phone, not a lead. Never suppression-gated.
  return sendTheoSms(to, body, [], { operatorInitiated: true });
}
