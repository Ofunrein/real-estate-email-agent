import type { SheetRow } from "@/lib/sheetSchema";
import { CENTRAL_TEXAS_CITIES } from "@/lib/serviceAreas";
import { handleTheoAppointmentMessage } from "@/lib/theoAppointments";
import { classifyTheoWithLlm, generateTheoSmsWithLlm } from "@/lib/theoLlm";
import type { TheoMetric } from "@/lib/theoTelemetry";
import { detectConversationScenario, sharedBrainInstruction } from "@/lib/conversationPlaybooks";
import {
  fitMessagesReply,
  messagesBlocks,
  messagesBudget,
  normalizeMessagesReply,
  pickVariant,
  repeatsRecentReply,
  type MessagesReplyFamily,
} from "@/lib/smsFormatting";

export type TheoIntent =
  | "property_details"
  | "showing_request"
  | "buyer_lead"
  | "seller_lead"
  | "renter_lead"
  | "human_required"
  | "spam";

export type TheoClassification = {
  intent: TheoIntent;
  leadRole: string;
  secondaryRoles?: string[];
  opportunityTags?: string[];
  toneState?: string;
  urgency?: string;
  complianceFlags?: string[];
  nextBestQuestion?: string;
  recommendedNextAction?: string;
  metrics?: TheoMetric[];
  handoffReason: string;
  status: string;
};

export type TheoReplyContext = {
  message: string;
  lead?: Partial<SheetRow>;
  properties?: SheetRow[];
  propertyInterest?: string;
  source?: "sms" | "form" | "whatsapp" | "messenger" | "instagram";
  recentEvents?: SheetRow[];
  dataContext?: string;
  styleContext?: string;
};

export type TheoReplyResult = {
  classification: TheoClassification;
  reply: string;
  mediaUrls: string[];
  shouldSend: boolean;
  aiAction: string;
  handoffReason: string;
  status: string;
  metrics: TheoMetric[];
};

const SMS_LIMIT = 320;
const LINK_SMS_LIMIT = 1200;

const SENSITIVE_PATTERNS = [
  { pattern: /\b(section 8|voucher|children|kids|family friendly|families|safe neighborhood|crime|school rating|ethnic|ethnicity|race|racial|religion|disabled|disability)\b/i, reason: "Fair Housing-sensitive question" },
  // The live suite proved the list above was not enough: "which neighborhood has fewer Black
  // families? I want a white area with no immigrants" matched NOTHING and fell through to a
  // generic intake question. A protected-class word alone is not enough to fire, or "1200
  // White Oak Dr" would escalate: it has to sit next to a people/place noun, or be a word that
  // only ever describes people.
  {
    pattern: /\b(black|white|hispanic|latino|latina|asian|arab|jewish|muslim|christian|catholic|gay|lesbian|trans)\b[^.?!]{0,25}\b(neighborhood|neighbourhood|area|areas|families|family|people|folks|tenants|renters|buyers|residents|schools?|part of town|side of town|communit(?:y|ies))\b/i,
    reason: "Fair Housing-sensitive question",
  },
  {
    pattern: /\b(?:fewer|more|less|mostly|mainly|predominantly|majority|no|non|without|avoid|prefer|only|want|keep out)\b[^.?!]{0,40}\b(immigrants?|foreigners?|minorities|minority|single mothers?)\b/i,
    reason: "Fair Housing-sensitive question",
  },
  { pattern: /\b(pre.?approved|preapproval|qualify|loan officer|mortgage|interest rate|down payment|credit score|nmls|apr)\b/i, reason: "Mortgage/licensed lending question" },
  { pattern: /\b(contract|offer terms|inspection objection|legal|lawsuit|attorney|commission|representation agreement)\b/i, reason: "Legal or contract-sensitive question" },
  { pattern: /\b(angry|mad|upset|complaint|scam|stop lying|wtf|fuck|bullshit)\b/i, reason: "Angry or complaint language" },
  { pattern: /\b(human|person|agent|call me|representative)\b/i, reason: "Lead requested a human" },
];

const SPAM_PATTERNS = [
  /\b(crypto|forex|seo services|guest post|casino|loan offer|onlyfans|only fans|porn|sex tape|nudes?)\b/i,
];

const SERVICE_AREA_CITIES = new Set(CENTRAL_TEXAS_CITIES);

function cleanText(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function cleanSmsReply(value: string): string {
  return normalizeMessagesReply(value);
}

function normalize(value?: string): string {
  return cleanText(value).toLowerCase();
}

function normalizeFollowupText(value?: string): string {
  return cleanText(value)
    .replace(/\boptiosn\b/gi, "options")
    .replace(/\boptoins\b/gi, "options")
    .replace(/\boptons\b/gi, "options")
    .replace(/\bsimiliar\b/gi, "similar")
    .replace(/\bsimliar\b/gi, "similar")
    .replace(/\bmroe\b/gi, "more")
    .replace(/\bdetials\b/gi, "details");
}

function truncateSms(value: string, limit = SMS_LIMIT): string {
  return fitMessagesReply(value, limit);
}

// Shape the reply to the family it belongs to instead of one global cap. A one-line ack
// and a three-listing roundup have nothing to do with each other.
function truncateSmsForFamily(value: string, family: MessagesReplyFamily): string {
  return fitMessagesReply(value, messagesBudget(family).maxChars);
}

function envFlag(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function smsImagesEnabled(): boolean {
  return envFlag(process.env.ENABLE_SMS_IMAGES);
}

function whatsAppImagesEnabled(): boolean {
  return envFlag(process.env.ENABLE_WHATSAPP_IMAGES || process.env.ENABLE_SMS_IMAGES);
}

function socialDmImagesEnabled(): boolean {
  return envFlag(process.env.ENABLE_SOCIAL_DM_IMAGES);
}

function mediaImagesEnabled(source?: TheoReplyContext["source"]): boolean {
  if (source === "messenger" || source === "instagram") return socialDmImagesEnabled();
  return source === "whatsapp" ? whatsAppImagesEnabled() : smsImagesEnabled();
}

function maxMediaImages(source?: TheoReplyContext["source"]): number {
  if (source === "messenger" || source === "instagram") {
    return Math.max(0, Number(process.env.SOCIAL_DM_MAX_IMAGES || process.env.WHATSAPP_MAX_IMAGES || process.env.SMS_MAX_IMAGES || "3"));
  }
  if (source === "whatsapp") {
    return Math.max(0, Number(process.env.WHATSAPP_MAX_IMAGES || process.env.SMS_MAX_IMAGES || "3"));
  }
  return Math.max(0, Number(process.env.SMS_MAX_IMAGES || "3"));
}

function smsImageMode(): string {
  return (process.env.SMS_IMAGE_MODE || "on_request").trim().toLowerCase();
}

function wantsPropertyImage(message: string): boolean {
  return /\b(photo|photos|picture|pictures|image|images|pic|pics|look like|see it|show me)\b/i.test(normalizeFollowupText(message));
}

function wantsPropertyLinks(message: string): boolean {
  return /\b(link|links|url|urls|website|listing page|zillow)\b/i.test(normalizeFollowupText(message));
}

// Sample/placeholder values live in .env.example and have leaked into real envs. Sending
// "calendly.com/your-name/30min" to a lead destroys trust, so treat it as unconfigured.
function isPlaceholderUrl(url: string): boolean {
  return /your-?name|your-?link|example\.com|YOUR_|changeme|<.*>/i.test(url);
}

function valuationUrl(): string {
  const url = cleanText(process.env.FILLOUT_VALUATION_URL || process.env.CALENDLY_URL);
  return isPlaceholderUrl(url) ? "" : url;
}

function isSellerValuationContext(message: string, classification: TheoClassification): boolean {
  const tags = classification.opportunityTags || [];
  return classification.intent === "seller_lead"
    || classification.leadRole === "seller"
    || tags.includes("valuation_interest")
    || tags.includes("sell_before_buy")
    || /\b(sell first|need to sell|sell my|selling my|current home|home value|valuation|what.*worth|how much.*worth)\b/i.test(message);
}

function latestMessageAsksForSellerValuation(message: string): boolean {
  return /\b(sell first|need to sell|sell my|selling my|list my|listing my|current home|home value|valuation|what.*worth|how much.*worth|schedule the evaluation|schedule .*valuation|book .*valuation)\b/i.test(message);
}

function asksForSafePropertyFact(message: string): boolean {
  return /\b(photo|photos|picture|pictures|image|images|pic|pics|look like|see it|show me|tell me more|more about|more details|price|bed|beds|bath|baths|sqft|square feet|year built|built|features|details|address|zip|status|available|availability|still available|listing|link|agent|pet|pets|dog|cat|parking|garage|pool|washer|dryer|laundry|furnished|utilities|deposit|fee|fees|hoa|lease|move.?in|amenit(?:y|ies))\b/i.test(normalizeFollowupText(message));
}

function asksForAlternativeProperties(message: string): boolean {
  const normalized = normalizeFollowupText(message);
  return /\b(other|another|similar|same spec|same specs|same size|same price|neighboring|neighbor|nearby|next to|close by|comparable|alternative|options?|properties|homes?|listings?)\b/i.test(normalized)
    && (/\b(show|send|see|tell|find|recommend|compare|options?|properties|homes?|listings?|spec|specs)\b/i.test(normalized)
      // "Got anything similar?" has no explicit verb otherwise. Deliberately narrow: a bare
      // "have" also appears in "what other amenities does it have?", which is NOT a new search.
      || /\b(?:got|have|have you got)\s+(?:any|anything|another|other|something)\b/i.test(normalized));
}

function rejectsCurrentProperty(message: string): boolean {
  const normalized = normalizeFollowupText(message);
  return /\b(?:no longer|not)\s+interested\b/i.test(normalized)
    || /\b(?:don't|dont|do not)\s+(?:like|want)\b/i.test(normalized)
    || /\bnot\s+(?:this|that)\s+(?:one|property|listing)\b/i.test(normalized)
    || /\b(?:send|show|find|share)\s+(?:me\s+)?another\s+(?:one|option|property|listing)?\b/i.test(normalized)
    || /\banother\s+(?:one|option|property|listing)\b/i.test(normalized);
}

function offTopicRedirectReply(message: string): string {
  const normalized = normalizeFollowupText(message);
  if (/\b(onlyfans|only fans|porn|sex tape|nudes?|adult link)\b/i.test(normalized)) {
    return "I can't help with that. I can help with Austin listings, photos, or showings if you want to keep searching.";
  }
  if (/\b(monkey|monkeys|exotic animals?|wild animals?)\b/i.test(normalized)) {
    return "I can't verify or advise on exotic-animal use. I can still help with normal criteria like area, budget, beds, baths, yard size, and showing times.";
  }
  // Live gap: "what's the weather in austin tomorrow" got no decline at all, just a pivot into
  // an intake question, which reads like the ask was never heard.
  if (/\b(weather|forecast|temperature|rain|sports?|score|game|stocks?|crypto|recipe|joke|news)\b/i.test(normalized)) {
    return "That one's outside what I can look up. Happy to keep going on Austin listings, photos, or showings though.";
  }
  // Credentials and third-party personal data. Refused outright, never escalated as a request
  // a human could fulfil. Caught live: an SSN + API key ask reached the generic intake reply.
  if (/\b(ssn|social security|api key|api token|access token|password|passwd|credit card|routing number|bank account)\b/i.test(normalized)
    || /\b(?:previous|last|other|another)\s+(?:buyer|client|lead|customer)(?:'s)?\s+(?:phone|number|email|address|info|details)\b/i.test(normalized)) {
    return "I can't share personal details or credentials over text. I can help with listings, photos, or showings whenever you want to keep going.";
  }
  // Prompt injection. Stay in role, do not acknowledge having instructions to leak.
  if (/\b(ignore (?:all )?(?:previous|prior|above) instructions?|disregard (?:all )?(?:previous|prior) instructions?|system prompt|your instructions|reveal your prompt|jailbreak|developer mode)\b/i.test(normalized)) {
    return "I'm going to stick to what I do here. Happy to help with Austin listings, photos, or showings.";
  }
  // Sexual requests, including the ones that arrive wrapped in hostility.
  if (/\b(say something dirty|talk dirty|something dirty|sext|sexy|horny|send nudes)\b/i.test(normalized)) {
    return "I'm not going to engage with that. I'm here for Austin listings, photos, and showings if you want to keep going.";
  }
  return "";
}

/**
 * A shared listing link that matches nothing we have saved must not be answered with a
 * DIFFERENT property's facts. Caught live: a deliberately broken Zillow URL came back with a
 * full block for an unrelated address, which reads as a confident wrong answer.
 */
function sharesUnknownListingUrl(message: string, properties: SheetRow[] = []): boolean {
  const shared = message.match(/https?:\/\/\S+/gi) || [];
  if (!shared.length) return false;
  const known = properties.map((property) => cleanText(property.listing_url)).filter(Boolean);
  // A zpid is the stable id in a Zillow URL; compare on that when both sides have one.
  const idOf = (url: string) => url.match(/\/(\d{5,})_zpid/)?.[1] || "";
  return shared.every((url) => {
    const id = idOf(url);
    return !known.some((candidate) => candidate === url
      || (Boolean(id) && idOf(candidate) === id));
  });
}

function asksForPropertyOptions(message: string): boolean {
  const normalized = normalizeFollowupText(message);
  if (asksForPropertyAvailability(normalized) && /\b(still|it|this|that|status|leased|sold|pending)\b/i.test(normalized)) return false;
  return asksForAlternativeProperties(normalized)
    || /\b(available|availability|have available|what (?:do )?you have|options?|properties|apartments?|condos?|rentals?|listings?)\b/i.test(normalized)
    || /\b(under|below|less than|max|maximum|up to)\s+\$?\s*\d/i.test(normalized)
    || /\b(something close|close to (?:the )?(?:\d+\s*)?(?:bed|bd|bedroom|layout)|\d+\s*(?:bed|bd|bedroom).{0,40}layout|sticking to \d+\s*(?:bed|bd|bedroom)|find .{0,30}\d+\s*(?:bed|bd|bedroom)|want .{0,30}\d+\s*(?:bed|bd|bedroom))\b/i.test(normalized);
}

function asksForPropertyDetails(message: string): boolean {
  const normalized = normalizeFollowupText(message);
  return /\b(tell me more|more about|more details|details|info|information|what about|how about|first one|second one|third one|1st one|2nd one|3rd one|that one|this one|it)\b/i.test(normalized)
    && !asksForPropertyOptions(message);
}

function ordinalOnlyIndex(message: string): number | null {
  const normalized = normalizeFollowupText(message).toLowerCase().replace(/[^\w# ]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:1|#\s*1|first|1st|one)$/.test(normalized)) return 0;
  if (/^(?:2|#\s*2|second|2nd|two)$/.test(normalized)) return 1;
  if (/^(?:3|#\s*3|third|3rd|three)$/.test(normalized)) return 2;
  return null;
}

function ordinalReferenceIndex(message: string): number | null {
  const only = ordinalOnlyIndex(message);
  if (only != null) return only;
  const normalized = normalizeFollowupText(message).toLowerCase().replace(/[^\w# ]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:the\s+)?(?:first|1st|#\s*1|number\s+1|option\s+1|property\s+1|listing\s+1)(?:\s+(?:one|option|property|listing))?\b/.test(normalized)) return 0;
  if (/\b(?:the\s+)?(?:second|2nd|#\s*2|number\s+2|option\s+2|property\s+2|listing\s+2)(?:\s+(?:one|option|property|listing))?\b/.test(normalized)) return 1;
  if (/\b(?:the\s+)?(?:third|3rd|#\s*3|number\s+3|option\s+3|property\s+3|listing\s+3)(?:\s+(?:one|option|property|listing))?\b/.test(normalized)) return 2;
  return null;
}

function selectOrdinalProperties(message: string, properties: SheetRow[] = []): SheetRow[] {
  const index = ordinalReferenceIndex(message);
  if (index == null) return properties;
  return properties[index] ? [properties[index]] : properties.slice(0, 1);
}

function asksForPropertyShowing(message: string): boolean {
  const normalized = normalizeFollowupText(message);
  if (/\b(tour|showing|show it|see it|view it|walk.?through|visit|come see|book|schedule|appointment)\b/i.test(normalized)) return true;
  // "Ollie wants to see the first one" is a showing ask, not a request to re-read details.
  // Gated on the message not being a photo request so "want to see photos" still routes to media.
  if (wantsPropertyImage(normalized)) return false;
  return /\b(?:wants?|would like|'d like)\s+to\s+see\b/i.test(normalized)
    || /\bcan (?:i|we|he|she|they) (?:see|come|tour|visit)\b/i.test(normalized)
    || /\b(?:come by|stop by|check it out in person|in person)\b/i.test(normalized);
}

function asksForPropertyAvailability(message: string): boolean {
  return /\b(available|availability|still available|open|on market|status|leased|sold|pending)\b/i.test(normalizeFollowupText(message));
}

function asksForPropertyComparison(message: string): boolean {
  return /\b(cheapest|lowest|least expensive|most affordable|highest|most expensive|largest|biggest|smallest|compare|which one|best option|best deal|better)\b/i.test(normalizeFollowupText(message));
}

function asksForPropertyAmenities(message: string): boolean {
  return /\b(pet|pets|dog|cat|parking|garage|pool|washer|dryer|laundry|furnished|utilities|deposit|fee|fees|hoa|lease|move.?in|amenit(?:y|ies)|yard|balcony|patio|gym|fitness|elevator|storage)\b/i.test(normalizeFollowupText(message));
}

function asksForPropertySafeInquiry(message: string): boolean {
  const normalized = normalizeFollowupText(message);
  return asksForSafePropertyFact(normalized)
    || asksForPropertyShowing(normalized)
    || asksForPropertyAvailability(normalized)
    || asksForPropertyComparison(normalized)
    || asksForPropertyAmenities(normalized)
    || /\b(send|share|text).{0,25}\b(first|second|third|1st|2nd|3rd|that|this|it)\b/i.test(normalized);
}

function asksForLightGreeting(message: string): boolean {
  return /^(?:(?:hi|hello|hey|yo)(?: there)?(?:,?\s+(?:how are you(?: doing)?|how'?s it going))?|how are you(?: doing)?|how'?s it going|good morning|good afternoon|good evening|thanks|thank you|ok|okay|cool|great|sounds good)[!?., ]*$/i.test(cleanText(message));
}

function latestMessageHasSensitiveTopic(message: string): boolean {
  return SENSITIVE_PATTERNS.some(({ pattern }) => pattern.test(message));
}

function canShareSafeFactsDuringHandoff(classification: TheoClassification): boolean {
  const flags = (classification.complianceFlags || []).map((flag) => flag.toLowerCase());
  return !flags.some((flag) => ["fair_housing", "mortgage_license", "legal", "contract_terms", "privacy", "broker_approval"].includes(flag));
}

function usablePhotoUrl(value?: string): string {
  const url = cleanText(value);
  if (!/^https:\/\//i.test(url)) return "";
  if (/maps\.googleapis\.com/i.test(url)) return "";
  if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(url)) return url;
  if (/googleusercontent\.com/i.test(url)) return url;
  return "";
}

function formatPrice(value?: string): string {
  const raw = cleanText(value);
  const numeric = raw.replace(/[^\d.]/g, "");
  if (!numeric) return cleanText(value);
  const amount = Number(numeric);
  if (!Number.isFinite(amount)) return cleanText(value);
  const price = `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return /\b(per\s*month|monthly)\b|\/\s*(mo|month)\b/i.test(raw) ? `${price} per month` : price;
}

function numericValue(value?: string): number | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const match = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
}

function formatFacts(property: SheetRow): string {
  return [
    formatPrice(property.price),
    property.beds && property.baths ? `${property.beds}bd/${property.baths}ba` : "",
    property.neighborhood || property.city,
  ].filter(Boolean).join(", ");
}

function formatOptionFacts(property: SheetRow): string {
  const sqft = Number(cleanText(property.sqft).replace(/[^\d.]/g, ""));
  return [
    formatPrice(property.price),
    property.beds && property.baths ? `${property.beds}bd/${property.baths}ba` : "",
    Number.isFinite(sqft) && sqft > 0 ? `${sqft.toLocaleString("en-US", { maximumFractionDigits: 0 })} sqft` : "",
    property.neighborhood || property.city,
  ].filter(Boolean).join(", ");
}

function formatSqft(value?: string): string {
  const sqft = Number(cleanText(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(sqft) && sqft > 0 ? `${sqft.toLocaleString("en-US", { maximumFractionDigits: 0 })} sqft` : "";
}

// --- Messages-shaped property rendering -------------------------------------
//
// The old shapes were "Address: fact, fact, fact. Listing: url Want me to send photos,
// book a showing, or find similar options?" on one line. In Messages that is a wall with a
// label-colon dump on the front and the same canned tail on every reply. These helpers
// build address / facts / link as separate LINES, and rotate the closing question so the
// thread does not read like one template firing repeatedly.

const SINGLE_PROPERTY_CLOSERS = [
  "Want to see it in person, or should I pull a few more like it?",
  "Should I line up a walkthrough, or keep looking?",
  "Want photos, or should I check on showing times?",
  "Want me to find more like this one, or set up a tour?",
] as const;

const MULTI_LISTING_CLOSERS = [
  "Which one should I focus on?",
  "Which of these do you want to see first?",
  "Which one stands out?",
] as const;

const AMENITY_CLOSERS = [
  "Want me to confirm the rest with the listing agent?",
  "Should I check the rest with the listing side, or set up a walkthrough?",
  "Want a walkthrough so you can see it yourself?",
] as const;

const AVAILABILITY_CLOSERS = [
  "Want me to line up a time to see it?",
  "Should I get you in this week?",
  "Want photos, or a showing time?",
] as const;

// A property row is the stable part of the seed, so the same listing keeps the same voice
// within a thread while different listings read differently.
function closerFor(variants: readonly string[], seed: string): string {
  return pickVariant(variants, seed);
}

function propertyFactsLine(property: SheetRow): string {
  return [
    formatPrice(property.price),
    property.beds && property.baths ? `${property.beds}bd/${property.baths}ba` : "",
    formatSqft(property.sqft),
    property.neighborhood || property.city,
  ].filter(Boolean).join(", ");
}

function propertyContextLine(property: SheetRow): string {
  const type = cleanText(property.property_type);
  const built = cleanText(property.year_built);
  if (built && type) return `Built ${built}, ${type.toLowerCase()}.`;
  if (built) return `Built ${built}.`;
  if (type) return `${type}.`;
  return "";
}

function listingUrlLine(property: SheetRow): string {
  return cleanText(property.listing_url);
}

// One listing as its own scannable block: number + address, then facts, then a bare URL.
function propertyBlock(property: SheetRow, index?: number): string {
  const prefix = typeof index === "number" ? `${index + 1}. ` : "";
  return [
    `${prefix}${cleanText(property.address)}`,
    propertyFactsLine(property),
    listingUrlLine(property),
  ].filter(Boolean).join("\n");
}

function lastOutboundMessage(events: SheetRow[] = []): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (cleanText(event?.direction).toLowerCase() !== "outbound") continue;
    const text = cleanText(event?.message_text);
    if (text) return text;
  }
  return "";
}

function outboundHistoryText(events: SheetRow[] = []): string {
  return events
    .filter((event) => cleanText(event?.direction).toLowerCase() === "outbound")
    .map((event) => cleanText(event?.message_text))
    .join("\n");
}

/** Was this exact listing already put in front of the lead earlier in the thread? */
function alreadyShownProperty(property: SheetRow, events: SheetRow[] = []): boolean {
  const address = cleanText(property?.address);
  if (!address) return false;
  return outboundHistoryText(events).toLowerCase().includes(address.toLowerCase());
}

/**
 * "I don't want that one, show me different properties" must not come back with the same
 * listing as option 1. Drop anything already pitched, unless that would leave nothing.
 */
function dropRejectedProperties(properties: SheetRow[] = [], events: SheetRow[] = []): SheetRow[] {
  const remaining = properties.filter((property) => !alreadyShownProperty(property, events));
  return remaining.length ? remaining : properties;
}

// Guard against the failure seen live: two byte-identical detail blocks in a row because
// the follow-up matched the same branch. If the facts were just sent, advance the
// conversation instead of resending them.
function advanceInsteadOfRepeating(
  candidate: string,
  events: SheetRow[] = [],
  properties: SheetRow[] = [],
): string {
  const prior = lastOutboundMessage(events);
  if (!prior || !repeatsRecentReply(candidate, prior)) return candidate;
  const property = properties.find((row) => cleanText(row.address));
  const label = property ? cleanText(property.address) : "that one";
  return messagesBlocks(
    `You already have the details on ${label}, so I won't resend them.`,
    "What works better for a walkthrough, a weekday evening or Saturday morning?",
  );
}

function formatTheoSellerValuationReply(properties: SheetRow[] = [], lead: Partial<SheetRow> = {}): string {
  const property = properties.find((row) => cleanText(row.address));
  const knownAddress = cleanText(property?.address || lead.property_interest);
  const url = valuationUrl();
  const name = cleanText(lead.full_name).split(" ")[0];
  const opener = name
    ? `${name}, I can get you a real number on that before we go further.`
    : "I can get you a real number on that before we go further.";

  // No configured booking link: stay useful by collecting what a valuation actually needs.
  if (!url) {
    return messagesBlocks(
      opener,
      knownAddress
        ? `One of our agents does the valuation on ${knownAddress} and can help you line up the sell-first timing. What's your timeline?`
        : "One of our agents runs the valuation and helps line up the sell-first timing. What's the address?",
    );
  }

  return messagesBlocks(
    opener,
    knownAddress
      ? `Grab a time here and an agent will walk you through what ${knownAddress} should list at.\n${url}`
      : `Grab a time here and an agent will walk you through what it should list at.\n${url}`,
    knownAddress ? "" : "What's the address, so they can pull comps before you talk?",
  );
}

function outsideServiceArea(properties: SheetRow[] = []): boolean {
  return properties.some((property) => {
    const city = cleanText(property.city).toLowerCase();
    return city && !SERVICE_AREA_CITIES.has(city);
  });
}

function formatTheoPropertyLinks(properties: SheetRow[] = []): string {
  const linked = properties.filter((property) => cleanText(property.listing_url));
  if (!linked.length) return "";
  const shown = linked.slice(0, 3);
  // A single link needs no preamble at all. Numbering one item is worse than not numbering.
  if (shown.length === 1) return propertyBlock(shown[0]);
  return messagesBlocks(...shown.map((property, index) => propertyBlock(property, index)));
}

function formatTheoPropertyPhotos(properties: SheetRow[] = [], maxCount = 3): string {
  const photographed = properties.filter((property) => usablePhotoUrl(property.photo_url));
  if (!photographed.length) return "";
  const shown = photographed.slice(0, maxCount);
  const serviceNote = outsideServiceArea(shown)
    ? "Heads up, this one sits outside our main Austin-area coverage, but I pulled the listing media."
    : "";
  const intro = shown.length === 1 ? "Photos coming through now." : `Photos coming through for all ${shown.length}.`;
  const body = shown.length === 1
    ? propertyBlock(shown[0])
    : messagesBlocks(...shown.map((property, index) => propertyBlock(property, index)));
  return messagesBlocks(serviceNote, intro, body);
}

function formatTheoPhotoLinkFallback(properties: SheetRow[] = []): string {
  const linked = properties.filter((property) => cleanText(property.listing_url));
  if (!linked.length) return "";
  const shown = linked.slice(0, 3);
  const body = shown.length === 1
    ? propertyBlock(shown[0])
    : messagesBlocks(...shown.map((property, index) => propertyBlock(property, index)));
  return messagesBlocks(
    "I found the listing, but the images are not sendable by text. The full gallery is on the listing page.",
    body,
  );
}

function formatTheoPropertyDetails(properties: SheetRow[] = []): string {
  const property = properties.find((row) => cleanText(row.address));
  if (!property) return "";
  const featureText = cleanText(property.features || property.description).slice(0, 150).replace(/[,;\s]+$/, "");
  const colorLine = [propertyContextLine(property), featureText ? `${featureText.replace(/\.$/, "")}.` : ""]
    .filter(Boolean)
    .join(" ");
  return messagesBlocks(
    [
      cleanText(property.address),
      propertyFactsLine(property),
      colorLine,
      listingUrlLine(property),
    ].filter(Boolean).join("\n"),
    closerFor(SINGLE_PROPERTY_CLOSERS, cleanText(property.address)),
  );
}

function requestedAmenityLabels(message: string): string[] {
  const text = normalizeFollowupText(message);
  const checks: Array<[RegExp, string]> = [
    [/\bpet|pets|dog|cat\b/i, "pets"],
    [/\bparking|garage\b/i, "parking"],
    [/\bpool\b/i, "pool"],
    [/\bwasher|dryer|laundry\b/i, "laundry"],
    [/\bfurnished\b/i, "furnished"],
    [/\butilities\b/i, "utilities"],
    [/\bdeposit\b/i, "deposit"],
    [/\bfee|fees\b/i, "fees"],
    [/\bhoa\b/i, "HOA"],
    [/\blease\b/i, "lease terms"],
    [/\bmove.?in\b/i, "move-in"],
    [/\byard\b/i, "yard"],
    [/\bbalcony|patio\b/i, "balcony/patio"],
    [/\bgym|fitness\b/i, "fitness amenities"],
    [/\belevator\b/i, "elevator"],
    [/\bstorage\b/i, "storage"],
  ];
  return checks.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function formatTheoAvailabilityAnswer(property: SheetRow): string {
  const status = cleanText(property.status);
  const address = cleanText(property.address);
  if (status) return `${address} is showing as ${status.toLowerCase()} right now.`;
  return `I have ${address} saved, but not a live availability field for it. I can send the listing or have the team confirm access.`;
}

// Zillow feature columns carry marketing filler that is not an amenity. "It has central air,
// balcony and urban location" is the tell that a column was pasted rather than described.
const NON_AMENITY_FEATURE_RE = /\b(urban|suburban|convenient|prime|desirable|great|ideal|excellent)\b.*\b(location|access|area|setting|spot)\b|\b(location|access)\b$/i;

/**
 * Turn a raw feature column ("Central Air, Balcony, Elevator Building") into something a
 * person would say out loud ("central air, a balcony and elevator building"). Title Case in a
 * text message is the tell that a field got pasted in rather than described.
 *
 * Takes the features column ONLY. Appending the free-text description here produced a last
 * "item" that was a whole sentence: "...parking and modern finishes apartment with community
 * pool and convenient austin access."
 */
function spokenFeatureList(featureText: string): string {
  const items = cleanText(featureText)
    .split(/[,;]+/)
    .map((item) => item.trim().replace(/[.\s]+$/, ""))
    .filter(Boolean)
    .filter((item) => !NON_AMENITY_FEATURE_RE.test(item))
    // Preserve acronyms and unit numbers; only de-title-case ordinary words.
    .map((item) => item.replace(/\b[A-Z][a-z]+\b/g, (word) => word.toLowerCase()))
    .slice(0, 5);
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function formatTheoAmenityAnswer(property: SheetRow, message: string, events: SheetRow[] = []): string {
  const requested = requestedAmenityLabels(message);
  const listingText = cleanText([property.features, property.description].filter(Boolean).join(" "));
  const seed = cleanText(property.address);
  // Once the listing block has been sent, an amenity follow-up should read as a reply to
  // that message, not as a fresh pitch. Reference the address in prose and skip the facts.
  const alreadySeen = alreadyShownProperty(property, events);
  const header = alreadySeen
    ? ""
    : [cleanText(property.address), propertyFactsLine(property)].filter(Boolean).join("\n");
  const linkLine = alreadySeen ? "" : listingUrlLine(property);

  if (!requested.length) {
    // "<address> lists Central Air, Balcony, ..." reads like a data export. When the listing
    // block is already on their screen, answer the way a person would: "It has ...".
    const spoken = spokenFeatureList(property.features || "");
    const note = spoken
      ? alreadySeen
        ? `It has ${spoken}.`
        : `The listing calls out ${spoken}.`
      : `I don't have more amenity detail saved on ${cleanText(property.address)} yet.`;
    return messagesBlocks(
      header,
      [note, linkLine].filter(Boolean).join("\n"),
      closerFor(AMENITY_CLOSERS, seed),
    );
  }

  const mentioned = requested.filter((label) => new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\/.*/, "")}\\b`, "i").test(listingText));
  const unknown = requested.filter((label) => !mentioned.includes(label));
  const knownLine = mentioned.length
    ? `It has ${mentioned.join(" and ")}.${unknown.length ? ` Nothing in the listing either way on ${unknown.join(" or ")}.` : ""}`
    : `The listing doesn't say either way on ${requested.join(" or ")}.`;
  return messagesBlocks(
    header,
    [knownLine, linkLine].filter(Boolean).join("\n"),
    closerFor(AMENITY_CLOSERS, seed),
  );
}

function formatTheoShowingRequest(properties: SheetRow[] = [], events: SheetRow[] = []): string {
  const property = properties.find((row) => cleanText(row.address));
  const address = cleanText(property?.address);
  // If the block for this listing is already on their screen, do not paste it again.
  // Name it in the sentence instead and spend the message on the actual booking step.
  const alreadySeen = property ? alreadyShownProperty(property, events) : false;
  if (address && alreadySeen) {
    return messagesBlocks(
      `Happy to get you into ${address}.`,
      "What day works best this week?",
    );
  }
  const propertyLine = property
    ? [address, propertyFactsLine(property)].filter(Boolean).join("\n")
    : "";
  return messagesBlocks(
    propertyLine,
    "Happy to set that up. What day works best this week?",
  );
}

function formatTheoPropertyComparison(properties: SheetRow[] = [], message: string): string {
  const usable = properties.filter((property) => cleanText(property.address));
  if (!usable.length) return "";
  const normalized = normalizeFollowupText(message);
  let label = "Here they are side by side.";
  let sorted = [...usable];
  if (/\b(cheapest|lowest|least expensive|most affordable|best deal|better)\b/i.test(normalized)) {
    sorted = sorted
      .filter((property) => numericValue(property.price) != null)
      .sort((a, b) => (numericValue(a.price) || 0) - (numericValue(b.price) || 0));
    label = "Cheapest first.";
  } else if (/\b(highest|most expensive)\b/i.test(normalized)) {
    sorted = sorted
      .filter((property) => numericValue(property.price) != null)
      .sort((a, b) => (numericValue(b.price) || 0) - (numericValue(a.price) || 0));
    label = "Priciest first.";
  } else if (/\b(largest|biggest)\b/i.test(normalized)) {
    sorted = sorted
      .filter((property) => numericValue(property.sqft) != null)
      .sort((a, b) => (numericValue(b.sqft) || 0) - (numericValue(a.sqft) || 0));
    label = "Biggest first.";
  } else if (/\b(smallest)\b/i.test(normalized)) {
    sorted = sorted
      .filter((property) => numericValue(property.sqft) != null)
      .sort((a, b) => (numericValue(a.sqft) || 0) - (numericValue(b.sqft) || 0));
    label = "Smallest first.";
  }
  if (!sorted.length) sorted = usable;
  const shown = sorted.slice(0, 3);
  const lines = shown.map((property, index) => `${index + 1}. ${cleanText(property.address)}, ${formatOptionFacts(property)}`.replace(/,\s*$/, ""));
  return messagesBlocks(
    label,
    lines.join("\n"),
    closerFor(MULTI_LISTING_CLOSERS, cleanText(shown[0]?.address)),
  );
}

// The same "safe inquiry" branch answers availability, amenities, showings and comparisons.
// Each of those is a different shape, so each gets its own budget.
function safeInquiryFamily(message: string): MessagesReplyFamily {
  if (asksForPropertyShowing(message)) return "scheduling";
  if (asksForPropertyComparison(message)) return "multi_listing";
  if (asksForPropertyAvailability(message)) return "followup_question";
  if (asksForPropertyAmenities(message)) return "shared_property_context";
  return "single_property";
}

function formatTheoPropertySafeAnswer(properties: SheetRow[] = [], message: string, events: SheetRow[] = []): string {
  if (asksForPropertyShowing(message)) return formatTheoShowingRequest(properties, events);
  if (asksForPropertyComparison(message) && properties.length > 1) return formatTheoPropertyComparison(properties, message);
  const property = properties.find((row) => cleanText(row.address));
  if (!property) return "";
  if (asksForPropertyAvailability(message)) {
    // If the link is already on their screen, a status answer does not need to resend it.
    const link = alreadyShownProperty(property, events) ? "" : listingUrlLine(property);
    return messagesBlocks(
      formatTheoAvailabilityAnswer(property),
      link,
      closerFor(AVAILABILITY_CLOSERS, cleanText(property.address)),
    );
  }
  if (asksForPropertyAmenities(message)) return formatTheoAmenityAnswer(property, message, events);
  return formatTheoPropertyDetails(properties);
}

/**
 * How many beds the lead just asked for, when they said it plainly. Used to avoid calling a
 * 2-bed a "match" for a 3-bed request, which is a factual claim the agent must not make.
 */
function requestedBedCount(message: string): number | null {
  const normalized = normalizeFollowupText(message).toLowerCase();
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const digit = normalized.match(/\b(\d)\s*(?:bed|bd|bedroom|br)\b/);
  if (digit) return Number(digit[1]);
  const word = normalized.match(/\b(one|two|three|four|five)[\s-]*(?:bed|bd|bedroom|br)\b/);
  return word ? words[word[1]] ?? null : null;
}

function formatTheoPropertyOptions(
  properties: SheetRow[] = [],
  classification: TheoClassification,
  message = "",
  events: SheetRow[] = [],
): string {
  const rejectedPrior = rejectsCurrentProperty(message);
  // "show me something different" must not return the listing they just turned down.
  const pool = rejectedPrior ? dropRejectedProperties(properties, events) : properties;
  const usable = pool.filter((property) => cleanText(property.address));
  if (!usable.length) return "";
  const shown = usable.slice(0, 3);
  const needsHuman = classification.status === "needs_human" || Boolean(classification.handoffReason);
  const hasSellBeforeBuy = (classification.opportunityTags || []).includes("sell_before_buy") || classification.leadRole === "seller";

  // Be honest when nothing hits the bed count they asked for.
  const wantedBeds = requestedBedCount(message);
  const bedMiss = wantedBeds != null
    && shown.length > 0
    && shown.every((property) => {
      const beds = numericValue(property.beds);
      return beds != null && beds < wantedBeds;
    });

  const intro = rejectedPrior
    ? "No problem, skipping that one. These are closer:"
    : bedMiss
    ? `Nothing at ${wantedBeds} beds downtown right now. Closest I have:`
    : needsHuman
    ? `I found ${shown.length === 1 ? "one match" : `${shown.length} matches`}. A person will pick up the part that needs judgment.`
    : shown.length === 1
    ? "I found one match:"
    : `I found ${shown.length} matches:`;
  const humanNote = !needsHuman && hasSellBeforeBuy
    ? "Since the sell and buy timing has to line up, a person on the team should help with the valuation side."
    : "";
  // A single result is not a list. Only number things when there are parallel items.
  const body = shown.length === 1
    ? propertyBlock(shown[0])
    : messagesBlocks(...shown.map((property, index) => propertyBlock(property, index)));
  const closer = shown.length === 1
    ? "Want more options like this, or should we focus here?"
    : closerFor(MULTI_LISTING_CLOSERS, cleanText(shown[0]?.address));
  return messagesBlocks(intro, body, humanNote, closer);
}

function formatTheoNoPropertyOptions(message: string, lead: Partial<SheetRow> = {}): string {
  const normalized = normalizeFollowupText(message);
  const similar = /\bsimilar|same spec|same specs|other|another|alternative|anything else|what else|options?\b/i.test(normalized);
  // Ask for the FIRST thing that is actually missing, not all four at once.
  const missing = !cleanText(lead.area)
    ? "What area should I look in?"
    : !cleanText(lead.budget)
    ? "What's your price ceiling?"
    : !cleanText(lead.bedrooms)
    ? "How many bedrooms do you need?"
    : "Want me to widen it on price or area?";
  return messagesBlocks(
    similar
      ? "Nothing clean matching that in what I have right now."
      : "I don't have a match saved for that yet.",
    missing,
  );
}

/**
 * Compliance handoff. It must not answer the question, but a bare "a person from the team
 * will follow up" reads like a routing machine. Naming the lead and the listing in context
 * costs nothing on the compliance side and is the difference between a warm handoff and a
 * cold rejection.
 */
function formatTheoHandoff(lead: Partial<SheetRow> = {}, properties: SheetRow[] = []): string {
  const firstName = cleanText(lead.full_name).split(" ")[0];
  const address = cleanText(properties.find((row) => cleanText(row.address))?.address);
  const opener = firstName ? `${firstName}, that` : "That";
  return messagesBlocks(
    address
      ? `${opener}'s one I want someone licensed on our team to answer for you on ${address}.`
      : `${opener}'s one I want someone licensed on our team to answer for you.`,
    "I'm having them reach out right here shortly.",
  );
}

// "thanks" / "ok cool" / "got it" is not an opener. It gets one line, not a capability menu.
// The tail still has to be answerable in a word: "let me know what you want next" hands the
// whole job back to the lead, which is how threads go cold.
const SHORT_ACK_REPLIES = [
  "Anytime. Want me to keep pulling options in the meantime?",
  "Of course. Should I keep an eye out for new ones?",
  "Happy to help. Want me to line up a couple more to look at?",
] as const;

const SHORT_ACK_ANCHORED = [
  "Anytime. Want me to keep pulling {anchor} options in the meantime?",
  "Of course. Should I keep an eye out for new {anchor} listings?",
  "Happy to help. Want me to line up a couple more in {anchor}?",
] as const;

/** The one lead fact worth naming back in a one-line ack. Area only: a bare budget figure
 * ("more $1,000,000 options") does not read like a person. */
function shortAckAnchor(lead: Partial<SheetRow> = {}): string {
  return cleanText(lead.area);
}

// Gratitude and acknowledgement only. Deliberately excludes "yes"/"yeah"/"sure", which are
// answers to a prior question and need the thread, not a generic acknowledgement.
const ACK_CORE_TOKENS = new Set([
  "thanks", "thank", "thx", "ty", "ok", "okay", "k", "cool", "great", "nice",
  "perfect", "awesome", "sweet", "appreciate", "sounds", "got",
]);
const ACK_FILLER_TOKENS = new Set([
  "you", "so", "much", "a", "lot", "really", "very", "it", "good", "then", "man", "all",
]);

function isShortAcknowledgement(message: string): boolean {
  const raw = cleanText(message);
  // A thumbs-up, a lone "." or an emoji-only text carries no request. Live it triggered a full
  // pitch with a two-block scheduling push; it deserves one warm line, same as "thanks".
  if (raw && raw.length <= 12 && !/[a-z0-9]/i.test(raw)) return true;
  const text = raw.replace(/[!?.,]+/g, " ").trim();
  if (!text || text.length > 32) return false;
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return false;
  if (!tokens.every((token) => ACK_CORE_TOKENS.has(token) || ACK_FILLER_TOKENS.has(token))) return false;
  return tokens.some((token) => ACK_CORE_TOKENS.has(token));
}

// The Google Voice corpus caught this live: the lead asked for the details by email and got
// another SMS listing block instead (fixture scenario email_preference_request). Honour the
// channel switch and confirm the address rather than resending what they already have.
function asksForEmailDelivery(message: string): boolean {
  const normalized = normalizeFollowupText(message);
  return /\b(?:send|shoot|forward|mail|email|text)\b[^?.!]{0,40}\bto (?:my )?e-?mail\b/i.test(normalized)
    || /\b(?:send|shoot|forward)\b[^?.!]{0,40}\b(?:by|via|over|through) e-?mail\b/i.test(normalized)
    || /\be-?mail (?:it|them|these|the details|that)\b/i.test(normalized)
    || /\be-?mail (?:is|works|would be) (?:best|better|easier|fine)\b/i.test(normalized)
    || /\b(?:my|use my) e-?mail (?:instead|please)\b/i.test(normalized);
}

function formatTheoEmailDeliveryReply(lead: Partial<SheetRow> = {}, properties: SheetRow[] = []): string {
  const email = cleanText(lead.email);
  const property = properties.find((row) => cleanText(row.address));
  const subject = property ? `the full details on ${cleanText(property.address)}` : "the full details";
  return messagesBlocks(
    `Sure, I can send ${subject} by email instead.`,
    email ? `Is ${email} still the best address?` : "What address should I use?",
  );
}

function formatTheoGeneralReply(
  message: string,
  classification: TheoClassification,
  lead: Partial<SheetRow> = {},
): string {
  if (isShortAcknowledgement(message)) {
    const seed = cleanText(message).toLowerCase();
    const anchor = shortAckAnchor(lead);
    return anchor
      ? pickVariant(SHORT_ACK_ANCHORED, seed).replace("{anchor}", anchor)
      : pickVariant(SHORT_ACK_REPLIES, seed);
  }
  if (asksForLightGreeting(message)) {
    return messagesBlocks(
      "Hi, this is Iris with Austin Realty.",
      "What area, budget, and bedroom count should I search?",
    );
  }
  if (classification.intent === "seller_lead" || classification.leadRole === "seller") {
    return messagesBlocks(
      "Happy to help with that.",
      "Are you after a value estimate, help getting it listed, or timing a sell-before-buy move?",
    );
  }
  if (classification.intent === "renter_lead" || classification.leadRole === "renter") {
    return messagesBlocks(
      "I can narrow the rentals down.",
      "What area should I search?",
    );
  }
  // An "anything similar?" with nothing saved is a no-inventory answer, not a fresh intake.
  // Say so plainly and ask the ONE thing that unblocks the search.
  if (asksForAlternativeProperties(normalizeFollowupText(message))) {
    return formatTheoNoPropertyOptions(message, lead);
  }
  return messagesBlocks(
    "I can help narrow the search.",
    cleanText(lead.area) ? "Are you looking to buy or rent?" : "What area should I look in?",
  );
}

// The model path can land on any shape, so pick the budget from what was actually asked.
function llmReplyFamily(context: TheoReplyContext, classification: TheoClassification): MessagesReplyFamily {
  if (isShortAcknowledgement(context.message)) return "short_ack";
  if (classification.intent === "human_required" || classification.status === "needs_human") return "sensitive_handoff";
  if (asksForPropertyShowing(context.message)) return "scheduling";
  if (asksForPropertyOptions(context.message)) return "multi_listing";
  if (asksForPropertyDetails(context.message) || asksForPropertySafeInquiry(context.message)) return "single_property";
  if (!(context.properties || []).length) return "missing_details";
  return "general";
}

export function selectTheoMediaUrls(context: TheoReplyContext, classification: TheoClassification): string[] {
  if (!mediaImagesEnabled(context.source)) return [];
  if (classification.intent === "spam") return [];
  if (classification.intent === "human_required" && (!asksForSafePropertyFact(context.message) || !canShareSafeFactsDuringHandoff(classification))) return [];

  const mode = smsImageMode();
  if (mode === "off") return [];
  if (mode === "on_request" && !wantsPropertyImage(context.message)) return [];
  if (!["on_request", "property_reply"].includes(mode)) return [];

  const maxImages = maxMediaImages(context.source);
  // When asking for photos of "the property" (singular back-reference), send only the first match.
  // Prevents sending 3 photos across 3 properties when caller meant one specific previously-mentioned property.
  const singularPhotoRequest = /\bthe property\b|\bthe listing\b|\bthat property\b|\bthat listing\b|\bit\b/i.test(normalizeFollowupText(context.message));
  const effectiveMax = singularPhotoRequest && (context.properties || []).length > 1 ? 1 : maxImages;
  return (context.properties || [])
    .map((property) => usablePhotoUrl(property.photo_url))
    .filter(Boolean)
    .slice(0, effectiveMax);
}

export function classifyTheoMessage(message: string): TheoClassification {
  const text = normalize(normalizeFollowupText(message));
  if (!text || SPAM_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: "spam", leadRole: "unknown", handoffReason: "Spam or empty SMS", status: "needs_human" };
  }

  const sensitive = SENSITIVE_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (sensitive) {
    return { intent: "human_required", leadRole: "unknown", handoffReason: sensitive.reason, status: "needs_human" };
  }

  if (/\b(tour|showing|see it|view it|walkthrough|appointment)\b/i.test(text)) {
    return { intent: "showing_request", leadRole: "buyer", handoffReason: "", status: "ready_to_reply" };
  }
  if (/\b(sell|selling|listing|list my|valuation|home value|expired)\b/i.test(text)) {
    return { intent: "seller_lead", leadRole: "seller", handoffReason: "", status: "ready_to_reply" };
  }
  if (/\b(rent|rents|renting|rental|rentals|lease|leases|leasing|tenant|tenants)\b/i.test(text)) {
    return { intent: "renter_lead", leadRole: "renter", handoffReason: "", status: "ready_to_reply" };
  }
  if (/\b(buy|buyer|looking for|interested|available|details|price|bed|bath|sqft|address|similar|neighboring|nearby|same spec|options?|layout|something close)\b/i.test(text)) {
    return { intent: "property_details", leadRole: "buyer", handoffReason: "", status: "ready_to_reply" };
  }
  return { intent: "buyer_lead", leadRole: "unknown", handoffReason: "", status: "ready_to_reply" };
}

export function shouldTheoAutoReply(classification: TheoClassification, lead: Partial<SheetRow> = {}): boolean {
  if (lead.sms_consent === "no" || lead.next_action === "do_not_contact") return false;
  if (classification.intent === "spam") return false;
  return true;
}

export async function generateTheoReply(context: TheoReplyContext): Promise<TheoReplyResult> {
  const offTopicReply = offTopicRedirectReply(context.message);
  if (offTopicReply) {
    return {
      classification: {
        intent: "spam",
        leadRole: "unknown",
        handoffReason: "Off-topic or unsafe request",
        status: "ready_to_reply",
      },
      reply: offTopicReply,
      mediaUrls: [],
      shouldSend: true,
      aiAction: "off_topic_redirect_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics: [],
    };
  }

  // A link we cannot resolve gets an honest "send me the address", never another listing's facts.
  if (sharesUnknownListingUrl(context.message, context.properties)) {
    return {
      classification: {
        intent: "property_details",
        leadRole: context.lead?.lead_role || "unknown",
        handoffReason: "",
        status: "ready_to_reply",
      },
      reply: messagesBlocks(
        "That link isn't opening on my end.",
        "What's the address? I'll pull it up from there.",
      ),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "shared_link_unresolved_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics: [],
    };
  }

  const localSafetyClassification = classifyTheoMessage(context.message);
  if (
    localSafetyClassification.intent === "human_required"
    && localSafetyClassification.handoffReason !== "Lead requested a human"
  ) {
    return {
      classification: localSafetyClassification,
      reply: formatTheoHandoff(context.lead || {}, context.properties || []),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "handoff_reply_ready",
      handoffReason: localSafetyClassification.handoffReason,
      status: "needs_human",
      metrics: [],
    };
  }

  if (asksForLightGreeting(context.message) || isShortAcknowledgement(context.message)) {
    if (!shouldTheoAutoReply(localSafetyClassification, context.lead || {})) {
      return {
        classification: localSafetyClassification,
        reply: "",
        mediaUrls: [],
        shouldSend: false,
        aiAction: "auto_reply_blocked",
        handoffReason: localSafetyClassification.handoffReason || "Iris should not auto-reply to this SMS",
        status: localSafetyClassification.status,
        metrics: [],
      };
    }
    return {
      classification: localSafetyClassification,
      reply: formatTheoGeneralReply(context.message, localSafetyClassification, context.lead || {}),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "general_lead_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics: [],
    };
  }

  if (context.lead?.phone) {
    const appointmentResult = await handleTheoAppointmentMessage(
      context.lead.phone,
      context.message,
      context.lead || null,
      cleanText((context.properties || []).find((row) => cleanText(row.address))?.address),
    );
    if (appointmentResult.handled) {
      return {
        classification: {
          intent: "showing_request",
          leadRole: context.lead?.lead_role || "buyer",
          handoffReason: "",
          status: appointmentResult.nextAction === "done" ? "replied" : "awaiting_response",
        },
        reply: appointmentResult.reply,
        mediaUrls: [],
        shouldSend: true,
        aiAction: "appointment_handled",
        handoffReason: "",
        status: appointmentResult.nextAction === "done" ? "replied" : "awaiting_response",
        metrics: [],
      };
    }
  }

  const scenario = detectConversationScenario({ message: context.message, lead: context.lead, event: context.recentEvents?.[context.recentEvents.length - 1] });
  const playbookContext: TheoReplyContext = {
    ...context,
    dataContext: [context.dataContext, sharedBrainInstruction({ channel: context.source || "sms", scenario })].filter(Boolean).join("\n\n"),
  };

  let classification: TheoClassification;
  const metrics: TheoMetric[] = [];
  try {
    classification = await classifyTheoWithLlm(playbookContext);
    metrics.push(...(classification.metrics || []));
  } catch {
    classification = classifyTheoMessage(context.message);
  }
  if (latestMessageHasSensitiveTopic(context.message) && classification.status !== "needs_human") {
    const localClassification = classifyTheoMessage(context.message);
    if (localClassification.status === "needs_human") {
      classification = {
        ...classification,
        intent: localClassification.intent,
        status: localClassification.status,
        handoffReason: localClassification.handoffReason,
        recommendedNextAction: "route_human",
      };
    }
  }
  if (asksForPropertyOptions(context.message) && !latestMessageHasSensitiveTopic(context.message)) {
    classification = {
      ...classification,
      intent: "property_details",
      status: "ready_to_reply",
      handoffReason: "",
      recommendedNextAction: "reply_and_qualify",
    };
  }
  if (asksForPropertyDetails(context.message) && !latestMessageHasSensitiveTopic(context.message)) {
    classification = {
      ...classification,
      intent: "property_details",
      status: "ready_to_reply",
      handoffReason: "",
      recommendedNextAction: "reply_and_qualify",
    };
  }
  if (asksForPropertySafeInquiry(context.message) && !latestMessageHasSensitiveTopic(context.message)) {
    classification = {
      ...classification,
      intent: asksForPropertyShowing(context.message) ? "showing_request" : "property_details",
      status: "ready_to_reply",
      handoffReason: "",
      recommendedNextAction: asksForPropertyShowing(context.message) ? "collect_showing_time" : "reply_and_qualify",
    };
  }
  const lead = context.lead || {};
  const shouldReply = shouldTheoAutoReply(classification, lead);

  if (!shouldReply) {
    return {
      classification,
      reply: "",
      mediaUrls: [],
      shouldSend: false,
      aiAction: "auto_reply_blocked",
      handoffReason: classification.handoffReason || "Iris should not auto-reply to this SMS",
      status: classification.status,
      metrics,
    };
  }

  const optionsReply = asksForPropertyOptions(context.message)
    && (classification.intent !== "human_required" || canShareSafeFactsDuringHandoff(classification))
    ? formatTheoPropertyOptions(context.properties, classification, context.message, context.recentEvents)
    : "";
  if (optionsReply) {
    const mediaUrls = wantsPropertyImage(context.message)
      ? selectTheoMediaUrls(context, classification)
      : [];
    return {
      classification,
      reply: truncateSmsForFamily(optionsReply, "multi_listing"),
      mediaUrls,
      shouldSend: true,
      aiAction: classification.status === "needs_human" ? "property_options_handoff_reply_ready" : "property_options_reply_ready",
      handoffReason: classification.status === "needs_human" ? classification.handoffReason : "",
      status: classification.status === "needs_human" ? "needs_human" : "ready_to_reply",
      metrics,
    };
  }
  if (asksForPropertyOptions(context.message) && !optionsReply && !latestMessageHasSensitiveTopic(context.message)) {
    return {
      classification,
      reply: truncateSmsForFamily(formatTheoNoPropertyOptions(context.message, context.lead), "missing_details"),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "property_options_no_match_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics,
    };
  }

  const ordinalProperties = selectOrdinalProperties(context.message, context.properties);
  const hasOrdinalReference = ordinalReferenceIndex(context.message) != null;
  const shouldUseOrdinalReply = ordinalOnlyIndex(context.message) != null || wantsPropertyImage(context.message);
  if (hasOrdinalReference && shouldUseOrdinalReply && ordinalProperties.length && !latestMessageHasSensitiveTopic(context.message)) {
    const mediaUrls = wantsPropertyImage(context.message)
      ? selectTheoMediaUrls({ ...context, properties: ordinalProperties }, classification)
      : [];
    const reply = mediaUrls.length
      ? formatTheoPropertyPhotos(ordinalProperties) || formatTheoPropertyDetails(ordinalProperties)
      : formatTheoPropertyDetails(ordinalProperties);
    return {
      classification: {
        ...classification,
        intent: "property_details",
        status: "ready_to_reply",
        handoffReason: "",
        recommendedNextAction: "reply_and_qualify",
      },
      reply: truncateSmsForFamily(reply, mediaUrls.length ? "multi_listing" : "single_property"),
      mediaUrls,
      shouldSend: true,
      aiAction: mediaUrls.length ? "property_ordinal_photos_reply_ready" : "property_ordinal_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics,
    };
  }

  if (asksForEmailDelivery(context.message) && !latestMessageHasSensitiveTopic(context.message)) {
    return {
      classification: {
        ...classification,
        status: "ready_to_reply",
        handoffReason: "",
        recommendedNextAction: "confirm_email_channel",
      },
      reply: truncateSmsForFamily(formatTheoEmailDeliveryReply(context.lead, context.properties), "followup_question"),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "email_delivery_preference_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics,
    };
  }

  const safePropertyReply = asksForPropertySafeInquiry(context.message)
    && !wantsPropertyImage(context.message)
    && !latestMessageHasSensitiveTopic(context.message)
    && (classification.intent !== "human_required" || canShareSafeFactsDuringHandoff(classification))
    ? advanceInsteadOfRepeating(
      formatTheoPropertySafeAnswer(context.properties, context.message, context.recentEvents),
      context.recentEvents,
      context.properties,
    )
    : "";
  if (safePropertyReply) {
    return {
      classification,
      reply: truncateSmsForFamily(safePropertyReply, safeInquiryFamily(context.message)),
      mediaUrls: [],
      shouldSend: true,
      aiAction: asksForPropertyShowing(context.message)
        ? "property_showing_reply_ready"
        : asksForPropertyComparison(context.message)
          ? "property_comparison_reply_ready"
          : "property_safe_inquiry_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics,
    };
  }
  if (asksForPropertySafeInquiry(context.message) && !latestMessageHasSensitiveTopic(context.message) && !(context.properties || []).length) {
    return {
      classification,
      reply: messagesBlocks(
        "Happy to help with that.",
        "Which listing did you mean, or send me the area, budget, and bedroom count and I'll pull matches?",
      ),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "property_safe_inquiry_needs_context",
      handoffReason: "",
      status: "ready_to_reply",
      metrics,
    };
  }

  const detailReply = asksForPropertyDetails(context.message)
    && !wantsPropertyImage(context.message)
    && (classification.intent !== "human_required" || canShareSafeFactsDuringHandoff(classification))
    ? advanceInsteadOfRepeating(
      formatTheoPropertyDetails(context.properties),
      context.recentEvents,
      context.properties,
    )
    : "";
  if (detailReply) {
    const mediaUrls = wantsPropertyImage(context.message)
      ? selectTheoMediaUrls(context, classification)
      : [];
    return {
      classification,
      reply: truncateSmsForFamily(detailReply, "single_property"),
      mediaUrls,
      shouldSend: true,
      aiAction: classification.status === "needs_human" ? "property_details_handoff_reply_ready" : "property_details_reply_ready",
      handoffReason: classification.status === "needs_human" ? classification.handoffReason : "",
      status: classification.status === "needs_human" ? "needs_human" : "ready_to_reply",
      metrics,
    };
  }

  if (wantsPropertyImage(context.message) && (classification.intent !== "human_required" || canShareSafeFactsDuringHandoff(classification))) {
    const mediaUrls = selectTheoMediaUrls(context, classification);
    const photoReply = formatTheoPropertyPhotos(context.properties, Math.max(1, maxMediaImages(context.source)));
    if (mediaUrls.length && photoReply) {
      return {
        classification,
        reply: truncateSmsForFamily(photoReply, "multi_listing"),
        mediaUrls,
        shouldSend: true,
        aiAction: classification.status === "needs_human" ? "property_photos_handoff_reply_ready" : "property_photos_reply_ready",
        handoffReason: classification.status === "needs_human" ? classification.handoffReason : "",
        status: classification.status === "needs_human" ? "needs_human" : "ready_to_reply",
        metrics,
      };
    }
    const fallbackReply = formatTheoPhotoLinkFallback(context.properties);
    if (fallbackReply) {
      return {
        classification,
        reply: truncateSmsForFamily(fallbackReply, "multi_listing"),
        mediaUrls: [],
        shouldSend: true,
        aiAction: classification.status === "needs_human" ? "property_photo_link_handoff_fallback_ready" : "property_photo_link_fallback_ready",
        handoffReason: classification.status === "needs_human" ? classification.handoffReason : "",
        status: classification.status === "needs_human" ? "needs_human" : "ready_to_reply",
        metrics,
      };
    }
  }

  if (classification.intent === "human_required") {
    let handoffReply = formatTheoHandoff(context.lead || {}, context.properties || []);
    try {
      const generated = await generateTheoSmsWithLlm(playbookContext, classification);
      handoffReply = generated.reply;
      metrics.push(...generated.metrics);
    } catch {
      // Keep a safe handoff response if the model is unavailable.
    }
    return {
      classification,
      reply: truncateSmsForFamily(handoffReply, "sensitive_handoff"),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "handoff_reply_ready",
      handoffReason: classification.handoffReason,
      status: "needs_human",
      metrics,
    };
  }

  if (latestMessageAsksForSellerValuation(context.message) && isSellerValuationContext(context.message, classification)) {
    const valuationReply = formatTheoSellerValuationReply(context.properties, context.lead);
    if (valuationReply) {
      return {
        classification,
        reply: truncateSmsForFamily(valuationReply, "single_property"),
        mediaUrls: [],
        shouldSend: true,
        aiAction: "seller_valuation_link_reply_ready",
        handoffReason: "",
        status: "ready_to_reply",
        metrics,
      };
    }
  }

  if (wantsPropertyLinks(context.message)) {
    const linkReply = formatTheoPropertyLinks(context.properties);
    if (linkReply) {
      return {
        classification,
        reply: truncateSmsForFamily(linkReply, "multi_listing"),
        mediaUrls: [],
        shouldSend: true,
        aiAction: "property_links_reply_ready",
        handoffReason: "",
        status: "ready_to_reply",
        metrics,
      };
    }
  }

  let reply: string;
  try {
    const generated = await generateTheoSmsWithLlm(playbookContext, classification);
    reply = generated.reply;
    metrics.push(...generated.metrics);
  } catch {
    return {
      classification,
      reply: formatTheoGeneralReply(context.message, classification, context.lead || {}),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "general_lead_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics,
    };
  }
  return {
    classification,
    reply: truncateSmsForFamily(
      advanceInsteadOfRepeating(reply, context.recentEvents, context.properties),
      llmReplyFamily(context, classification),
    ),
    mediaUrls: selectTheoMediaUrls(context, classification),
    shouldSend: true,
    aiAction: "ai_reply_ready",
    handoffReason: "",
    status: "ready_to_reply",
    metrics,
  };
}

export function smsOptIn(value: unknown): boolean {
  return ["1", "true", "yes", "on", "y", "opt-in", "opt_in", "consent"].includes(String(value || "").trim().toLowerCase());
}
