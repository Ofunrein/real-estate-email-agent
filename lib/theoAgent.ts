import type { SheetRow } from "@/lib/sheetSchema";
import { CENTRAL_TEXAS_CITIES } from "@/lib/serviceAreas";
import { handleTheoAppointmentMessage } from "@/lib/theoAppointments";
import { classifyTheoWithLlm, generateTheoSmsWithLlm } from "@/lib/theoLlm";
import type { TheoMetric } from "@/lib/theoTelemetry";

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
  source?: "sms" | "form" | "whatsapp";
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
  /\b(crypto|forex|seo services|guest post|casino|loan offer)\b/i,
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

function mediaImagesEnabled(source?: TheoReplyContext["source"]): boolean {
  return source === "whatsapp" ? whatsAppImagesEnabled() : smsImagesEnabled();
}

function smsImageMode(): string {
  return (process.env.SMS_IMAGE_MODE || "on_request").trim().toLowerCase();
}

function wantsPropertyImage(message: string): boolean {
  return /\b(photo|photos|picture|pictures|image|images|pic|pics|look like|see it|show me)\b/i.test(message);
}

function wantsPropertyLinks(message: string): boolean {
  return /\b(link|links|url|urls|website|listing page|zillow)\b/i.test(message);
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
  return /\b(photo|photos|picture|pictures|image|images|pic|pics|look like|see it|show me|price|bed|beds|bath|baths|sqft|square feet|year built|built|features|details|address|zip|status|available|listing|link|agent)\b/i.test(message);
}

function asksForAlternativeProperties(message: string): boolean {
  return /\b(other|another|similar|same spec|same specs|same size|same price|neighboring|neighbor|nearby|next to|close by|comparable|alternative|options?|properties|homes?|listings?)\b/i.test(message)
    && /\b(show|send|see|tell|find|recommend|compare|options?|properties|homes?|listings?|spec|specs)\b/i.test(message);
}

function asksForPropertyOptions(message: string): boolean {
  return asksForAlternativeProperties(message)
    || /\b(something close|close to (?:the )?(?:\d+\s*)?(?:bed|bd|bedroom|layout)|\d+\s*(?:bed|bd|bedroom).{0,40}layout|sticking to \d+\s*(?:bed|bd|bedroom)|find .{0,30}\d+\s*(?:bed|bd|bedroom)|want .{0,30}\d+\s*(?:bed|bd|bedroom))\b/i.test(message);
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
  const numeric = cleanText(value).replace(/[^\d.]/g, "");
  if (!numeric) return cleanText(value);
  const amount = Number(numeric);
  return Number.isFinite(amount) ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : cleanText(value);
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

function formatTheoPropertyPhotos(properties: SheetRow[] = []): string {
  const photographed = properties.filter((property) => usablePhotoUrl(property.photo_url));
  if (!photographed.length) return "";
  const lines = photographed.slice(0, 3).flatMap((property, index) => [
    `${index + 1}. ${cleanText(property.address)}${formatFacts(property) ? ` - ${formatFacts(property)}` : ""}`,
    property.listing_url ? `Listing: ${cleanText(property.listing_url)}` : "",
  ].filter(Boolean));
  const intro = photographed.length === 1 ? "Sending the property photo for:" : "Sending the property photos for:";
  const serviceNote = outsideServiceArea(photographed)
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

function formatTheoPropertyOptions(properties: SheetRow[] = [], classification: TheoClassification): string {
  const usable = properties.filter((property) => cleanText(property.address));
  if (!usable.length) return "";
  const lines = usable.slice(0, 3).flatMap((property, index) => [
    `${index + 1}. ${cleanText(property.address)}${formatOptionFacts(property) ? ` - ${formatOptionFacts(property)}` : ""}`,
    property.listing_url ? cleanText(property.listing_url) : "",
  ].filter(Boolean));
  const needsHuman = classification.status === "needs_human" || Boolean(classification.handoffReason);
  const hasSellBeforeBuy = (classification.opportunityTags || []).includes("sell_before_buy") || classification.leadRole === "seller";
  const intro = needsHuman
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

export function selectTheoMediaUrls(context: TheoReplyContext, classification: TheoClassification): string[] {
  if (!mediaImagesEnabled(context.source)) return [];
  if (classification.intent === "spam") return [];
  if (classification.intent === "human_required" && (!asksForSafePropertyFact(context.message) || !canShareSafeFactsDuringHandoff(classification))) return [];

  const mode = smsImageMode();
  if (mode === "off") return [];
  if (mode === "on_request" && !wantsPropertyImage(context.message)) return [];
  if (!["on_request", "property_reply"].includes(mode)) return [];

  const maxImages = Math.max(0, Number((context.source === "whatsapp" ? process.env.WHATSAPP_MAX_IMAGES : "") || process.env.SMS_MAX_IMAGES || "3"));
  return (context.properties || [])
    .map((property) => usablePhotoUrl(property.photo_url))
    .filter(Boolean)
    .slice(0, maxImages);
}

export function classifyTheoMessage(message: string): TheoClassification {
  const text = normalize(message);
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

  let classification: TheoClassification;
  const metrics: TheoMetric[] = [];
  try {
    classification = await classifyTheoWithLlm(context);
    metrics.push(...(classification.metrics || []));
  } catch {
    classification = classifyTheoMessage(context.message);
    if (classification.status !== "needs_human") {
      classification = {
        intent: "human_required",
        leadRole: classification.leadRole || "unknown",
        handoffReason: "Theo AI classification failed",
        status: "needs_human",
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
  const lead = context.lead || {};
  const shouldReply = shouldTheoAutoReply(classification, lead);

  if (!shouldReply) {
    return {
      classification,
      reply: "",
      mediaUrls: [],
      shouldSend: false,
      aiAction: "auto_reply_blocked",
      handoffReason: classification.handoffReason || "Theo should not auto-reply to this SMS",
      status: classification.status,
      metrics,
    };
  }

  const optionsReply = asksForPropertyOptions(context.message)
    && (classification.intent !== "human_required" || canShareSafeFactsDuringHandoff(classification))
    ? formatTheoPropertyOptions(context.properties, classification)
    : "";
  if (optionsReply) {
    return {
      classification,
      reply: truncateSms(optionsReply, LINK_SMS_LIMIT),
      mediaUrls: [],
      shouldSend: true,
      aiAction: classification.status === "needs_human" ? "property_options_handoff_reply_ready" : "property_options_reply_ready",
      handoffReason: classification.status === "needs_human" ? classification.handoffReason : "",
      status: classification.status === "needs_human" ? "needs_human" : "ready_to_reply",
      metrics,
    };
  }

  if (wantsPropertyImage(context.message) && (classification.intent !== "human_required" || canShareSafeFactsDuringHandoff(classification))) {
    const mediaUrls = selectTheoMediaUrls(context, classification);
    const photoReply = formatTheoPropertyPhotos(context.properties);
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
      const generated = await generateTheoSmsWithLlm(context, classification);
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

  let reply: string;
  try {
    const generated = await generateTheoSmsWithLlm(context, classification);
    reply = generated.reply;
    metrics.push(...generated.metrics);
  } catch {
    return {
      classification: {
        intent: "human_required",
        leadRole: classification.leadRole || "unknown",
        handoffReason: "Theo AI reply generation failed",
        status: "needs_human",
      },
      reply: "I'm going to have a real person follow up so we handle that correctly.",
      mediaUrls: [],
      shouldSend: true,
      aiAction: "handoff_reply_ready",
      handoffReason: "Theo AI reply generation failed",
      status: "needs_human",
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
