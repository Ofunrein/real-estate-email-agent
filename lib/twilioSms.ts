import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { mediaProxyUrl } from "@/lib/mediaProxy";

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

function mediaLogLabel(url: string): string {
  const lower = url.toLowerCase();
  if (/\.(?:m4a|mp3|aac|wav|ogg|webm)(?:[?#]|$)/i.test(lower) || /(?:audio|voice)/i.test(lower)) {
    return "MMS audio";
  }
  if (/\.(?:jpg|jpeg|png|gif|webp|heic)(?:[?#]|$)/i.test(lower) || /(?:photo|image)/i.test(lower)) {
    return "MMS image";
  }
  return "MMS media";
}

export function smsMessageWithMediaLog(body: string, mediaUrls: string[] = []): string {
  const cleanBody = body.trim();
  const cleanUrls = cleanMediaUrls(mediaUrls);
  if (!cleanUrls.length) return cleanBody;
  return [cleanBody, "", ...cleanUrls.map((url) => `${mediaLogLabel(url)}: ${url}`)].filter(Boolean).join("\n");
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

  const recipient = smsRecipientAddress(to);
  const message = body.trim();
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

  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const fromNumber = (process.env.TWILIO_FROM || "").trim();
  if (!fromNumber) {
    return {
      sent: false,
      skipped: true,
      sid: "",
      error: "TWILIO_FROM is required for SMS replies",
      mediaCount: cleanUrls.length,
    };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams({
    To: recipient,
    From: fromNumber,
  });
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

  return sendTheoSms(to, body);
}
