import { createIrisGmailSession, sendGmailReplyWithOptions } from "@/lib/gmailConnection";
import { sendTheoSms } from "@/lib/twilioSms";

export type EmailAttachment = { filename: string; contentType: string; path: string };
export type ManualReplyInput = {
  channel: "sms" | "whatsapp" | "email";
  to: string; // phone for sms/wa, email address for email
  body: string;
  mediaUrls?: string[];
  // email-only
  subject?: string;
  threadId?: string; // Gmail thread id for in-thread reply
  messageId?: string; // In-Reply-To header value
  references?: string;
  attachments?: EmailAttachment[]; // local file paths (from upload endpoint)
};

export type ManualReplyResult = {
  ok: true;
  threaded?: boolean;
  mailboxEmail?: string;
  fallbackReason?: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
} | { ok: false; error: string };

export async function sendManualReply(input: ManualReplyInput): Promise<ManualReplyResult> {
  try {
    switch (input.channel) {
      case "sms": {
        const r = await sendTheoSms(input.to, input.body, input.mediaUrls ?? []);
        return r.sent ? { ok: true } : { ok: false, error: r.error || "SMS not sent" };
      }
      case "whatsapp":
        return await sendWhatsApp(input);
      case "email":
        return await sendEmail(input);
      default:
        return { ok: false, error: `Unsupported channel: ${input.channel}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Twilio WhatsApp: To/From need a `whatsapp:` prefix. sendTheoSms can't do that
// (hardcodes TWILIO_FROM + strips only rcs/sms), so post directly here.
async function sendWhatsApp(input: ManualReplyInput): Promise<ManualReplyResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const from = (process.env.TWILIO_WHATSAPP_FROM || "").trim();
  if (!accountSid || !authToken) return { ok: false, error: "Missing Twilio credentials" };
  if (!from) return { ok: false, error: "TWILIO_WHATSAPP_FROM is required" };

  const digits = input.to.replace(/^whatsapp:/i, "").trim();
  const form = new URLSearchParams({
    To: `whatsapp:${digits}`,
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    Body: input.body,
  });
  for (const url of input.mediaUrls ?? []) form.append("MediaUrl", url);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
  );
  if (!res.ok) return { ok: false, error: `Twilio WhatsApp ${res.status}: ${await res.text()}` };
  return { ok: true };
}

async function sendEmail(input: ManualReplyInput): Promise<ManualReplyResult> {
  const session = await createIrisGmailSession();
  const result = await sendGmailReplyWithOptions(session.gmail, input, {
    mailboxEmail: session.accountEmail,
    fallbackUnthreadedOnMissingThread: true,
  });
  return {
    ok: true,
    threaded: result.threaded,
    mailboxEmail: result.mailboxEmail,
    fallbackReason: result.fallbackReason,
    gmailThreadId: result.threadId,
    gmailMessageId: result.messageId,
  };
}
