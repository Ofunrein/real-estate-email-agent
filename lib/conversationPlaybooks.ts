import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

export type ConversationScenarioId =
  | "seller_valuation"
  | "buyer_listing_details"
  | "buyer_property_search"
  | "schedule_showing"
  | "shared_media_reference"
  | "service_area_check"
  | "lead_profile_capture";

export type ConversationScenario = {
  id: ConversationScenarioId;
  confidence: number;
  reason: string;
  requiredContext: string[];
  nextBestAction: string;
};

export type ChannelTone = {
  maxChars: number;
  allowBullets: boolean;
  allowMedia: boolean;
  cta: string;
};

const CHANNEL_TONE: Record<string, ChannelTone> = {
  sms: { maxChars: 480, allowBullets: false, allowMedia: true, cta: "Ask one simple next question or offer a showing/valuation slot." },
  whatsapp: { maxChars: 700, allowBullets: false, allowMedia: true, cta: "Keep it warm, direct, and confirm preferred next step." },
  instagram: { maxChars: 420, allowBullets: false, allowMedia: true, cta: "Short DM. Offer details/photos or ask one qualifier." },
  messenger: { maxChars: 500, allowBullets: false, allowMedia: true, cta: "Short DM. Offer details/photos or showing times." },
  website_chat: { maxChars: 700, allowBullets: true, allowMedia: true, cta: "Answer directly, then offer tour/valuation." },
  email: { maxChars: 1800, allowBullets: true, allowMedia: true, cta: "Give fuller context and one clear CTA." },
};

function clean(value?: string): string {
  return String(value || "").trim();
}

function hasMedia(event: Partial<SheetRow>): boolean {
  if (clean(event.media_json) && clean(event.media_json) !== "[]") return true;
  return /(?:image|photo|video|reel|attachment|voice note|audio):/i.test(clean(event.message_text));
}

export function detectConversationScenario(input: {
  message?: string;
  event?: Partial<SheetRow>;
  lead?: Partial<SheetRow>;
}): ConversationScenario {
  const message = clean(input.message || input.event?.message_text || input.event?.summary || input.lead?.summary);
  const leadText = [input.lead?.intent, input.lead?.lead_role, input.lead?.property_interest, input.lead?.summary, input.lead?.next_action].map(clean).join(" ");
  const text = `${message} ${leadText}`.toLowerCase();
  const media = hasMedia(input.event || {});

  if (/\b(sell|seller|home value|valuation|what'?s it worth|worth|list my|estimate)\b/i.test(text)) {
    return {
      id: "seller_valuation",
      confidence: media ? 0.92 : 0.86,
      reason: media ? "Seller/valuation language with media context" : "Seller/valuation language",
      requiredContext: ["address_or_property_interest", "avm_or_comp_lookup", "service_area", "calendar_availability"],
      nextBestAction: "Give cautious value range context, mention visible/media condition if known, then offer valuation appointment.",
    };
  }

  if (/\b(still available|on market|price|how much|details|specs|layout|beds?|baths?|sqft|photos?)\b/i.test(text)) {
    return {
      id: "buyer_listing_details",
      confidence: 0.84,
      reason: "Listing detail or availability question",
      requiredContext: ["property_match", "availability", "price_specs", "photos_or_listing_url"],
      nextBestAction: "Answer exact listing question first, then offer full details/photos or a showing.",
    };
  }

  if (/\b(similar|like this|same style|same layout|other options|alternatives|under|budget|bed|bath|area|neighborhood)\b/i.test(text) || media) {
    return {
      id: media ? "shared_media_reference" : "buyer_property_search",
      confidence: media ? 0.8 : 0.76,
      reason: media ? "Shared media likely describes desired property vibe" : "Buyer search criteria",
      requiredContext: media ? ["media_understanding", "property_search_criteria", "matching_listings"] : ["budget", "beds_baths", "area", "matching_listings"],
      nextBestAction: "Translate vibe/criteria into search filters, send best matches, and ask one missing qualifier.",
    };
  }

  if (/\b(schedule|book|tour|showing|see it|walk.?through|available tomorrow|saturday|morning|afternoon)\b/i.test(text)) {
    return {
      id: "schedule_showing",
      confidence: 0.82,
      reason: "Scheduling/showing language",
      requiredContext: ["property_match", "calendar_availability", "contact_identity"],
      nextBestAction: "Resolve vague availability into concrete slots, book/hold only with enough identity, then confirm.",
    };
  }

  if (!clean(input.lead?.email) || !clean(input.lead?.phone) || !clean(input.lead?.full_name)) {
    return {
      id: "lead_profile_capture",
      confidence: 0.62,
      reason: "Missing core lead profile fields",
      requiredContext: ["name", "phone_or_email", "preferred_channel"],
      nextBestAction: "Keep helping in-channel, then lightly ask for one missing contact field only when useful.",
    };
  }

  return {
    id: "buyer_property_search",
    confidence: 0.5,
    reason: "Default real estate conversation",
    requiredContext: ["intent", "property_or_search_criteria"],
    nextBestAction: "Answer directly and ask one useful qualifier.",
  };
}

export function channelTone(channel: Channel | string): ChannelTone {
  return CHANNEL_TONE[channel] || CHANNEL_TONE.sms;
}

export function sharedBrainInstruction(input: { channel: Channel | string; scenario: ConversationScenario }): string {
  const tone = channelTone(input.channel);
  return [
    `Scenario: ${input.scenario.id} (${Math.round(input.scenario.confidence * 100)}% confidence).`,
    `Required context before strong claim/action: ${input.scenario.requiredContext.join(", ")}.`,
    `Next best action: ${input.scenario.nextBestAction}`,
    `Channel style: max ${tone.maxChars} chars, ${tone.allowBullets ? "bullets allowed" : "no bullets"}, ${tone.allowMedia ? "media/cards allowed" : "text only"}.`,
    tone.cta,
    "Never invent price, availability, owner, valuation, or booked appointment. If context is missing, ask one concise question or run the matching tool path first.",
  ].join("\n");
}
