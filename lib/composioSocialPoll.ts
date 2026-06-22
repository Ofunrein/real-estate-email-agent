import { recordChannelInteraction } from "@/lib/channelIngest";
import { listChannelConnections, type ChannelConnectionRecord } from "@/lib/channelConnections";
import { composioExternalUserId, createComposioClient } from "@/lib/composioConnection";
import { sendComposioSocialMessage, type ComposioSocialChannel } from "@/lib/composioSocial";
import {
  conversationEventMessageIdExists,
  findLeadInDatabase,
  readEventsForThreadFromDatabase,
  readEventsForThreadOrContactFromDatabase,
  readInboxSettingsFromDatabase,
} from "@/lib/database";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";
import {
  buildSocialRouterResult,
  shouldTheoHandleSocialDm,
  socialDmAgentEnabled,
  type SocialDmChannel,
  type SocialDmPayload,
} from "@/lib/manychatSocial";
import { fetchStyleContext } from "@/lib/styleTraining";
import { generateTheoReply } from "@/lib/theoAgent";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

type PollChannel = Extract<SocialDmChannel, "instagram" | "messenger">;

type ComposioMessage = {
  id: string;
  conversationId: string;
  channel: PollChannel;
  createdTime: string;
  text: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  recipientId: string;
  accountLabel: string;
};

export type ComposioSocialPollResult = {
  ok: boolean;
  checked: number;
  imported: number;
  replied: number;
  skipped: number;
  errors: string[];
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayAt(value: unknown, path: string[]): Record<string, unknown>[] {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return [];
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return Array.isArray(cursor)
    ? cursor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function dataArray(value: unknown): Record<string, unknown>[] {
  return [
    ...arrayAt(value, ["data", "data"]),
    ...arrayAt(value, ["data", "messages", "data"]),
    ...arrayAt(value, ["data"]),
  ];
}

function nestedString(value: unknown, path: string[]): string {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return "";
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" || typeof cursor === "number" ? String(cursor).trim() : "";
}

function firstRecipientId(message: Record<string, unknown>): string {
  return [
    nestedString(message, ["to", "data", "0", "id"]),
    nestedString(message, ["to", "id"]),
  ].find(Boolean) || "";
}

function firstRecipientName(message: Record<string, unknown>): string {
  return [
    nestedString(message, ["to", "data", "0", "username"]),
    nestedString(message, ["to", "data", "0", "name"]),
    nestedString(message, ["to", "username"]),
    nestedString(message, ["to", "name"]),
  ].find(Boolean) || "";
}

function conversationIdFrom(record: Record<string, unknown>) {
  return String(record.id || record.conversation_id || "").trim();
}

function isSelfMessage(message: ComposioMessage, connection: ChannelConnectionRecord) {
  const ownIds = [
    connection.selected_asset_id,
    connection.connected_account_id,
    String(connection.metadata?.instagram_user_id || ""),
    String(connection.metadata?.page_id || ""),
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const ownNames = [
    connection.selected_asset_name,
    String(connection.metadata?.username || ""),
    String(connection.metadata?.page_name || ""),
  ].map((value) => String(value || "").replace(/^@/, "").trim().toLowerCase()).filter(Boolean);
  return ownIds.includes(message.senderId)
    || ownNames.includes(message.senderUsername.replace(/^@/, "").trim().toLowerCase())
    || ownNames.includes(message.senderName.replace(/^@/, "").trim().toLowerCase());
}

async function executeTool(
  slug: string,
  userId: string,
  connectedAccountId: string,
  args: Record<string, unknown>,
) {
  return createComposioClient().tools.execute(slug, {
    userId,
    connectedAccountId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
}

async function instagramMessages(userId: string, connection: ChannelConnectionRecord, limit: number): Promise<ComposioMessage[]> {
  const conversations = await executeTool(
    "INSTAGRAM_LIST_ALL_CONVERSATIONS",
    userId,
    connection.connected_account_id,
    { limit: Math.min(limit, 25), ig_user_id: String(connection.metadata?.instagram_user_id || "me") },
  );
  const accountLabel = connection.selected_asset_name || "Instagram";
  const messages: ComposioMessage[] = [];
  for (const conversation of dataArray(conversations).slice(0, Math.min(limit, 10))) {
    const conversationId = conversationIdFrom(conversation);
    if (!conversationId) continue;
    const result = await executeTool(
      "INSTAGRAM_LIST_ALL_MESSAGES",
      userId,
      connection.connected_account_id,
      { limit: Math.min(limit, 25), conversation_id: conversationId },
    );
    for (const message of dataArray(result)) {
      const from = jsonRecord(message.from);
      const senderId = String(from.id || "").trim();
      const senderUsername = String(from.username || "").trim();
      const senderName = String(from.name || senderUsername || senderId || "Instagram lead").trim();
      messages.push({
        id: String(message.id || "").trim(),
        conversationId,
        channel: "instagram",
        createdTime: String(message.created_time || message.createdTime || "").trim(),
        text: String(message.message || message.text || "").trim(),
        senderId,
        senderName,
        senderUsername,
        recipientId: firstRecipientId(message),
        accountLabel,
      });
    }
  }
  return messages;
}

async function messengerMessages(userId: string, connection: ChannelConnectionRecord, limit: number): Promise<ComposioMessage[]> {
  const pageId = String(connection.metadata?.page_id || connection.selected_asset_id || "").trim();
  if (!pageId) return [];
  const conversations = await executeTool(
    "FACEBOOK_GET_PAGE_CONVERSATIONS",
    userId,
    connection.connected_account_id,
    { page_id: pageId, limit: Math.min(limit, 25), fields: "participants,updated_time,id" },
  );
  const accountLabel = connection.selected_asset_name || "Messenger";
  const messages: ComposioMessage[] = [];
  for (const conversation of dataArray(conversations).slice(0, Math.min(limit, 10))) {
    const conversationId = conversationIdFrom(conversation);
    if (!conversationId) continue;
    const result = await executeTool(
      "FACEBOOK_GET_CONVERSATION_MESSAGES",
      userId,
      connection.connected_account_id,
      { page_id: pageId, conversation_id: conversationId, limit: Math.min(limit, 25), fields: "id,created_time,from,to,message" },
    );
    for (const message of dataArray(result)) {
      const from = jsonRecord(message.from);
      const senderId = String(from.id || "").trim();
      const senderName = String(from.name || senderId || "Messenger lead").trim();
      messages.push({
        id: String(message.id || "").trim(),
        conversationId,
        channel: "messenger",
        createdTime: String(message.created_time || message.createdTime || "").trim(),
        text: String(message.message || message.text || "").trim(),
        senderId,
        senderName,
        senderUsername: senderName,
        recipientId: firstRecipientId(message),
        accountLabel,
      });
    }
  }
  return messages;
}

function socialPayloadFromMessage(message: ComposioMessage): SocialDmPayload {
  return {
    channel: message.channel,
    messageText: message.text,
    contactId: message.senderId,
    threadId: message.conversationId,
    senderName: message.senderName,
    senderUsername: message.senderUsername,
    accountLabel: message.accountLabel,
    routeReason: "",
    campaign: "",
    listingAddress: "",
    sourceUrl: "",
  };
}

function eventDateValue(value: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function alreadyHandledInbound(messageKey: string, events: Awaited<ReturnType<typeof readEventsForThreadFromDatabase>>) {
  const inbound = events.find((event) => event.gmail_message_id === messageKey && event.direction === "inbound");
  if (!inbound) return true;
  const inboundAt = eventDateValue(inbound.event_at || inbound.created_at || "");
  if (!inboundAt) return true;
  return events.some((event) =>
    event.direction !== "inbound" &&
    eventDateValue(event.event_at || event.created_at || "") > inboundAt
  );
}

async function processMessage(message: ComposioMessage, connection: ChannelConnectionRecord): Promise<"imported" | "replied" | "skipped"> {
  if (!message.id || !message.text || !message.senderId) return "skipped";
  if (isSelfMessage(message, connection)) return "skipped";
  const messageKey = `${message.channel}:${message.id}`;
  const payload = socialPayloadFromMessage(message);
  const guard = shouldTheoHandleSocialDm(payload);
  const threadRef = `${message.channel}:${message.conversationId}`;
  const sourceDetail = [
    `account ${message.accountLabel}`,
    `sender_id ${message.senderId}`,
    message.recipientId ? `recipient_id ${message.recipientId}` : "",
    `message_id ${message.id}`,
  ].filter(Boolean).join("; ");

  const duplicate = await conversationEventMessageIdExists(messageKey);
  const result = duplicate
    ? null
    : await recordChannelInteraction({
      channel: message.channel,
      direction: "inbound",
      eventAt: message.createdTime || undefined,
      agentName: IRIS_AGENT_NAME,
      phone: message.senderId,
      fullName: message.senderUsername || message.senderName,
      source: "composio",
      sourceDetail,
      threadRef,
      eventType: `${message.channel}_inbound`,
      messageText: message.text,
      summary: `Inbound ${message.channel} DM: ${message.text}`,
      preferredChannel: message.channel,
      intent: guard.intent,
      aiAction: guard.allowed ? "social_dm_routed" : "social_dm_handoff",
      handoffStatus: guard.needsHuman ? "needs_human" : "",
      handoffReason: guard.reason,
      nextAction: guard.allowed ? "reply_with_iris" : "human_follow_up",
      status: guard.allowed ? "received" : "needs_human",
      gmailMessageId: messageKey,
    });

  if (!socialDmAgentEnabled()) {
    return duplicate ? "skipped" : "imported";
  }

  const settings = await readInboxSettingsFromDatabase();
  if (!guard.allowed || !channelEnabled(settings, message.channel) || await isTakeoverActive(threadRef)) {
    return duplicate ? "skipped" : "imported";
  }

  const recentEvents = await readEventsForThreadOrContactFromDatabase({
    threadRef: message.senderId,
    channel: message.channel,
    limit: 12,
  });
  if (duplicate && alreadyHandledInbound(messageKey, recentEvents)) {
    return "skipped";
  }
  const lead = await findLeadInDatabase({ full_name: message.senderName });
  const reply = await generateTheoReply({
    message: message.text,
    lead: lead || result?.lead,
    properties: [],
    recentEvents,
    source: message.channel,
    styleContext: await fetchStyleContext(),
  });
  const routeResult = buildSocialRouterResult({
    channel: message.channel,
    threadRef,
    guard,
    reply,
    reason: reply.handoffReason,
  });
  if (!routeResult.should_send || !shouldAutoSendForChannel(settings, message.channel)) {
    await recordChannelInteraction({
      channel: message.channel,
      direction: "outbound",
      agentName: IRIS_AGENT_NAME,
      phone: message.senderId,
      fullName: message.senderUsername || message.senderName,
      source: "composio",
      sourceDetail,
      threadRef,
      eventType: `${message.channel}_reply_ready`,
      messageText: routeResult.reply,
      summary: routeResult.reason || "Iris prepared a social DM reply.",
      aiAction: "social_dm_reply_ready",
      status: routeResult.needs_human ? "needs_human" : "review_ready",
      handoffReason: routeResult.reason,
      nextAction: "human_review",
    });
    return "imported";
  }

  const sendResult = await sendComposioSocialMessage({
    channel: message.channel as ComposioSocialChannel,
    to: message.senderId,
    body: routeResult.reply,
    mediaUrls: routeResult.media_urls,
    threadRef,
  });
  await recordChannelInteraction({
    channel: message.channel,
    direction: "outbound",
    agentName: IRIS_AGENT_NAME,
    phone: message.senderId,
    fullName: message.senderUsername || message.senderName,
    source: "composio",
    sourceDetail,
    threadRef,
    eventType: `${message.channel}_ai_reply`,
    messageText: routeResult.reply,
    summary: sendResult.ok ? "Iris replied to social DM through Composio." : `Composio send failed: ${sendResult.error}`,
    aiAction: sendResult.ok ? "social_dm_sent" : "social_dm_send_failed",
    status: sendResult.ok ? "sent" : "needs_human",
    handoffReason: sendResult.ok ? "" : sendResult.error,
    nextAction: sendResult.ok ? "monitor_reply" : "human_follow_up",
  });

  return sendResult.ok ? "replied" : "imported";
}

export async function pollComposioSocial(input: {
  userEmail: string;
  channels?: PollChannel[];
  limit?: number;
  sinceMinutes?: number;
}): Promise<ComposioSocialPollResult> {
  const result: ComposioSocialPollResult = { ok: true, checked: 0, imported: 0, replied: 0, skipped: 0, errors: [] };
  const fallbackUserId = composioExternalUserId(input.userEmail);
  const channels = new Set<PollChannel>(input.channels?.length ? input.channels : ["instagram", "messenger"]);
  const limit = Math.max(1, Math.min(input.limit || 10, 50));
  const sinceMinutes = Math.max(1, Math.min(input.sinceMinutes || Number(process.env.COMPOSIO_SOCIAL_POLL_LOOKBACK_MINUTES || 360), 60 * 24 * 30));
  const sinceMs = Date.now() - sinceMinutes * 60 * 1000;
  const status = await listChannelConnections();
  const connections = status.connections
    .filter((connection) =>
      connection.status === "connected"
      && connection.connected_account_id
      && (
        (channels.has("instagram") && connection.channel === "instagram" && connection.provider === "composio_instagram")
        || (channels.has("messenger") && connection.channel === "messenger" && connection.provider === "composio_facebook")
      )
    )
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

  for (const connection of connections) {
    try {
      const userId = connection.external_user_id || fallbackUserId;
      const messages = connection.channel === "instagram"
        ? await instagramMessages(userId, connection, limit)
        : await messengerMessages(userId, connection, limit);
      for (const message of messages.sort((a, b) => Date.parse(a.createdTime || "") - Date.parse(b.createdTime || ""))) {
        result.checked += 1;
        const createdAt = Date.parse(message.createdTime || "");
        if (Number.isFinite(createdAt) && createdAt < sinceMs) {
          result.skipped += 1;
          continue;
        }
        const action = await processMessage(message, connection);
        if (action === "replied") result.replied += 1;
        else if (action === "imported") result.imported += 1;
        else result.skipped += 1;
      }
    } catch (error) {
      result.ok = false;
      result.errors.push(`${connection.channel}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
