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

function isRcsAddress(value: string): boolean {
  return /^rcs:/i.test(value.trim());
}

function recipientDigits(value: string): string {
  return value.replace(/^rcs:/i, "").replace(/\D/g, "");
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

function mediaProxyUrl(url: string): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === new URL(base).hostname) return url;
    return `${base}/api/media/proxy?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

export function smsMessageWithMediaLog(body: string, mediaUrls: string[] = []): string {
  const cleanBody = body.trim();
  const cleanUrls = cleanMediaUrls(mediaUrls);
  if (!cleanUrls.length) return cleanBody;
  return [cleanBody, "", ...cleanUrls.map((url) => `MMS image: ${url}`)].join("\n");
}

export async function sendTheoSms(to: string, body: string, mediaUrls: string[] = []): Promise<TwilioSendResult> {
  const cleanUrls = cleanMediaUrls(mediaUrls);
  if (!smsAgentEnabled()) {
    return { sent: false, skipped: true, sid: "", error: "ENABLE_SMS_AGENT is not true", mediaCount: cleanUrls.length };
  }

  const missing = missingConfig();
  if (missing) {
    return { sent: false, skipped: true, sid: "", error: `Missing Twilio config: ${missing}`, mediaCount: cleanUrls.length };
  }

  const recipient = to.trim();
  const recipientForSend = recipient.replace(/^rcs:/i, "");
  const message = body.trim();
  if (!recipient || !message) {
    return { sent: false, skipped: true, sid: "", error: "Missing SMS recipient or body", mediaCount: cleanUrls.length };
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

  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim();
  const fromNumber = (process.env.TWILIO_FROM || "").trim();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams({
    To: recipientForSend,
    Body: message,
  });
  if (messagingServiceSid) {
    form.set("MessagingServiceSid", messagingServiceSid);
  } else {
    if (!fromNumber) {
      return {
        sent: false,
        skipped: true,
        sid: "",
        error: isRcsAddress(recipient) ? "TWILIO_MESSAGING_SERVICE_SID is required for RCS replies" : "TWILIO_FROM is required for SMS replies",
        mediaCount: cleanUrls.length,
      };
    }
    form.set("From", fromNumber);
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
    `Theo handoff: ${lead}`,
    `Reason: ${input.reason || "Needs human review"}`,
    `Lead phone: ${input.leadPhone || "unknown"}`,
    `Thread: ${input.threadRef || "sms thread"}`,
    input.summary ? `Summary: ${input.summary}` : "",
  ].filter(Boolean).join("\n").slice(0, 900);

  return sendTheoSms(to, body);
}
