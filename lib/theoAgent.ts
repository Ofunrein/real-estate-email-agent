import type { SheetRow } from "@/lib/sheetSchema";
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
  source?: "sms" | "form";
  recentEvents?: SheetRow[];
  dataContext?: string;
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

function cleanText(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalize(value?: string): string {
  return cleanText(value).toLowerCase();
}

function truncateSms(value: string): string {
  const clean = cleanText(value);
  if (clean.length <= SMS_LIMIT) return clean;
  return `${clean.slice(0, SMS_LIMIT - 1).trimEnd()}...`;
}

function envFlag(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function smsImagesEnabled(): boolean {
  return envFlag(process.env.ENABLE_SMS_IMAGES);
}

function smsImageMode(): string {
  return (process.env.SMS_IMAGE_MODE || "on_request").trim().toLowerCase();
}

function wantsPropertyImage(message: string): boolean {
  return /\b(photo|photos|picture|pictures|image|images|pic|pics|look like|see it|show me)\b/i.test(message);
}

function asksForSafePropertyFact(message: string): boolean {
  return /\b(photo|photos|picture|pictures|image|images|pic|pics|look like|see it|show me|price|bed|beds|bath|baths|sqft|square feet|year built|built|features|details|address|zip|status|available|listing|link|agent)\b/i.test(message);
}

function canShareSafeFactsDuringHandoff(classification: TheoClassification): boolean {
  const flags = (classification.complianceFlags || []).map((flag) => flag.toLowerCase());
  return !flags.some((flag) => ["fair_housing", "mortgage_license", "legal", "contract_terms", "privacy", "broker_approval"].includes(flag));
}

function usablePhotoUrl(value?: string): string {
  const url = cleanText(value);
  if (!/^https:\/\//i.test(url)) return "";
  if (/\.(jpe?g|png|gif)(\?|$)/i.test(url)) return url;
  if (/zillowstatic\.com|maps\.googleapis\.com|googleusercontent\.com/i.test(url)) return url;
  return "";
}

export function selectTheoMediaUrls(context: TheoReplyContext, classification: TheoClassification): string[] {
  if (!smsImagesEnabled()) return [];
  if (classification.intent === "spam") return [];
  if (classification.intent === "human_required" && (!asksForSafePropertyFact(context.message) || !canShareSafeFactsDuringHandoff(classification))) return [];

  const mode = smsImageMode();
  if (mode === "off") return [];
  if (mode === "on_request" && !wantsPropertyImage(context.message)) return [];
  if (!["on_request", "property_reply"].includes(mode)) return [];

  const maxImages = Math.max(0, Number(process.env.SMS_MAX_IMAGES || "1"));
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
  if (/\b(buy|buyer|looking for|interested|available|details|price|bed|bath|sqft|address)\b/i.test(text)) {
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
