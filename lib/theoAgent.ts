import type { SheetRow } from "@/lib/sheetSchema";

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
  handoffReason: string;
  status: string;
};

export type TheoReplyContext = {
  message: string;
  lead?: Partial<SheetRow>;
  properties?: SheetRow[];
  propertyInterest?: string;
  source?: "sms" | "form";
};

export type TheoReplyResult = {
  classification: TheoClassification;
  reply: string;
  shouldSend: boolean;
  aiAction: string;
  handoffReason: string;
  status: string;
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

function firstProperty(properties: SheetRow[] = [], interest = "", message = ""): SheetRow | undefined {
  const needle = normalize(interest || message);
  if (!properties.length) return undefined;
  if (!needle) return properties[0];
  return properties.find((property) => {
    const address = normalize(property.address);
    const street = address.split(",", 1)[0];
    return Boolean(address && (needle.includes(address) || address.includes(needle) || needle.includes(street)));
  }) || properties[0];
}

function propertyLabel(property?: SheetRow): string {
  const address = cleanText(property?.address || "");
  return address ? address.split(",", 1)[0] : "that property";
}

function numberText(value: string): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric.toLocaleString();
  return value;
}

function propertyFacts(property?: SheetRow): string {
  if (!property) return "";
  const facts = [
    property.price ? `$${numberText(property.price)}` : "",
    property.beds ? `${property.beds} bed` : "",
    property.baths ? `${property.baths} bath` : "",
    property.sqft ? `${numberText(property.sqft)} sqft` : "",
  ].filter(Boolean);
  return facts.join(", ");
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

export function generateTheoReply(context: TheoReplyContext): TheoReplyResult {
  const classification = classifyTheoMessage(context.message);
  const lead = context.lead || {};
  const shouldReply = shouldTheoAutoReply(classification, lead);
  const property = firstProperty(
    context.properties || [],
    context.propertyInterest || lead.property_interest || "",
    context.message,
  );

  if (!shouldReply) {
    return {
      classification,
      reply: "",
      shouldSend: false,
      aiAction: "auto_reply_blocked",
      handoffReason: classification.handoffReason || "Theo should not auto-reply to this SMS",
      status: classification.status,
    };
  }

  if (classification.intent === "human_required") {
    return {
      classification,
      reply: "I'm going to have a real person follow up on that so we handle it correctly.",
      shouldSend: true,
      aiAction: "handoff_reply_ready",
      handoffReason: classification.handoffReason,
      status: "needs_human",
    };
  }

  const label = propertyLabel(property);
  const facts = propertyFacts(property);
  let reply = "";

  if (context.source === "form") {
    reply = `Hey, this is Theo with Austin Realty. Got your inquiry about ${context.propertyInterest || label}. Are you looking to tour, get details, or compare similar homes?`;
  } else if (classification.intent === "showing_request") {
    reply = `Got it. I can help with ${label}. What day/time works best for a quick showing?`;
  } else if (classification.intent === "seller_lead") {
    reply = "Got it. Are you looking for a quick home value estimate, or are you thinking about listing soon?";
  } else if (classification.intent === "renter_lead") {
    reply = "Got it. Are you only looking to rent right now, or would you consider buying if the numbers made sense?";
  } else if (property) {
    reply = facts
      ? `Got it. ${label} is showing in our sheet at ${facts}. Are you looking to tour it or compare similar homes?`
      : `Got it. I found ${label} in our sheet. Are you looking to tour it or get more details?`;
  } else {
    reply = "Got it. Are you looking for a specific home, or should I help you compare a few options?";
  }

  return {
    classification,
    reply: truncateSms(reply),
    shouldSend: true,
    aiAction: "reply_ready",
    handoffReason: "",
    status: "ready_to_reply",
  };
}

export function smsOptIn(value: unknown): boolean {
  return ["1", "true", "yes", "on", "y", "opt-in", "opt_in", "consent"].includes(String(value || "").trim().toLowerCase());
}
