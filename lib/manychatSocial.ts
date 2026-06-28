import { mediaProxyUrl } from "@/lib/mediaProxy";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import type { ChannelIngestInput } from "@/lib/channelIngest";
import type { TheoReplyResult } from "@/lib/theoAgent";

export type SocialDmChannel = "messenger" | "instagram";

export type SocialDmRouteReason =
  | "listing_question"
  | "buyer_search"
  | "showing_request"
  | "valuation_request"
  | "seller_lead"
  | "ad_dm"
  | "comment_to_dm"
  | "manual_agent_route";

export type SocialDmPayload = {
  channel: SocialDmChannel | "";
  messageText: string;
  contactId: string;
  threadId: string;
  senderName: string;
  senderUsername: string;
  accountLabel: string;
  routeReason: SocialDmRouteReason | "";
  campaign: string;
  listingAddress: string;
  sourceUrl: string;
};

export type SocialDmGuard = {
  allowed: boolean;
  needsHuman: boolean;
  reason: string;
  intent: string;
};

export type SocialDmRouterResult = {
  ok: boolean;
  channel: SocialDmChannel | "";
  thread_ref: string;
  should_send: boolean;
  needs_human: boolean;
  status: string;
  intent: string;
  reply: string;
  media_urls: string[];
  media_count: number;
  reason: string;
};

export type ManyChatMessage = { type: "text"; text: string } | { type: "image"; url: string };

export type ManyChatDynamicBlock = {
  version: "v2";
  content: {
    type?: "instagram";
    messages: ManyChatMessage[];
    actions: unknown[];
    quick_replies: unknown[];
  };
};

const ALLOWED_ROUTE_REASONS = new Set<SocialDmRouteReason>([
  "listing_question",
  "buyer_search",
  "showing_request",
  "valuation_request",
  "seller_lead",
  "ad_dm",
  "comment_to_dm",
  "manual_agent_route",
]);

const REAL_ESTATE_INTENT = /\b(?:\d{3,6}\s+[a-z0-9 .'-]+|available|availability|price|tour|showing|view it|walkthrough|bed|beds|bath|baths|sqft|square feet|listing|address|property|home|house|condo|buyer|buy|sell|selling|valuation|home value|worth|neighborhood|area|zip|photos?|pictures?|images?)\b/i;
const HANDOFF_INTENT = /\b(?:contract|offer terms|inspection|legal|attorney|lawsuit|commission|representation|mortgage|loan officer|pre.?approved|preapproval|credit score|apr|interest rate|angry|upset|complaint|scam|wtf|fuck|bullshit|human|person|agent|representative)\b/i;
const PERSONAL_SOCIAL = /\b(?:happy birthday|congrats|congratulations|coffee|lunch|party|date|hang out|personal|friend|family|lol|haha|meme|how are you|what's up|whats up)\b/i;

function stringField(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeChannel(value: string): SocialDmChannel | "" {
  const channel = value.trim().toLowerCase();
  if (["instagram", "ig"].includes(channel)) return "instagram";
  if (["messenger", "facebook", "fb"].includes(channel)) return "messenger";
  return "";
}

function normalizeRouteReason(value: string): SocialDmRouteReason | "" {
  const reason = value.trim().toLowerCase().replace(/[\s-]+/g, "_") as SocialDmRouteReason;
  return ALLOWED_ROUTE_REASONS.has(reason) ? reason : "";
}

export function socialDmAgentEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(String(process.env.ENABLE_SOCIAL_DM_AGENT || "").trim().toLowerCase());
}

export function normalizeManyChatPayload(payload: Record<string, unknown>): SocialDmPayload {
  const channel = normalizeChannel(stringField(payload, "channel", "platform", "source_channel"));
  const messageText = stringField(payload, "message_text", "messageText", "last_text_input", "text", "body", "message");
  const contactId = stringField(payload, "contact_id", "contactId", "subscriber_id", "subscriberId", "sender_id", "senderId", "id");
  const threadId = stringField(payload, "thread_id", "threadId", "conversation_id", "conversationId") || contactId;
  return {
    channel,
    messageText,
    contactId,
    threadId,
    senderName: stringField(payload, "sender_name", "senderName", "name", "full_name", "fullName"),
    senderUsername: stringField(payload, "sender_username", "senderUsername", "username", "handle"),
    accountLabel: stringField(payload, "account_label", "accountLabel", "page_name", "pageName"),
    routeReason: normalizeRouteReason(stringField(payload, "route_reason", "routeReason", "intent")),
    campaign: stringField(payload, "campaign", "flow", "flow_name", "flowName"),
    listingAddress: stringField(payload, "listing_address", "listingAddress", "address", "property_address", "propertyAddress"),
    sourceUrl: stringField(payload, "source_url", "sourceUrl", "url", "permalink"),
  };
}

export function socialThreadRef(input: Pick<SocialDmPayload, "channel" | "threadId" | "contactId" | "senderUsername">): string {
  const id = input.threadId || input.contactId || input.senderUsername || "unknown";
  return `${input.channel || "social"}:${id}`;
}

export function shouldTheoHandleSocialDm(input: SocialDmPayload): SocialDmGuard {
  const text = [input.messageText, input.listingAddress, input.routeReason, input.campaign].filter(Boolean).join(" ");
  const intent = input.routeReason || (REAL_ESTATE_INTENT.test(text) ? "real_estate_intent" : "");
  if (!input.channel || !["messenger", "instagram"].includes(input.channel)) {
    return { allowed: false, needsHuman: true, reason: "Unsupported social channel", intent: "" };
  }
  if (!input.contactId && !input.threadId) {
    return { allowed: false, needsHuman: true, reason: "Missing ManyChat contact or thread id", intent };
  }
  if (!input.messageText.trim()) {
    return { allowed: false, needsHuman: true, reason: "Missing social DM text", intent };
  }
  if (HANDOFF_INTENT.test(input.messageText)) {
    return { allowed: false, needsHuman: true, reason: "Sensitive or human-required social DM", intent: intent || "human_required" };
  }
  if (PERSONAL_SOCIAL.test(input.messageText) && !input.routeReason) {
    return { allowed: false, needsHuman: true, reason: "Personal or general social DM", intent: "personal_social" };
  }
  if (input.routeReason || REAL_ESTATE_INTENT.test(text)) {
    return { allowed: true, needsHuman: false, reason: "", intent: intent || "real_estate_intent" };
  }
  return { allowed: false, needsHuman: true, reason: "Low-confidence social DM route", intent: "low_confidence" };
}

export function socialDmIngestInput(input: SocialDmPayload, guard: SocialDmGuard): ChannelIngestInput {
  const threadRef = socialThreadRef(input);
  const sourceDetail = [
    input.accountLabel ? `account ${input.accountLabel}` : "",
    input.routeReason ? `route ${input.routeReason}` : "",
    input.campaign ? `campaign ${input.campaign}` : "",
    input.sourceUrl ? `source ${input.sourceUrl}` : "",
  ].filter(Boolean).join("; ");
  return {
    channel: input.channel as SocialDmChannel,
    agentName: IRIS_AGENT_NAME,
    fullName: input.senderName,
    phone: input.contactId || input.threadId,
    source: "manychat",
    sourceDetail,
    threadRef,
    eventType: `${input.channel}_inbound`,
    messageText: input.messageText,
    summary: input.messageText ? `Inbound ${input.channel} DM: ${input.messageText}` : `Inbound ${input.channel} DM received.`,
    propertyInterest: input.listingAddress,
    preferredChannel: input.channel,
    intent: guard.intent,
    aiAction: guard.allowed ? "social_dm_routed" : "social_dm_handoff",
    handoffStatus: guard.needsHuman ? "needs_human" : "",
    handoffReason: guard.reason,
    nextAction: guard.allowed ? "reply_with_theo" : "human_follow_up",
    status: guard.allowed ? "received" : "needs_human",
  };
}

function maxSocialImages(): number {
  const value = Number(process.env.SOCIAL_DM_MAX_IMAGES || process.env.WHATSAPP_MAX_IMAGES || process.env.SMS_MAX_IMAGES || "3");
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 10)) : 3;
}

export function socialMediaUrls(mediaUrls: string[] = [], baseUrl?: string): string[] {
  return mediaUrls
    .map((url) => mediaProxyUrl(url, baseUrl))
    .filter((url) => /^https:\/\//i.test(url))
    .slice(0, maxSocialImages());
}

export function buildSocialRouterResult(input: {
  channel?: SocialDmChannel | "";
  threadRef?: string;
  guard?: SocialDmGuard;
  reply?: Partial<TheoReplyResult>;
  reason?: string;
  baseUrl?: string;
}): SocialDmRouterResult {
  const reply = input.reply;
  const needsHuman = Boolean(input.guard?.needsHuman || reply?.status === "needs_human" || reply?.handoffReason);
  const sendable = Boolean(reply?.shouldSend && reply.reply);
  const mediaUrls = sendable ? socialMediaUrls(reply?.mediaUrls || [], input.baseUrl) : [];
  return {
    ok: true,
    channel: input.channel || "",
    thread_ref: input.threadRef || "",
    should_send: sendable,
    needs_human: needsHuman,
    status: sendable ? "ready_to_send" : needsHuman ? "needs_human" : "skipped",
    intent: reply?.classification?.intent || input.guard?.intent || "",
    reply: sendable ? String(reply?.reply || "") : "",
    media_urls: mediaUrls,
    media_count: mediaUrls.length,
    reason: input.reason || input.guard?.reason || reply?.handoffReason || "",
  };
}

export function formatManyChatDynamicBlock(result: SocialDmRouterResult): ManyChatDynamicBlock {
  const messages: ManyChatMessage[] = [];
  if (result.should_send && result.reply) {
    messages.push({ type: "text", text: result.reply });
    for (const url of result.media_urls) {
      messages.push({ type: "image", url });
    }
  }
  const content: ManyChatDynamicBlock["content"] = {
    messages,
    actions: [],
    quick_replies: [],
  };
  if (result.channel === "instagram") content.type = "instagram";
  return { version: "v2", content };
}
