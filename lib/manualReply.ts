import { createIrisGmailSession, sendGmailReplyWithOptions } from "@/lib/gmailConnection";
import { composioSocialSendsEnabled, sendComposioSocialMessage } from "@/lib/composioSocial";
import { listChannelConnections } from "@/lib/channelConnections";
import { sendInstagramBrowserThreadMessage } from "@/lib/instagramBrowserBridge";
import { metaSocialDirectEnabled, sendMetaSocialMessage } from "@/lib/metaSocial";
import { sendTheoSms } from "@/lib/twilioSms";
import { removeEmDashesFromRecord } from "@/lib/noEmDash";

export type EmailAttachment = { filename: string; contentType: string; path?: string; data?: Buffer };
export type ManualReplyInput = {
  channel: "sms" | "whatsapp" | "email" | "instagram" | "messenger";
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
  deliveredBody?: string;
  deliveredMediaUrls?: string[];
  droppedMediaUrls?: string[];
  messageIds?: string[];
} | { ok: false; error: string };

function instagramUsernameTarget(value: string): string {
  const clean = value.trim();
  if (!clean.startsWith("@")) return "";
  return clean.replace(/^@+/, "").trim();
}

export async function sendManualReply(inputRaw: ManualReplyInput): Promise<ManualReplyResult> {
  const input = removeEmDashesFromRecord(inputRaw, ["body", "subject"]);
  try {
    switch (input.channel) {
      case "sms": {
        const r = await sendTheoSms(input.to, input.body, input.mediaUrls ?? []);
        return r.sent
          ? { ok: true, deliveredBody: input.body, deliveredMediaUrls: input.mediaUrls ?? [], droppedMediaUrls: [] }
          : { ok: false, error: r.error || "SMS not sent" };
      }
      case "whatsapp":
        if ((process.env.WHATSAPP_PROVIDER || "").toLowerCase() === "composio") {
          const r = await sendComposioSocialMessage({
            channel: "whatsapp",
            to: input.to,
            body: input.body,
            mediaUrls: input.mediaUrls,
            threadRef: input.threadId,
          });
          return r.ok
            ? {
              ok: true,
              deliveredBody: r.deliveredBody,
              deliveredMediaUrls: r.deliveredMediaUrls,
              droppedMediaUrls: r.droppedMediaUrls,
            }
            : r;
        }
        return await sendWhatsApp(input);
      case "instagram":
      case "messenger": {
        if (input.channel === "instagram" && input.to.startsWith("browser_thread:")) {
          const r = await sendInstagramBrowserThreadMessage({
            threadId: input.to,
            body: input.body,
            mediaUrls: input.mediaUrls,
          });
          return r.ok
            ? {
              ok: true,
              deliveredBody: r.deliveredBody || input.body,
              deliveredMediaUrls: [],
              droppedMediaUrls: input.mediaUrls ?? [],
              messageIds: r.messageId ? [r.messageId] : [],
            }
            : { ok: false, error: r.error || "Instagram browser send failed" };
        }
        const usernameTarget = input.channel === "instagram" ? instagramUsernameTarget(input.to) : "";
        if (usernameTarget) {
          const r = await sendComposioSocialMessage({
            channel: "instagram",
            to: usernameTarget,
            body: input.body,
            mediaUrls: input.mediaUrls,
            threadRef: input.threadId,
          });
          return r.ok
            ? {
              ok: true,
              deliveredBody: r.deliveredBody,
              deliveredMediaUrls: r.deliveredMediaUrls,
              droppedMediaUrls: r.droppedMediaUrls,
            }
            : r;
        }
        if (metaSocialDirectEnabled(input.channel)) {
          const connection = await directMetaConnectionForChannel(input.channel);
          if (!connection?.page_access_token) {
            return { ok: false, error: `Connect ${input.channel} with Meta before sending. No page access token is stored for this channel.` };
          }
          const r = await sendMetaSocialMessage({
            channel: input.channel,
            to: input.to,
            body: input.body,
            mediaUrls: input.mediaUrls,
            pageAccessToken: connection.page_access_token,
          });
          return r.sent
            ? {
              ok: true,
              deliveredBody: r.deliveredBody,
              deliveredMediaUrls: r.deliveredMediaUrls,
              droppedMediaUrls: r.droppedMediaUrls,
              messageIds: r.messageIds,
            }
            : { ok: false, error: r.error || `${input.channel} not sent` };
        }
        const r = await sendComposioSocialMessage({
          channel: input.channel,
          to: input.to,
          body: input.body,
          mediaUrls: input.mediaUrls,
          threadRef: input.threadId,
        });
        return r.ok
          ? {
            ok: true,
            deliveredBody: r.deliveredBody,
            deliveredMediaUrls: r.deliveredMediaUrls,
            droppedMediaUrls: r.droppedMediaUrls,
          }
          : r;
      }
      case "email":
        return await sendEmail(input);
      default:
        return { ok: false, error: `Unsupported channel: ${input.channel}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function directMetaConnectionForChannel(channel: "instagram" | "messenger") {
  const { connections } = await listChannelConnections();
  return connections
    .filter((connection) =>
      connection.channel === channel
      && connection.provider === "meta_direct"
      && connection.status === "connected"
      && Boolean(connection.page_access_token)
    )
    .sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || ""))[0] || null;
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
  return { ok: true, deliveredBody: input.body, deliveredMediaUrls: input.mediaUrls ?? [], droppedMediaUrls: [] };
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
    deliveredBody: input.body,
    deliveredMediaUrls: input.mediaUrls ?? [],
    droppedMediaUrls: [],
  };
}
