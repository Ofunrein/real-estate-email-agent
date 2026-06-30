import type { Channel } from "@/lib/inboxData";
import { normalizeEmail, normalizePhone } from "@/lib/leadIdentity";
import type { SheetRow } from "@/lib/sheetSchema";
import type { TheoClassification } from "@/lib/theoAgent";

export type LeadProfileDetails = {
  email: string;
  phone: string;
  fullName: string;
};

export type LeadCaptureDecision = {
  extracted: LeadProfileDetails;
  shouldAsk: boolean;
  askFor: "email" | "phone" | "full_name" | "";
  question: string;
  reason: string;
};

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/;
const NAME_RE = /\b(?:my name is|name is|i am|i'm|this is)\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+){0,2})\b/i;
const BAD_NAME_STARTS = new Set([
  "looking",
  "interested",
  "preapproved",
  "approved",
  "trying",
  "searching",
  "buying",
  "selling",
  "renting",
  "calling",
  "texting",
  "asking",
  "available",
  "under",
  "over",
]);

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function titleName(value: string): string {
  return clean(value)
    .replace(/\s+\b(?:and|email|phone|number|at)\b.*$/i, "")
    .split(" ")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : "")
    .join(" ");
}

export function isRealPhone(value?: string): boolean {
  const normalized = normalizePhone(value);
  return normalized.length >= 10 && normalized.length <= 15;
}

function formatCapturedPhone(value: string): string {
  const normalized = normalizePhone(value);
  if (normalized.length === 11 && normalized.startsWith("1")) return `+${normalized}`;
  if (normalized.length === 10) return `+1${normalized}`;
  return normalized ? `+${normalized}` : "";
}

export function extractLeadProfileDetails(message = ""): LeadProfileDetails {
  const email = normalizeEmail(message.match(EMAIL_RE)?.[0] || "");
  const phoneMatch = message.match(PHONE_RE)?.[0] || "";
  const phone = phoneMatch ? formatCapturedPhone(phoneMatch) : "";
  const nameMatch = message.match(NAME_RE)?.[1] || "";
  const first = clean(nameMatch).split(" ")[0]?.toLowerCase() || "";
  const fullName = nameMatch && !BAD_NAME_STARTS.has(first) ? titleName(nameMatch) : "";
  return { email, phone, fullName };
}

export function leadProfileMemoryPatch(input: {
  extracted: LeadProfileDetails;
  existing?: Partial<SheetRow>;
  channel: Channel | "website_chat";
  source?: string;
  message?: string;
}): Partial<SheetRow> {
  const patch: Partial<SheetRow> = {};
  if (input.extracted.email) patch.email = input.extracted.email;
  if (input.extracted.phone) patch.phone = input.extracted.phone;
  if (input.extracted.fullName) patch.full_name = input.extracted.fullName;
  if (!patch.email && input.existing?.email) patch.email = input.existing.email;
  if (!patch.phone && input.existing?.phone && isRealPhone(input.existing.phone)) patch.phone = input.existing.phone;
  if (!patch.full_name && input.existing?.full_name) patch.full_name = input.existing.full_name;
  if (!patch.email && !patch.phone && !patch.full_name) return {};
  patch.lead_source = input.source || input.existing?.lead_source || input.channel;
  patch.last_channel = input.channel;
  patch.preferred_channel = input.existing?.preferred_channel || input.channel;
  patch.summary = input.message || input.existing?.summary || "";
  return patch;
}

function hasEmail(lead?: Partial<SheetRow>, extracted?: LeadProfileDetails): boolean {
  return Boolean(normalizeEmail(extracted?.email || lead?.email));
}

function hasRealLeadPhone(lead?: Partial<SheetRow>, extracted?: LeadProfileDetails): boolean {
  return isRealPhone(extracted?.phone || lead?.phone);
}

function hasName(lead?: Partial<SheetRow>, extracted?: LeadProfileDetails): boolean {
  return Boolean(clean(extracted?.fullName || lead?.full_name));
}

function highIntent(message: string, classification?: Partial<TheoClassification>): boolean {
  const tags = classification?.opportunityTags || [];
  return classification?.intent === "showing_request"
    || classification?.intent === "seller_lead"
    || classification?.status === "needs_human"
    || tags.includes("hot_lead")
    || /\b(tour|showing|see it|view it|walk.?through|book|schedule|appointment|send|text me|email me|call me|pre.?approved|ready to buy|make an offer|valuation|sell my|list my)\b/i.test(message);
}

function socialChannel(channel: Channel | "website_chat"): boolean {
  return channel === "instagram" || channel === "messenger";
}

export function decideLeadProfileCapture(input: {
  channel: Channel | "website_chat";
  message: string;
  lead?: Partial<SheetRow>;
  classification?: Partial<TheoClassification>;
}): LeadCaptureDecision {
  const extracted = extractLeadProfileDetails(input.message);
  const important = highIntent(input.message, input.classification);
  const hasQuestionableIdentity = socialChannel(input.channel) || input.channel === "website_chat";

  if (!important) {
    return { extracted, shouldAsk: false, askFor: "", question: "", reason: "low_intent" };
  }

  if (socialChannel(input.channel)) {
    if (!hasRealLeadPhone(input.lead, extracted)) {
      return {
        extracted,
        shouldAsk: true,
        askFor: "phone",
        question: "I can keep sending them here too. Want a text copy? What number should I use?",
        reason: "social_high_intent_missing_phone",
      };
    }
    if (!hasEmail(input.lead, extracted)) {
      return {
        extracted,
        shouldAsk: true,
        askFor: "email",
        question: "I can keep sending them here too. What email should I copy if you want the list there as well?",
        reason: "social_high_intent_missing_email",
      };
    }
  }

  if (input.channel === "sms" || input.channel === "whatsapp" || input.channel === "voice") {
    if (!hasName(input.lead, extracted) && /\b(showing|tour|book|appointment|pre.?approved|offer|human|person|agent)\b/i.test(input.message)) {
      return {
        extracted,
        shouldAsk: true,
        askFor: "full_name",
        question: "What name should I put this under?",
        reason: "phone_channel_high_intent_missing_name",
      };
    }
    if (!hasEmail(input.lead, extracted) && /\b(send|links?|photos?|full list|details|showing|tour|appointment)\b/i.test(input.message)) {
      return {
        extracted,
        shouldAsk: true,
        askFor: "email",
        question: "I can keep sending them here too. What email should I copy if you want the list there as well?",
        reason: "phone_channel_high_intent_missing_email",
      };
    }
  }

  if (input.channel === "email" && !hasRealLeadPhone(input.lead, extracted)) {
    return {
      extracted,
      shouldAsk: true,
      askFor: "phone",
      question: "What number should the team use if we need to confirm details fast?",
      reason: "email_high_intent_missing_phone",
    };
  }

  if (input.channel === "website_chat" && hasQuestionableIdentity && !hasEmail(input.lead, extracted) && !hasRealLeadPhone(input.lead, extracted)) {
    return {
      extracted,
      shouldAsk: true,
      askFor: "phone",
      question: "What phone or email should the team use if we need to follow up?",
      reason: "chat_high_intent_missing_contact",
    };
  }

  return { extracted, shouldAsk: false, askFor: "", question: "", reason: "profile_sufficient" };
}

export function appendLeadProfileCaptureAsk(reply: string, decision: LeadCaptureDecision, limit = 320): string {
  const base = clean(reply);
  if (!decision.shouldAsk || !decision.question || !base) return base;
  const alreadyAsked = new RegExp(decision.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(base);
  if (alreadyAsked) return base;
  if (/\?/.test(base)) return base;
  const next = `${base}\n\n${decision.question}`;
  return next.length <= limit ? next : base;
}
