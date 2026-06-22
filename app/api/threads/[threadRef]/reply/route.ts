import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { type EmailAttachment, sendManualReply } from "@/lib/manualReply";
import { databaseEnabled, upsertThreadLinkInDatabase } from "@/lib/database";
import { readMediaUpload } from "@/lib/mediaUploads";

export const dynamic = "force-dynamic";

type ReplyBody = {
  channel: "sms" | "whatsapp" | "email" | "instagram" | "messenger";
  to: string;
  body: string;
  mediaUrls?: string[];
  mediaTranscripts?: Array<{ url?: string; text?: string }>;
  subject?: string;
  threadId?: string;
  messageId?: string;
  references?: string;
};

// Map public /uploads/<filename> URL → absolute disk path for email attachment reads.
async function resolveAttachments(mediaUrls: string[] = [], channel: ReplyBody["channel"]): Promise<EmailAttachment[]> {
  if (channel !== "email") return [];
  const attachments: EmailAttachment[] = [];
  for (const url of mediaUrls) {
    const dbMatch = /\/api\/media\/uploads\/([^/?#]+)\/([^?#]+)$/.exec(url);
    if (dbMatch) {
      const upload = await readMediaUpload(decodeURIComponent(dbMatch[1]));
      if (upload) {
        attachments.push({
          filename: upload.filename,
          contentType: upload.contentType,
          data: upload.data,
        });
      }
      continue;
    }

    const match = /\/uploads\/([^?#]+)$/.exec(url);
    if (!match) continue;
    const filename = decodeURIComponent(match[1]);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const contentTypeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
      m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg",
      wav: "audio/wav", webm: "audio/webm", mp4: "video/mp4",
    };
    attachments.push({
      filename,
      contentType: contentTypeMap[ext] ?? "application/octet-stream",
      path: join(process.cwd(), "public", "uploads", filename),
    });
  }
  return attachments;
}

function mediaLogLabel(channel: ReplyBody["channel"], url: string): string {
  if (/\.(?:aac|m4a|mp3|mpeg|ogg|opus|wav|webm)(?:$|[?#])/i.test(url)) return "Voice note";
  if (channel === "whatsapp") return "WhatsApp media";
  if (channel === "instagram" || channel === "messenger") return "Social DM media";
  if (channel === "email") return "Attachment";
  return "MMS media";
}

function messageWithMediaLog(input: ReplyBody): string {
  const body = input.body?.trim() || "";
  const mediaLines = (input.mediaUrls || []).flatMap((url) => {
    const transcript = input.mediaTranscripts?.find((item) => item.url === url)?.text?.trim();
    return [
      `${mediaLogLabel(input.channel, url)}: ${url}`,
      transcript ? `Voice note transcript: ${transcript}` : "",
    ].filter(Boolean);
  });
  return [body, ...mediaLines].filter(Boolean).join("\n\n");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const { threadRef } = await params;
  const input = (await req.json()) as ReplyBody;

  if (!input.channel || !input.to || (!input.body?.trim() && !input.mediaUrls?.length)) {
    return NextResponse.json({ ok: false, error: "channel, to, and body/media required" }, { status: 400 });
  }

  if (!(await isTakeoverActive(threadRef))) {
    return NextResponse.json({ ok: false, error: "No active takeover for this thread" }, { status: 403 });
  }

  const result = await sendManualReply({
    ...input,
    attachments: await resolveAttachments(input.mediaUrls, input.channel),
  });
  if (!result.ok) return NextResponse.json(result, { status: 502 });

  await recordChannelInteraction({
    channel: input.channel,
    direction: "outbound",
    agentName: "Owner",
    source: "human_takeover",
    phone: input.channel !== "email" ? input.to : undefined,
    email: input.channel === "email" ? input.to : undefined,
    threadRef,
    messageText: messageWithMediaLog(input),
    status: result.ok && result.fallbackReason ? "sent_fresh" : "sent",
    mailboxEmail: input.channel === "email" ? result.mailboxEmail : "",
    gmailThreadId: input.channel === "email" ? result.gmailThreadId : "",
    gmailMessageId: input.channel === "email" ? result.gmailMessageId : "",
    threadStatus: input.channel === "email"
      ? result.threaded ? "current_mailbox_thread" : "sent_fresh_from_current_mailbox"
      : "",
  });

  if (databaseEnabled() && input.channel === "email" && result.ok) {
    await upsertThreadLinkInDatabase({
      threadRef,
      channel: "email",
      mailboxEmail: result.mailboxEmail,
      gmailThreadId: result.gmailThreadId || input.threadId,
      gmailMessageId: result.gmailMessageId,
      threadStatus: result.threaded ? "current_mailbox_thread" : "sent_fresh_from_current_mailbox",
    });
  }

  return NextResponse.json(result);
}
