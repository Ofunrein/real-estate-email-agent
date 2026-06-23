import { recordChannelInteraction } from "@/lib/channelIngest";
import {
  claimEventDedupeInDatabase,
  upsertReplyJobInDatabase,
} from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import {
  normalizedDedupeKey,
  normalizedMessageText,
  type OmnichannelMessageReceived,
} from "@/lib/omnichannelEvents";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

export type MessageReceivedResult = {
  ok: true;
  dedupeKey: string;
  duplicate: boolean;
  queuedReply: boolean;
};

export const messageReceived = inngest.createFunction(
  {
    id: "message-received",
    name: "Normalize inbound omnichannel message",
    triggers: [{ event: "message.received" }],
  },
  async ({ event, step }): Promise<MessageReceivedResult> => {
    const input = event.data as OmnichannelMessageReceived;
    const dedupeKey = normalizedDedupeKey(input);
    const text = normalizedMessageText(input);

    const claim = await step.run("claim event dedupe", async () => {
      return claimEventDedupeInDatabase({
        dedupeKey,
        channel: input.channel,
        provider: input.provider,
        providerMessageId: input.providerMessageId,
        threadRef: input.threadRef,
        metadata: input.providerMetadata,
      });
    });

    const job = await step.run("upsert reply job", async () => {
      return upsertReplyJobInDatabase({
        dedupeKey,
        channel: input.channel,
        provider: input.provider,
        threadRef: input.threadRef,
        contactRef: input.contactRef || "",
        status: claim.inserted ? "received" : "duplicate_suppressed",
        mediaJson: input.media || [],
        metadata: {
          providerMessageId: input.providerMessageId,
          providerMetadata: input.providerMetadata || {},
        },
      });
    });

    if (!claim.inserted) {
      return { ok: true, dedupeKey, duplicate: true, queuedReply: false };
    }

    await step.run("append conversation event", async () => {
      await recordChannelInteraction({
        channel: input.channel,
        direction: input.direction || "inbound",
        eventAt: input.receivedAt || undefined,
        agentName: IRIS_AGENT_NAME,
        phone: input.channel === "email" ? "" : input.contactRef || "",
        email: input.channel === "email" ? input.contactRef || "" : "",
        fullName: String(input.providerMetadata?.senderName || input.providerMetadata?.senderUsername || ""),
        source: input.provider,
        threadRef: input.threadRef,
        eventType: `${input.channel}_inbound`,
        messageText: text,
        summary: text ? `Inbound ${input.channel}: ${text}` : `Inbound ${input.channel} attachment`,
        preferredChannel: input.channel,
        gmailMessageId: dedupeKey,
        providerMessageId: input.providerMessageId,
        providerThreadId: input.threadRef,
        mediaJson: input.media || [],
        providerMetadata: input.providerMetadata || {},
        replyJobId: job?.id || "",
      });
    });

    await step.sendEvent("queue reply generation", {
      name: "message.reply.generate",
      data: { dedupeKey },
    });

    await step.sendEvent("queue thread summary refresh", {
      name: "thread.summary.refresh",
      data: { threadRef: input.threadRef, channel: input.channel },
    });

    return { ok: true, dedupeKey, duplicate: false, queuedReply: true };
  },
);
