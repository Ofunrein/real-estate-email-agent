import { upsertReplyJobInDatabase } from "@/lib/database";
import { inngest } from "@/lib/inngest/client";

export type IrisReplyQueueInput = {
  dedupeKey: string;
  channel: "sms" | "whatsapp" | "email" | "instagram" | "messenger";
  provider: string;
  threadRef: string;
  contactRef: string;
  replyText: string;
  mediaUrls?: string[];
  modelClassify?: string;
  modelReply?: string;
  nextAction?: string;
  metadata?: Record<string, unknown>;
};

export async function queueIrisReplySend(input: IrisReplyQueueInput): Promise<void> {
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey) throw new Error("Reply send requires a dedupe key");
  const job = await upsertReplyJobInDatabase({
    dedupeKey,
    channel: input.channel,
    provider: input.provider,
    threadRef: input.threadRef,
    contactRef: input.contactRef,
    status: "ready_to_send",
    modelClassify: input.modelClassify || "iris-text-classifier",
    modelReply: input.modelReply || "iris-text-reply",
    replyText: input.replyText,
    mediaJson: (input.mediaUrls || []).map((url) => ({ url, type: "image" })),
    nextAction: input.nextAction || "send_reply",
    metadata: { ...(input.metadata || {}), generatedAt: new Date().toISOString() },
  });
  if (!job) throw new Error("Reply job could not be persisted");
  await inngest.send({ name: "message.reply.send", data: { dedupeKey } });
}
