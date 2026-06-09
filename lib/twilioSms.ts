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
  if (!process.env.TWILIO_MESSAGING_SERVICE_SID && !process.env.TWILIO_FROM) {
    missing.push("TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM");
  }
  return missing.join(", ");
}

function cleanMediaUrls(mediaUrls: string[] = []): string[] {
  return mediaUrls
    .map((url) => url.trim())
    .filter((url) => /^https:\/\//i.test(url))
    .slice(0, Math.max(0, Number(process.env.SMS_MAX_IMAGES || "1")));
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
  const message = body.trim();
  if (!recipient || !message) {
    return { sent: false, skipped: true, sid: "", error: "Missing SMS recipient or body", mediaCount: cleanUrls.length };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams({
    To: recipient,
    Body: message,
  });
  if (messagingServiceSid) {
    form.set("MessagingServiceSid", messagingServiceSid);
  } else {
    form.set("From", process.env.TWILIO_FROM || "");
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
