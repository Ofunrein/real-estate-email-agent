import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { type EmailAttachment, sendManualReply } from "@/lib/manualReply";
import { databaseEnabled, upsertThreadLinkInDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";

type ReplyBody = {
  channel: "sms" | "whatsapp" | "email";
  to: string;
  body: string;
  mediaUrls?: string[];
  subject?: string;
  threadId?: string;
  messageId?: string;
  references?: string;
};

// Map public /uploads/<filename> URL → absolute disk path for email attachment reads.
function resolveAttachments(mediaUrls: string[] = [], channel: "sms" | "whatsapp" | "email"): EmailAttachment[] {
  if (channel !== "email") return [];
  return mediaUrls
    .map((url) => {
      const match = /\/uploads\/([^?#]+)$/.exec(url);
      if (!match) return null;
      const filename = match[1];
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";
      const contentTypeMap: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp", pdf: "application/pdf", mp4: "video/mp4",
      };
      return {
        filename,
        contentType: contentTypeMap[ext] ?? "application/octet-stream",
        path: join(process.cwd(), "public", "uploads", filename),
      } satisfies EmailAttachment;
    })
    .filter(Boolean) as EmailAttachment[];
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
    attachments: resolveAttachments(input.mediaUrls, input.channel),
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
    messageText: input.body,
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
