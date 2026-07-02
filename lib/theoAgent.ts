import type { SheetRow } from "@/lib/sheetSchema";
import { CENTRAL_TEXAS_CITIES } from "@/lib/serviceAreas";
import { handleTheoAppointmentMessage } from "@/lib/theoAppointments";
import { classifyTheoWithLlm, generateTheoSmsWithLlm } from "@/lib/theoLlm";
import type { TheoMetric } from "@/lib/theoTelemetry";
import { detectConversationScenario, sharedBrainInstruction } from "@/lib/conversationPlaybooks";

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
  { pattern: /\b(section 8|voucher|children|kids|family friendly|safe neighborhood|crime|school rating|ethnic|race|religion|disabled|disability)\b/i, reason: "Fair Housing-sensitive question" },
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
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n(?=\d+\.\s)/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const clean = cleanSmsReply(value);
  if (clean.length <= limit) return clean;
  const slice = clean.slice(0, limit - 1).trimEnd();
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("\n\n"),
  );
  if (sentenceEnd > Math.floor(limit * 0.55)) {
    const punctuationEnd = sentenceEnd + (slice[sentenceEnd] === "\n" ? 0 : 1);
    return slice.slice(0, punctuationEnd).trimEnd();
  }
  return `${slice}...`;
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

function valuationUrl(): string {
  return cleanText(process.env.FILLOUT_VALUATION_URL || process.env.CALENDLY_URL);
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
    && /\b(show|send|see|tell|find|recommend|compare|options?|properties|homes?|listings?|spec|specs)\b/i.test(normalized);
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
  return "";
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
  return /\b(tour|showing|show it|see it|view it|walk.?through|visit|come see|book|schedule|appointment)\b/i.test(normalizeFollowupText(message));
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
  return /^(hi|hello|hey|yo|good morning|good afternoon|good evening|thanks|thank you|ok|okay|cool|great|sounds good)[!. ]*$/i.test(cleanText(message));
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

function formatTheoSellerValuationReply(properties: SheetRow[] = []): string {
  const url = valuationUrl();
  if (!url) return "";
  const property = properties.find((row) => cleanText(row.address));
  const facts = property ? [formatFacts(property), formatSqft(property.sqft)].filter(Boolean).join(", ") : "";
  const propertyLine = property
    ? `${cleanText(property.address)}${facts ? ` is ${facts}` : ""}.`
    : "";
  return [
    propertyLine,
    "For the home you need to sell, start the free valuation here:",
    url,
    "After that, a person can help line up the sell-first timing.",
  ].filter(Boolean).join("\n\n");
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
  const lines = linked.slice(0, 3).flatMap((property, index) => [
    `${index + 1}. ${cleanText(property.address)}${formatFacts(property) ? ` - ${formatFacts(property)}` : ""}`,
    cleanText(property.listing_url),
  ]);
  return `Here are the listing links:\n\n${lines.join("\n\n")}`;
}

function formatTheoPropertyPhotos(properties: SheetRow[] = [], maxCount = 3): string {
  const photographed = properties.filter((property) => usablePhotoUrl(property.photo_url));
  if (!photographed.length) return "";
  const shown = photographed.slice(0, maxCount);
  const lines = shown.flatMap((property, index) => [
    `${index + 1}. ${cleanText(property.address)}${formatFacts(property) ? ` - ${formatFacts(property)}` : ""}`,
    property.listing_url ? `Listing: ${cleanText(property.listing_url)}` : "",
  ].filter(Boolean));
  const intro = shown.length === 1 ? "Sending the property photo for:" : "Sending the property photos for:";
  const serviceNote = outsideServiceArea(shown)
    ? "This looks outside our main Austin-area coverage, but I found the listing media."
    : "";
  return [serviceNote, intro, lines.join("\n\n")].filter(Boolean).join("\n\n");
}

function formatTheoPhotoLinkFallback(properties: SheetRow[] = []): string {
  const linked = properties.filter((property) => cleanText(property.listing_url));
  if (!linked.length) return "";
  const lines = linked.slice(0, 3).flatMap((property, index) => [
    `${index + 1}. ${cleanText(property.address)}${formatFacts(property) ? ` - ${formatFacts(property)}` : ""}`,
    cleanText(property.listing_url),
  ]);
  return `I found the listing, but the direct image source is not sendable by SMS. The photo gallery is here:\n\n${lines.join("\n\n")}`;
}

function formatTheoPropertyDetails(properties: SheetRow[] = []): string {
  const property = properties.find((row) => cleanText(row.address));
  if (!property) return "";
  const fields = [
    formatFacts(property),
    formatSqft(property.sqft),
    property.year_built ? `built ${cleanText(property.year_built)}` : "",
    property.property_type ? cleanText(property.property_type) : "",
  ].filter(Boolean);
  const featureText = cleanText(property.features || property.description).slice(0, 260);
  return [
    `${cleanText(property.address)}${fields.length ? `: ${fields.join(", ")}.` : "."}`,
    featureText,
    property.listing_url ? `Listing: ${cleanText(property.listing_url)}` : "",
    "Want me to send photos, book a showing, or find similar options?",
  ].filter(Boolean).join("\n\n");
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
  if (status) return `Status for ${cleanText(property.address)}: ${status}.`;
  return `I have ${cleanText(property.address)} in the saved listing inventory, but I don't have a live availability status field for it yet. I can still send the listing, photos, or help book a showing so the team can confirm access.`;
}

function formatTheoAmenityAnswer(property: SheetRow, message: string): string {
  const requested = requestedAmenityLabels(message);
  const listingText = cleanText([property.features, property.description].filter(Boolean).join(" "));
  if (!requested.length) {
    return [
      `${cleanText(property.address)}${formatFacts(property) ? ` - ${formatFacts(property)}` : ""}.`,
      listingText
        ? `The saved listing notes mention: ${listingText.slice(0, 260)}.`
        : "I don't have more amenity notes saved for that listing yet.",
      property.listing_url ? `Listing: ${cleanText(property.listing_url)}` : "",
      "Want me to send photos, book a showing, or find options with specific amenities?",
    ].filter(Boolean).join("\n\n");
  }
  const mentioned = requested.filter((label) => new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\/.*/, "")}\\b`, "i").test(listingText));
  const unknown = requested.filter((label) => !mentioned.includes(label));
  const knownLine = mentioned.length
    ? `The saved listing text mentions: ${mentioned.join(", ")}.${unknown.length ? ` I don't see ${unknown.join(", ")} confirmed in the saved listing fields yet.` : ""}`
    : `I don't see ${requested.join(", ")} confirmed in the saved listing fields yet.`;
  return [
    `${cleanText(property.address)}${formatFacts(property) ? ` - ${formatFacts(property)}` : ""}.`,
    knownLine,
    listingText ? `Listing notes: ${listingText.slice(0, 220)}` : "",
    "Want me to send the listing/photos or find options that clearly match that?",
  ].filter(Boolean).join("\n\n");
}

function formatTheoShowingRequest(properties: SheetRow[] = []): string {
  const property = properties.find((row) => cleanText(row.address));
  const propertyLine = property
    ? `${cleanText(property.address)}${formatFacts(property) ? ` - ${formatFacts(property)}` : ""}.`
    : "";
  return [
    propertyLine,
    "I can help with that. What day and time works best, morning or afternoon?",
  ].filter(Boolean).join("\n\n");
}

function formatTheoPropertyComparison(properties: SheetRow[] = [], message: string): string {
  const usable = properties.filter((property) => cleanText(property.address));
  if (!usable.length) return "";
  const normalized = normalizeFollowupText(message);
  let label = "Here is the cleanest comparison from the saved listings:";
  let sorted = [...usable];
  if (/\b(cheapest|lowest|least expensive|most affordable|best deal|better)\b/i.test(normalized)) {
    sorted = sorted
      .filter((property) => numericValue(property.price) != null)
      .sort((a, b) => (numericValue(a.price) || 0) - (numericValue(b.price) || 0));
    label = "Lowest listed price from these options:";
  } else if (/\b(highest|most expensive)\b/i.test(normalized)) {
    sorted = sorted
      .filter((property) => numericValue(property.price) != null)
      .sort((a, b) => (numericValue(b.price) || 0) - (numericValue(a.price) || 0));
    label = "Highest listed price from these options:";
  } else if (/\b(largest|biggest)\b/i.test(normalized)) {
    sorted = sorted
      .filter((property) => numericValue(property.sqft) != null)
      .sort((a, b) => (numericValue(b.sqft) || 0) - (numericValue(a.sqft) || 0));
    label = "Largest saved listing from these options:";
  } else if (/\b(smallest)\b/i.test(normalized)) {
    sorted = sorted
      .filter((property) => numericValue(property.sqft) != null)
      .sort((a, b) => (numericValue(a.sqft) || 0) - (numericValue(b.sqft) || 0));
    label = "Smallest saved listing from these options:";
  }
  if (!sorted.length) sorted = usable;
  const lines = sorted.slice(0, 3).map((property, index) => `${index + 1}. ${cleanText(property.address)}${formatOptionFacts(property) ? ` - ${formatOptionFacts(property)}` : ""}`);
  return [
    label,
    lines.join("\n"),
    "Want photos, the listing link, or similar options for one of these?",
  ].join("\n\n");
}

function formatTheoPropertySafeAnswer(properties: SheetRow[] = [], message: string): string {
  const property = properties.find((row) => cleanText(row.address));
  if (asksForPropertyShowing(message)) return formatTheoShowingRequest(properties);
  if (asksForPropertyComparison(message) && properties.length > 1) return formatTheoPropertyComparison(properties, message);
  if (!property) return "";
  if (asksForPropertyAvailability(message)) return [
    formatTheoAvailabilityAnswer(property),
    property.listing_url ? `Listing: ${cleanText(property.listing_url)}` : "",
  ].filter(Boolean).join("\n\n");
  if (asksForPropertyAmenities(message)) return formatTheoAmenityAnswer(property, message);
  return formatTheoPropertyDetails(properties);
}

function formatTheoPropertyOptions(properties: SheetRow[] = [], classification: TheoClassification, message = ""): string {
  const usable = properties.filter((property) => cleanText(property.address));
  if (!usable.length) return "";
  const lines = usable.slice(0, 3).flatMap((property, index) => [
    `${index + 1}. ${cleanText(property.address)}${formatOptionFacts(property) ? ` - ${formatOptionFacts(property)}` : ""}`,
    property.listing_url ? cleanText(property.listing_url) : "",
  ].filter(Boolean));
  const needsHuman = classification.status === "needs_human" || Boolean(classification.handoffReason);
  const hasSellBeforeBuy = (classification.opportunityTags || []).includes("sell_before_buy") || classification.leadRole === "seller";
  const rejectedPrior = rejectsCurrentProperty(message);
  const intro = rejectedPrior
    ? "No problem — I'll skip that one. Here are better matches from the saved listings:"
    : needsHuman
    ? "I can do both — here are matches I found, and a person can review the part that needs judgment:"
    : "Got it — here are matches I found:";
  const humanNote = !needsHuman && hasSellBeforeBuy
    ? "Also, since selling/buying timing matters, a person should help with the valuation and transition plan."
    : "";
  return [
    intro,
    lines.join("\n\n"),
    humanNote,
    "Which one should I focus on first?",
  ].filter(Boolean).join("\n\n");
}

function formatTheoNoPropertyOptions(message: string): string {
  const normalized = normalizeFollowupText(message);
  if (/\bsimilar|same spec|same specs|other|another|alternative|options?\b/i.test(normalized)) {
    return "I don't see a clean similar match in the saved listings yet. Do you want me to widen it by price, location, or bedroom count?";
  }
  return "I don't see a clean matching listing in the saved inventory yet. Send me the area, budget, and bedroom count and I'll narrow it down.";
}

function formatTheoGeneralReply(message: string, classification: TheoClassification): string {
  if (asksForLightGreeting(message)) {
    return "Hi, this is Iris with Austin Realty. I can help find listings, send photos, compare options, or book a showing. What area, budget, and bedroom count should I search?";
  }
  if (classification.intent === "seller_lead" || classification.leadRole === "seller") {
    return "I can help with that. Are you looking for a home value estimate, help listing the property, or timing a sell-before-buy move?";
  }
  if (classification.intent === "renter_lead" || classification.leadRole === "renter") {
    return "I can help narrow rentals. What area, monthly budget, bedroom count, and move-in timing should I use?";
  }
  return "I can help narrow the search. Send me the area, budget, bedroom count, and whether you want to buy or rent.";
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
  if (/\b(rent|rental|lease|tenant)\b/i.test(text)) {
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

  const localSafetyClassification = classifyTheoMessage(context.message);
  if (
    localSafetyClassification.intent === "human_required"
    && localSafetyClassification.handoffReason !== "Lead requested a human"
  ) {
    return {
      classification: localSafetyClassification,
      reply: "I'm going to have a real person follow up on that so we handle it correctly.",
      mediaUrls: [],
      shouldSend: true,
      aiAction: "handoff_reply_ready",
      handoffReason: localSafetyClassification.handoffReason,
      status: "needs_human",
      metrics: [],
    };
  }

  if (context.lead?.phone) {
    const appointmentResult = await handleTheoAppointmentMessage(
      context.lead.phone,
      context.message,
      context.lead || null,
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
    ? formatTheoPropertyOptions(context.properties, classification, context.message)
    : "";
  if (optionsReply) {
    const mediaUrls = wantsPropertyImage(context.message)
      ? selectTheoMediaUrls(context, classification)
      : [];
    return {
      classification,
      reply: truncateSms(optionsReply, LINK_SMS_LIMIT),
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
      reply: formatTheoNoPropertyOptions(context.message),
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
      reply: truncateSms(reply, LINK_SMS_LIMIT),
      mediaUrls,
      shouldSend: true,
      aiAction: mediaUrls.length ? "property_ordinal_photos_reply_ready" : "property_ordinal_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics,
    };
  }

  const safePropertyReply = asksForPropertySafeInquiry(context.message)
    && !wantsPropertyImage(context.message)
    && !latestMessageHasSensitiveTopic(context.message)
    && (classification.intent !== "human_required" || canShareSafeFactsDuringHandoff(classification))
    ? formatTheoPropertySafeAnswer(context.properties, context.message)
    : "";
  if (safePropertyReply) {
    return {
      classification,
      reply: truncateSms(safePropertyReply, LINK_SMS_LIMIT),
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
      reply: "I can help with that. Send me the area, budget, and bedroom count, or tell me which listing you mean, and I'll narrow it down.",
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
    ? formatTheoPropertyDetails(context.properties)
    : "";
  if (detailReply) {
    const mediaUrls = wantsPropertyImage(context.message)
      ? selectTheoMediaUrls(context, classification)
      : [];
    return {
      classification,
      reply: truncateSms(detailReply, LINK_SMS_LIMIT),
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
        reply: truncateSms(photoReply, LINK_SMS_LIMIT),
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
        reply: truncateSms(fallbackReply, LINK_SMS_LIMIT),
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
    let handoffReply = "I'm going to have a real person follow up on that so we handle it correctly.";
    try {
      const generated = await generateTheoSmsWithLlm(playbookContext, classification);
      handoffReply = generated.reply;
      metrics.push(...generated.metrics);
    } catch {
      // Keep a safe handoff response if the model is unavailable.
    }
    return {
      classification,
      reply: truncateSms(handoffReply),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "handoff_reply_ready",
      handoffReason: classification.handoffReason,
      status: "needs_human",
      metrics,
    };
  }

  if (latestMessageAsksForSellerValuation(context.message) && isSellerValuationContext(context.message, classification)) {
    const valuationReply = formatTheoSellerValuationReply(context.properties);
    if (valuationReply) {
      return {
        classification,
        reply: truncateSms(valuationReply, LINK_SMS_LIMIT),
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
        reply: truncateSms(linkReply, LINK_SMS_LIMIT),
        mediaUrls: [],
        shouldSend: true,
        aiAction: "property_links_reply_ready",
        handoffReason: "",
        status: "ready_to_reply",
        metrics,
      };
    }
  }

  if (asksForLightGreeting(context.message)) {
    return {
      classification,
      reply: formatTheoGeneralReply(context.message, classification),
      mediaUrls: [],
      shouldSend: true,
      aiAction: "general_lead_reply_ready",
      handoffReason: "",
      status: "ready_to_reply",
      metrics,
    };
  }

  let reply: string;
  try {
    const generated = await generateTheoSmsWithLlm(playbookContext, classification);
    reply = generated.reply;
    metrics.push(...generated.metrics);
  } catch {
    return {
      classification,
      reply: formatTheoGeneralReply(context.message, classification),
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
    reply: truncateSms(reply),
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
