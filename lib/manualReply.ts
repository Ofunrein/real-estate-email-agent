import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

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

export type ManualReplyResult = { ok: true } | { ok: false; error: string };

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

// Reuse the same OAuth2 credentials.json/token.json the sheets client uses.
// token.json scope is gmail.modify, which covers send.
async function gmailClient() {
  const credentialsPath = path.resolve(process.cwd(), process.env.GMAIL_CREDENTIALS_PATH || "credentials.json");
  const tokenPath = path.resolve(process.cwd(), process.env.GMAIL_TOKEN_PATH || "token.json");
  const creds = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  const app = creds.installed || creds.web;
  const auth = new google.auth.OAuth2(app.client_id, app.client_secret, app.redirect_uris?.[0]);
  auth.setCredentials(token);
  return google.gmail({ version: "v1", auth });
}

async function sendEmail(input: ManualReplyInput): Promise<ManualReplyResult> {
  const gmail = await gmailClient();
  const subjectRaw = input.subject || "(no subject)";
  const subject = /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw}`;
  const boundary = `boundary_${Date.now().toString(36)}`;

  const baseHeaders = [
    `To: ${input.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    ...(input.messageId
      ? [`In-Reply-To: ${input.messageId}`, `References: ${((input.references || "") + " " + input.messageId).trim()}`]
      : []),
  ];

  let raw: string;
  if (!input.attachments?.length) {
    // ponytail: plain-text when no attachments — saves bytes
    const lines = [...baseHeaders, "Content-Type: text/plain; charset=utf-8", "", input.body];
    raw = Buffer.from(lines.join("\r\n")).toString("base64url");
  } else {
    const parts: string[] = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
    ];
    for (const att of input.attachments) {
      const data = fs.readFileSync(att.path);
      parts.push(
        `--${boundary}`,
        `Content-Type: ${att.contentType}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${att.filename}"`,
        "",
        data.toString("base64"),
      );
    }
    parts.push(`--${boundary}--`);
    const lines = [
      ...baseHeaders,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      ...parts,
    ];
    raw = Buffer.from(lines.join("\r\n")).toString("base64url");
  }

  await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: input.threadId } });
  return { ok: true };
}
