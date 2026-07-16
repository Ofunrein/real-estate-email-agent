import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { removeEmDashes } from "@/lib/noEmDash";
import {
  appendConversationEventToDatabase,
  databaseEnabled,
  findCandidatePropertiesFromDatabase,
  findPropertiesByAddressesFromDatabase,
  findLeadInDatabase,
  hasOutboundEmailReplyAfterEventInDatabase,
  readConversationEventByGmailMessageId,
  readEventsForLeadFromDatabase,
  readInboxCategoriesFromDatabase,
  updateInboxCategoryGmailLabelInDatabase,
  upsertAiDraftInDatabase,
  upsertThreadLinkInDatabase,
  upsertLeadMemoryToDatabase,
} from "@/lib/database";
import {
  createGmailReplyDraftWithOptions,
  createIrisGmailSession,
  ensureGmailLabel,
  sendGmailReplyWithOptions,
  type GmailClient,
  type GmailDraftResult,
  type GmailReplyResult,
} from "@/lib/gmailConnection";
import { inferCategorySlug, type InboxCategory } from "@/lib/inboxSettings";
import { isProxiableImageUrl, mediaProxyUrl } from "@/lib/mediaProxy";
import { writeRequestAuditEvent } from "@/lib/requestAudit";
import { retrievePropertiesForAgent } from "@/lib/propertyRetrieval";
import { understandMediaItems } from "@/lib/mediaUnderstanding";
import { advancedQualificationPlaybook } from "@/lib/qualificationPlaybooks";
import { normalizedMessageText, type OmnichannelMedia } from "@/lib/omnichannelEvents";
import type { SheetRow } from "@/lib/sheetSchema";

export type IrisEmailIntent =
  | "property_search"
  | "property_details"
  | "showing_request"
  | "seller_lead"
  | "buyer_lead"
  | "renter_lead"
  | "human_required"
  | "spam";

export type IrisLeadRole =
  | "buyer"
  | "seller"
  | "first_time_buyer"
  | "second_time_buyer"
  | "renter"
  | "landlord"
  | "investor"
  | "expired_listing_seller"
  | "open_house_lead"
  | "property_management_lead"
  | "mortgage_adjacent_lead"
  | "unknown";

export type IrisLeadFields = {
  timeline: string | null;
  budget: string | null;
  area: string | null;
  beds: string | null;
  current_property_status: "owns" | "rents" | "listed" | "expired" | "under_contract" | "sold" | "unknown" | null;
  preferred_channel: "email" | "phone" | "sms" | "unknown" | null;
};

export type IrisEmailClassification = {
  intent: IrisEmailIntent;
  message_intent: IrisEmailIntent;
  primary_lead_role: IrisLeadRole;
  secondary_roles: IrisLeadRole[];
  opportunity_tags: string[];
  tone_state: "neutral" | "warm" | "skeptical" | "price_sensitive" | "overwhelmed" | "annoyed" | "confused" | "urgent" | "sensitive";
  urgency: "low" | "medium" | "high" | "unknown";
  compliance_flags: string[];
  confidence: number;
  address: string | null;
  addresses: string[];
  lead_fields: IrisLeadFields;
  next_best_question: string | null;
  recommended_next_action: "reply_and_qualify" | "send_booking_link" | "route_human" | "nurture" | "stop" | "review";
  human_handoff_reason: string | null;
};

export type IrisEmailMessage = {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  body: string;
  snippet?: string;
  messageId?: string;
  references?: string;
  receivedAt?: string;
  mailboxEmail?: string;
  media?: OmnichannelMedia[];
};

export type IrisEmailExecution = {
  labels: ("AUTO_REPLIED" | "NEEDS_HUMAN")[];
  status: "processed" | "needs_human" | "spam";
  eventType: "email_inbound" | "human_handoff" | "spam";
  aiAction: "draft_reply" | "route_human" | "review";
  canReply: boolean;
  handoffReason: string;
};

export type IrisEmailProcessResult = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  classification: IrisEmailClassification;
  execution: IrisEmailExecution;
  replyDraft: string | null;
  recorded: boolean;
  labeled: boolean;
  sent: boolean;
  skippedDuplicate: boolean;
  dryRun: boolean;
};

export type IrisEmailPollResult = {
  ok: true;
  dryRun: boolean;
  processed: number;
  recorded: number;
  labeled: number;
  sent: number;
  results: IrisEmailProcessResult[];
};

export function coalesceIrisEmailThreadFollowUps(messages: IrisEmailMessage[]): {
  messages: IrisEmailMessage[];
  superseded: IrisEmailMessage[];
} {
  const groups = new Map<string, Array<{ message: IrisEmailMessage; index: number; receivedAt: number }>>();
  messages.forEach((message, index) => {
    const parsed = Date.parse(message.receivedAt || "");
    const group = groups.get(message.threadId || message.id) || [];
    group.push({ message, index, receivedAt: Number.isFinite(parsed) ? parsed : -index });
    groups.set(message.threadId || message.id, group);
  });
  const current: IrisEmailMessage[] = [];
  const superseded: IrisEmailMessage[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.receivedAt - b.receivedAt);
    const latest = group.at(-1)!;
    current.push({ ...latest.message, body: group.map(({ message }) => message.body.trim()).filter(Boolean).join("\n\n") || latest.message.body });
    superseded.push(...group.slice(0, -1).map(({ message }) => message));
  }
  return { messages: current, superseded };
}

export type IrisEmailClient = {
  listUnreadMessages(limit: number): Promise<IrisEmailMessage[]>;
  applyLabels(messageId: string, labels: string[]): Promise<void>;
  syncCategoryLabels?(categories: InboxCategory[]): Promise<InboxCategory[]>;
  sendReply?(message: IrisEmailMessage, body: string, htmlBody?: string): Promise<GmailReplyResult | void>;
  createDraft?(message: IrisEmailMessage, body: string, htmlBody?: string): Promise<GmailDraftResult | void>;
};

export type IrisEmailReplyDraft = {
  text: string;
  html?: string;
};

export type IrisEmailRecorder = (
  message: IrisEmailMessage,
  classification: IrisEmailClassification,
  execution: IrisEmailExecution,
  replyDraft: string | null,
) => Promise<void>;

export type IrisEmailPollOptions = {
  limit?: number;
  dryRun?: boolean;
  sendReplies?: boolean;
};

export type IrisEmailPollDeps = {
  emailClient?: IrisEmailClient;
  recordInteraction?: IrisEmailRecorder;
  classify?: (message: IrisEmailMessage) => IrisEmailClassification;
  generateReply?: (message: IrisEmailMessage, classification: IrisEmailClassification) => string | IrisEmailReplyDraft | null | Promise<string | IrisEmailReplyDraft | null>;
  duplicateExists?: (gmailMessageId: string) => Promise<boolean>;
};

const SENSITIVE_FLAGS = new Set([
  "fair_housing",
  "mortgage_license",
  "legal",
  "contract_terms",
  "angry_or_complaint",
  "privacy",
  "broker_approval",
]);

const STREET_ADDRESS_RE =
  /\b\d{2,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,7}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|cir|circle|blvd|boulevard|way|pkwy|parkway|pl|place|path|trl|trail|ter|terrace)\b/gi;
const PROPERTY_URL_RE =
  /\bhttps?:\/\/(?:www\.)?(?:zillow|realtor|redfin|homes|trulia)\.com\/[^\s<>"')]+/gi;

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function cleanBody(text: string): string {
  const lines = text.split(/\r?\n/);
  const current = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith(">") && !/^on .+ wrote:?$/i.test(trimmed);
  });
  return current.join("\n").trim() || text.trim();
}

const THREAD_CONTEXT_MARKER = "Thread context for classification only:";

function latestEmailBody(body: string): string {
  return body.split(THREAD_CONTEXT_MARKER)[0] || body;
}

function threadContextBody(body: string): string {
  const markerIndex = body.indexOf(THREAD_CONTEXT_MARKER);
  return markerIndex >= 0 ? body.slice(markerIndex + THREAD_CONTEXT_MARKER.length) : "";
}

function asksForDifferentProperty(text: string): boolean {
  return /\b(no longer interested|not interested in (?:this|that|the|current) property|what else|else can we do|other options?|different options?|alternatives?|another|better fit|better fits|instead|similar options?|show me options?)\b/i.test(text);
}

function canResolveFromPriorProperty(latestText: string): boolean {
  if (asksForDifferentProperty(latestText)) return false;
  return /\b(this property|that property|the property|that one|this one|it|same one|first(?:\s+(?:one|property|listing|option))?|second(?:\s+(?:one|property|listing|option))?|third(?:\s+(?:one|property|listing|option))?|take a look|tour|showing|schedule|tomorrow|today|noon|morning|afternoon|evening|this friday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i.test(latestText);
}

export function parseEmailContact(value = ""): { name: string; email: string } {
  const trimmed = value.trim();
  const bracket = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (bracket) {
    const name = bracket[1].trim().replace(/^"|"$/g, "").trim();
    return {
      name,
      email: bracket[2].trim().toLowerCase(),
    };
  }
  const bare = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return { name: "", email: (bare?.[0] || trimmed).trim().toLowerCase() };
}

export function detectIrisComplianceFlags(text: string): string[] {
  const text_l = text.replace(/\s+/g, " ").toLowerCase();
  const flags: string[] = [];
  if (/(safe neighborhood|good neighborhood for families|families with kids|people like me|demographics|ethnicity|race|religion|mostly families|mostly young|crime rate)/.test(text_l)) {
    flags.push("fair_housing");
  }
  if (/(do i qualify|can i qualify|will i qualify|get approved|approved for a loan|what rate can i get|which loan should|should i choose fha|nmls)/.test(text_l)) {
    flags.push("mortgage_license");
  }
  if (/(legal advice|attorney|lawyer|lawsuit|sue|break my lease|evict|eviction)/.test(text_l)) {
    flags.push("legal");
  }
  if (/(waive inspection|contract|counteroffer|commission|buyer agreement|listing agreement|agency agreement|representation agreement)/.test(text_l)) {
    flags.push("contract_terms");
  }
  if (/(scam|fraud|bait and switch|report you|harassment|stop spamming|spam complaint)/.test(text_l)) {
    flags.push("angry_or_complaint");
  }
  if (/(social security|ssn|bank account|routing number)/.test(text_l)) {
    flags.push("privacy");
  }
  return flags;
}

function extractAddresses(text: string): string[] {
  return uniq((text.match(STREET_ADDRESS_RE) || []).map((value) => value.replace(/\s+/g, " ")));
}

function extractPropertyUrls(text: string): string[] {
  return uniq(text.match(PROPERTY_URL_RE) || []);
}

const BUDGET_TOKEN_RE = /\$ ?\d[\d,.]*(?:\s?[kKmM])?|\b\d[\d,.]*\s?(?:k|m)\b/g;

function budgetTokenToNumber(token: string): number | null {
  const cleaned = token.replace(/[$,\s]/g, "").toLowerCase();
  const suffix = cleaned.slice(-1);
  const base = parseFloat(cleaned.replace(/[km]$/, ""));
  if (!Number.isFinite(base)) return null;
  if (suffix === "k") return base * 1_000;
  if (suffix === "m") return base * 1_000_000;
  return base;
}

// Returns [minPrice, maxPrice]. Handles ranges ("$400k to $600k", "between 400-600k")
// so the LOWER number is the floor and the UPPER number is the ceiling. Previously a
// range like "$400,000 to $600,000" grabbed only "$400,000" and used it as maxPrice,
// which silently capped the search at the buyer's floor. See docs/decisions.
function extractBudgetRange(text: string): { min: number | null; max: number | null } {
  const tokens = text.match(BUDGET_TOKEN_RE) || [];
  const nums = tokens.map(budgetTokenToNumber).filter((n): n is number => n != null && n > 0);
  if (!nums.length) return { min: null, max: null };
  const rangeLike = /(between|from|range|\bto\b|[-–—])/i.test(text) && nums.length >= 2;
  if (rangeLike) {
    const sorted = [...nums].sort((a, b) => a - b);
    return { min: sorted[0], max: sorted[sorted.length - 1] };
  }
  // Single figure: treat as a ceiling ("under $600k", "around $500k").
  return { min: null, max: Math.max(...nums) };
}

function extractBudget(text: string): string | null {
  const match = text.match(/\$ ?\d[\d,.]*(?:\s?[kKmM])?|\b\d[\d,.]*\s?(?:k|m)\b/);
  return match ? match[0].replace(/\s+/g, "") : null;
}

// The DB lead-context block (see messageWithLeadContext) injects prior known fields
// as labeled lines: "Known area: Round Rock", "Known bedrooms: 4", "Known budget: ...",
// "Previous property interest: ...". Free-text extractors miss these, so parse the
// labels directly. This is the carry-forward source for follow-up emails that only
// answer one new question.
function labeledContextValue(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]\\s*(.+)`, "i");
    const m = text.match(re);
    if (m && m[1].trim()) return m[1].trim().split(/\n/)[0].trim();
  }
  return null;
}

function contextArea(contextClean: string): string | null {
  return extractArea(contextClean) || labeledContextValue(contextClean, ["Known area"]);
}

function contextBeds(contextClean: string): string | null {
  return extractBeds(contextClean) || (() => {
    const v = labeledContextValue(contextClean, ["Known bedrooms", "Known beds"]);
    const n = v?.match(/\d+/);
    return n ? n[0] : null;
  })();
}

function contextBudget(contextClean: string): string | null {
  return extractBudget(contextClean) || (() => {
    const v = labeledContextValue(contextClean, ["Known budget"]);
    return v ? extractBudget(v) || v : null;
  })();
}

function contextTimeline(contextClean: string): string | null {
  return extractTimeline(contextClean) || labeledContextValue(contextClean, ["Known timeline"]);
}

function extractBeds(text: string): string | null {
  const match = text.match(/\b([1-9]|one|two|three|four|five|six|seven|eight|nine)\s*(?:bed|beds|bedroom|bedrooms|bd)\b/i);
  if (!match) return null;
  const words: Record<string, string> = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
  };
  return words[match[1].toLowerCase()] || match[1];
}

function extractTimeline(text: string): string | null {
  const match = text.match(/\b(asap|today|tomorrow|this week|next week|this weekend|next month|in \d+\s+(?:days|weeks|months)|within \d+\s+(?:days|weeks|months)|\d+\s+(?:days|weeks|months))\b/i);
  return match ? match[0] : null;
}

function extractArea(text: string): string | null {
  const match = text.match(/\b(?:in|near|around)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\b/);
  if (!match) return null;
  return match[1].replace(/\b(?:for|with|under|below|about)\b.*$/i, "").trim() || null;
}

function preferredChannel(text: string): IrisLeadFields["preferred_channel"] {
  if (/\b(email|e-mail).{0,24}\b(best|better|preferred|works|send|reply|details|me)\b|\b(best|better|preferred|works|send).{0,24}\b(email|e-mail)\b/i.test(text)) return "email";
  if (/\b(text|sms).{0,24}\b(best|better|preferred|works|send|reply|details|me|options?)\b|\b(best|better|preferred|works|send).{0,24}\b(text|sms)\b/i.test(text)) return "sms";
  if (/\b(call|phone).{0,24}\b(best|better|preferred|works|me|back)|\b(best|better|preferred|works).{0,24}\b(call|phone)\b/i.test(text)) return "phone";
  return "email";
}

function noOrStopSignal(text: string): "stop" | "no" | "" {
  const compact = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (/^(stop|unsubscribe|remove me)$/i.test(compact)) return "stop";
  if (/(unsubscribe|do not contact|don't contact|remove me|stop contacting|stop emailing)/i.test(compact)) return "stop";
  if (/^(no|no\.|no thanks|no thank you|nah|not interested)$/i.test(compact)) return "no";
  if (/(not interested|no thanks|no thank you|stop asking)/i.test(compact)) return "no";
  return "";
}

function nextQuestion(intent: IrisEmailIntent, fields: IrisLeadFields): string | null {
  if (intent === "showing_request") return "What day and time works best for a quick showing?";
  if (!fields.timeline && ["property_search", "buyer_lead", "seller_lead", "renter_lead"].includes(intent)) return "What timeline are you working with?";
  if (!fields.area && ["property_search", "buyer_lead", "renter_lead"].includes(intent)) return "Which area should I focus on?";
  if (!fields.budget && ["property_search", "buyer_lead", "renter_lead"].includes(intent)) return "What price range should I stay under?";
  return null;
}

export function classifyIrisEmailText(message: Pick<IrisEmailMessage, "subject" | "body">): IrisEmailClassification {
  const latestClean = cleanBody(`${message.subject || ""}\n${latestEmailBody(message.body || "")}`);
  const contextClean = cleanBody(threadContextBody(message.body || ""));
  const latestAddresses = extractAddresses(latestClean);
  const contextAddresses = extractAddresses(contextClean);
  const addresses = latestAddresses.length
    ? latestAddresses
    : canResolveFromPriorProperty(latestClean)
      ? contextAddresses.slice(0, 1)
      : [];
  const propertyUrls = extractPropertyUrls(latestClean);
  const flags = detectIrisComplianceFlags(latestClean);
  const noSignal = noOrStopSignal(latestClean);
  const pivotingToOtherOptions = asksForDifferentProperty(latestClean);
  const fields: IrisLeadFields = {
    // Fields carry forward across the thread: a follow-up email that answers only
    // budget must not wipe the area/beds the lead already gave earlier. Latest
    // message wins; thread context fills the gaps. This is what stops Iris
    // re-asking "which area?" for criteria it was already told.
    timeline: extractTimeline(latestClean) || contextTimeline(contextClean),
    budget: extractBudget(latestClean) || contextBudget(contextClean),
    area: extractArea(latestClean) || contextArea(contextClean),
    beds: extractBeds(latestClean) || contextBeds(contextClean),
    current_property_status: /\b(i own|my house|my home)\b/i.test(latestClean) ? "owns" : /\b(i rent|renting)\b/i.test(latestClean) ? "rents" : "unknown",
    preferred_channel: preferredChannel(latestClean),
  };

  let intent: IrisEmailIntent = "human_required";
  let role: IrisLeadRole = "unknown";
  const opportunityTags: string[] = [];

  const systemEmailLike = /(confirm (?:your )?email|confirm email address|activate account|complete your registration|account (?:has been )?(?:created|activated)|verification link|welcome to .{0,40}(?:checker|platform|portal)|bulk email checker)/i.test(latestClean);
  const businessOutreachLike = /(seo|backlinks?|guest post|sponsored post|crypto|web design|rank on google|lead generation service|press release distribution|partners? at|technical founders?|zero slide decks?|collaborative docs?|prospects sell themselves|want the method|selling all day|deals moving|actual deals|cold email|sales automation|marketing automation|partnerships?)/i.test(latestClean);
  const realEstateLeadLike = /(home|house|condo|property|listing|showing|tour|buyer|seller|rent|lease|realtor|real estate|bedroom|bathroom|mortgage|valuation|zillow|mls|open house)/i.test(latestClean) || addresses.length > 0 || propertyUrls.length > 0;
  const spamLike = systemEmailLike || (businessOutreachLike && !realEstateLeadLike);
  if (spamLike) {
    intent = "spam";
  } else if (flags.some((flag) => SENSITIVE_FLAGS.has(flag)) || noSignal === "stop") {
    intent = "human_required";
  } else if (pivotingToOtherOptions && /(options?|alternatives?|another|other|what else|looking for|better fit|three bed|3 bed|bedroom|homes?|houses?|properties|listings?)/i.test(latestClean)) {
    intent = "property_search";
    role = "buyer";
    opportunityTags.push("property_pivot");
  } else if (/(sell|selling|listing appointment|list my|home value|valuation|what is my house worth|what could it be worth|cma)/i.test(latestClean)) {
    intent = "seller_lead";
    role = "seller";
    opportunityTags.push("valuation_interest");
  } else if (addresses.length || propertyUrls.length) {
    if (/(show|tour|see|visit|schedule|available today|open house|take a look|look at|check out|walk through|view it|view this|see it)/i.test(latestClean) || (!latestAddresses.length && canResolveFromPriorProperty(latestClean))) {
      intent = "showing_request";
    } else if (/(monthly payment|payment estimate|down payment|mortgage|loan|preapproved|pre-approved|lender|rate)/i.test(latestClean)) {
      intent = "buyer_lead";
      opportunityTags.push("mortgage_interest");
    } else {
      intent = "property_details";
    }
    role = /(monthly payment|payment estimate|down payment|mortgage|loan|preapproved|pre-approved|lender|rate)/i.test(latestClean)
      ? "mortgage_adjacent_lead"
      : "buyer";
  } else if (/(showing|tour|open house|see it|see that one|view it|schedule|appointment|take a look|look at it|check it out|after work|tomorrow|today|noon|afternoon|evening|this friday)/i.test(latestClean) && canResolveFromPriorProperty(latestClean)) {
    intent = "showing_request";
    role = "buyer";
  } else if (/(rent|lease|rental|tenant)/i.test(latestClean)) {
    intent = "renter_lead";
    role = "renter";
  } else if (/(looking for|homes?|houses?|condos?|properties|property|available|inventory|options|under \$|\$[\d,]+ ?(?:to|-|–|and) ?\$?[\d,]+|price range|budget|move in|relocat|bedroom|bd)/i.test(latestClean)) {
    intent = "property_search";
    role = "buyer";
  } else if (/(buy|purchase|preapproved|pre-approved|mortgage|loan)/i.test(latestClean)) {
    intent = "buyer_lead";
    role = /(mortgage|loan|preapproved|pre-approved)/i.test(latestClean) ? "mortgage_adjacent_lead" : "buyer";
  }

  if (/(asap|today|tomorrow|urgent|this week)/i.test(latestClean)) opportunityTags.push("high_urgency");
  if (/(mortgage|loan|preapproved|pre-approved|lender|rate)/i.test(latestClean)) opportunityTags.push("mortgage_interest");
  if (/(sell before (?:i )?buy|need to sell first|contingent)/i.test(latestClean)) opportunityTags.push("sell_before_buy");
  if (noSignal) opportunityTags.push(noSignal === "stop" ? "opt_out" : "clear_no");

  if (role === "mortgage_adjacent_lead" && flags.includes("mortgage_license")) intent = "human_required";
  if (intent === "human_required" && role === "unknown" && /(complaint|angry|upset|report|legal|attorney|lawyer)/i.test(latestClean)) {
    role = "unknown";
  }

  const routeHuman = intent === "human_required" || intent === "spam" || flags.some((flag) => SENSITIVE_FLAGS.has(flag));
  const recommended = intent === "spam" ? "review" : routeHuman ? "route_human" : intent === "showing_request" ? "send_booking_link" : "reply_and_qualify";
  const confidence = intent === "human_required" && !flags.length && !noSignal ? 0.35 : spamLike ? 0.8 : 0.72;

  return {
    intent,
    message_intent: intent,
    primary_lead_role: role,
    secondary_roles: [],
    opportunity_tags: uniq(opportunityTags),
    tone_state: flags.includes("angry_or_complaint") ? "annoyed" : /asap|urgent|today|tomorrow/i.test(latestClean) ? "urgent" : "neutral",
    urgency: /asap|urgent|today|tomorrow/i.test(latestClean) ? "high" : "unknown",
    compliance_flags: flags,
    confidence,
    address: addresses[0] || null,
    addresses,
    lead_fields: fields,
    next_best_question: routeHuman ? null : nextQuestion(intent, fields),
    recommended_next_action: recommended,
    human_handoff_reason: routeHuman ? humanHandoffReason(intent, flags, noSignal) : null,
  };
}

function humanHandoffReason(intent: IrisEmailIntent, flags: string[], noSignal: string): string {
  if (intent === "spam") return "spam_or_promotional_email";
  if (noSignal === "stop") return "opt_out_or_stop_request";
  if (flags.length) return flags.join(",");
  return "needs_human_review";
}

export function decideIrisEmailExecution(classification: IrisEmailClassification): IrisEmailExecution {
  // Only route to human for genuine blockers: compliance flags, spam, explicit human_required.
  // "review" recommended_next_action alone does NOT block auto-reply — Iris handles real estate
  // follow-ups autonomously. Human review is reserved for truly sensitive situations.
  const needsHuman = classification.intent === "human_required" || classification.intent === "spam" ||
    classification.compliance_flags.some((flag) => SENSITIVE_FLAGS.has(flag));
  if (classification.intent === "spam") {
    return {
      labels: ["NEEDS_HUMAN"],
      status: "spam",
      eventType: "spam",
      aiAction: "review",
      canReply: false,
      handoffReason: classification.human_handoff_reason || "spam_or_promotional_email",
    };
  }
  if (needsHuman) {
    return {
      labels: ["NEEDS_HUMAN"],
      status: "needs_human",
      eventType: "human_handoff",
      aiAction: "route_human",
      canReply: false,
      handoffReason: classification.human_handoff_reason || "needs_human_review",
    };
  }
  return {
    labels: ["AUTO_REPLIED"],
    status: "processed",
    eventType: "email_inbound",
    aiAction: "draft_reply",
    canReply: true,
    handoffReason: "",
  };
}

export function generateIrisEmailReply(message: IrisEmailMessage, classification: IrisEmailClassification): string | null {
  const execution = decideIrisEmailExecution(classification);
  if (!execution.canReply) return null;
  const question = classification.next_best_question;
  if (classification.intent === "showing_request") {
    return [
      "Hello,",
      "",
      `I can help with that${classification.address ? ` for ${classification.address}` : ""}. ${question || "What day and time works best for a quick showing?"}`,
      "",
      "Best,",
      IRIS_AGENT_NAME,
    ].join("\n");
  }
  if (classification.intent === "property_details") {
    return [
      "Hello,",
      "",
      `I can help with details on ${classification.address || "that property"}. I will verify the latest availability and send the most useful facts before you spend time on it.`,
      "",
      question || "Are you hoping to tour it, compare it with similar homes, or just confirm the basics first?",
      "",
      "Best,",
      IRIS_AGENT_NAME,
    ].join("\n");
  }
  if (classification.intent === "seller_lead") {
    return [
      "Hello,",
      "",
      `I can help you get a realistic read on value${classification.address ? ` for ${classification.address}` : ""} and next steps.`,
      "",
      question || "What address should I look at, and what timeline are you considering?",
      "",
      "Best,",
      IRIS_AGENT_NAME,
    ].join("\n");
  }
  if (classification.intent === "buyer_lead" && classification.address) {
    return [
      "Hello,",
      "",
      `I can help with ${classification.address} and keep the financing side practical without guessing.`,
      "",
      question || "What timeline are you working with, and do you already have a lender or pre-approval?",
      "",
      "Best,",
      IRIS_AGENT_NAME,
    ].join("\n");
  }
  const area = classification.lead_fields.area ? ` in ${classification.lead_fields.area}` : "";
  return [
    "Hello,",
    "",
    `I can help narrow down the right options${area}.`,
    "",
    question || "What timeline and price range should I use?",
    "",
    "Best,",
    IRIS_AGENT_NAME,
  ].join("\n");
}

function htmlEscape(value = ""): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px;line-height:1.55">${htmlEscape(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function formatCurrency(value = ""): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return value;
  return `$${Math.round(amount).toLocaleString()}`;
}

function propertyFacts(property: SheetRow): string {
  const facts = [
    property.beds ? `${property.beds} bed` : "",
    property.baths ? `${property.baths} bath` : "",
    property.sqft ? `${Number(property.sqft.replace(/[^\d]/g, "") || property.sqft).toLocaleString()} sqft` : "",
    property.status || "",
  ].filter(Boolean);
  return facts.join(" &bull; ");
}

function propertyHighlights(property: SheetRow): string {
  const features = (property.features || "")
    .split(/[,;|]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (features.length) return features.join(" • ");

  const description = (property.description || "").replace(/\s+/g, " ").trim();
  if (!description) return "";
  const duplicateFacts = [
    property.address,
    property.price,
    property.beds && `${property.beds} bed`,
    property.baths && `${property.baths} bath`,
    property.sqft && `${property.sqft.replace(/[^\d]/g, "")} sqft`,
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  const normalized = description.toLowerCase();
  const duplicateSignals = duplicateFacts.filter((fact) => fact && normalized.includes(fact)).length;
  if (duplicateSignals >= 2) return "";
  return description.slice(0, 140);
}

function propertyPhotoSrc(property: SheetRow): string {
  // Email cards are sent directly to Gmail, not rendered in the inbox preview.
  // A valid Maps Street View URL is a usable hero image here.
  const photo = (property.photo_url || "").trim();
  if (!photo || !isProxiableImageUrl(photo)) return "";
  return mediaProxyUrl(photo);
}

function propertyCardHtml(property: SheetRow, featured = false): string {
  const address = property.address || [property.city, property.state].filter(Boolean).join(", ");
  const price = formatCurrency(property.price || "");
  const facts = propertyFacts(property);
  const photo = propertyPhotoSrc(property);
  const listingUrl = property.listing_url || "";
  const highlights = propertyHighlights(property);
  const image = photo
    ? `<img src="${htmlEscape(photo)}" alt="${htmlEscape(address || "Property photo")}" style="display:block;width:100%;max-height:${featured ? 300 : 170}px;object-fit:cover;border-radius:8px;margin:0 0 12px" />`
    : "";
  const viewLink = listingUrl
    ? `<a href="${htmlEscape(listingUrl)}" style="display:inline-block;margin-top:10px;color:#0f766e;font-size:13px;font-weight:700;text-decoration:none">View listing</a>`
    : "";
  return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:${featured ? 16 : 14}px;margin:0 0 14px;background:#ffffff">
${image}
<h3 style="margin:0 0 6px;font-size:${featured ? 18 : 15}px;line-height:1.25;color:#111827">${htmlEscape(address)}</h3>
${price ? `<p style="margin:0 0 6px;font-size:${featured ? 17 : 14}px;font-weight:800;color:#111827">${htmlEscape(price)}</p>` : ""}
${facts ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.45;color:#4b5563">${facts}</p>` : ""}
${highlights ? `<p style="margin:0;font-size:13px;line-height:1.45;color:#374151">${htmlEscape(highlights)}</p>` : ""}
${viewLink}
</div>`;
}

function propertyPlain(property: SheetRow): string {
  const address = property.address || [property.city, property.state].filter(Boolean).join(", ");
  const facts = [
    formatCurrency(property.price || ""),
    property.beds ? `${property.beds}bd` : "",
    property.baths ? `${property.baths}ba` : "",
    property.sqft ? `${property.sqft.replace(/[^\d,]/g, "")} sqft` : "",
  ].filter(Boolean).join(" | ");
  return [address, facts, property.listing_url].filter(Boolean).join("\n");
}

function dedupeProperties(properties: SheetRow[]): SheetRow[] {
  const seen = new Set<string>();
  const out: SheetRow[] = [];
  for (const property of properties) {
    const key = [
      property.address,
      property.listing_url,
      property.property_id,
    ].filter(Boolean).join("|").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(property);
  }
  return out;
}

export function buildHtmlEmailReply(text: string, properties: SheetRow[] = [], classification?: IrisEmailClassification): IrisEmailReplyDraft {
  const cleanProperties = dedupeProperties(properties);
  const featured = cleanProperties[0];
  const rest = cleanProperties.slice(1, 4);
  const bodyText = refineShowingReplyForSelectedProperty(text, featured, classification);
  const wantsAlternatives = /\b(similar|options?|alternatives?|compare|another|other)\b/i.test(text);
  const showAlternatives = Boolean(
    rest.length
    && classification?.intent !== "showing_request"
    && (classification?.intent === "property_search" || wantsAlternatives)
  );
  const subjectLine = classification?.intent === "property_search"
    ? "I found the best matching options from our inventory."
    : classification?.intent === "showing_request" && featured
      ? `I can help with ${featured.address || "that property"}.`
    : featured
      ? "Here are the property details from our inventory."
      : "";
  const plainProperties = showAlternatives ? cleanProperties.slice(0, 4) : cleanProperties.slice(0, featured ? 1 : 0);
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;color:#111827;line-height:1.45">
${subjectLine ? `<p style="margin:0 0 14px;line-height:1.55">${htmlEscape(subjectLine)}</p>` : ""}
${featured ? propertyCardHtml(featured, true) : ""}
${showAlternatives ? `<h3 style="margin:20px 0 10px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#475569">Similar options</h3>${rest.map((property) => propertyCardHtml(property)).join("")}` : ""}
${plainToHtml(bodyText.replace(/\n*Best,\nIris\s*$/i, "").trim())}
<p style="margin:20px 0 0;color:#555;line-height:1.45">Best,<br><strong>Iris</strong></p>
</div>`;
  const propertyText = plainProperties.length
    ? `\n\nProperty details:\n${plainProperties.map(propertyPlain).join("\n\n")}`
    : "";
  return {
    text: `${bodyText}${propertyText}`,
    html,
  };
}

function refineShowingReplyForSelectedProperty(
  text: string,
  featured: SheetRow | undefined,
  classification?: IrisEmailClassification,
): string {
  if (classification?.intent !== "showing_request" || !featured?.address) return text;
  const signature = /\n*Best,\nIris\s*$/i;
  const hasSignature = signature.test(text);
  const core = text.replace(signature, "").trim();
  const cleaned = core
    .replace(
      /(?:To get it confirmed,\s*)?(?:could you|can you|please)\s+(?:share|confirm|let me know)\s+what time works best for you\s*(?:[-–—]|,|and)?\s*and\s+which\s+of\s+the\s+(?:\w+\s+)?properties\s+you(?:'|’)d\s+like\s+to\s+tour\s+first\?/gi,
      "What time works best for you?",
    )
    .replace(
      /(?:To get it confirmed,\s*)?[^.!?\n]*(?:which\s+(?:of\s+the\s+)?(?:one|property|properties)|which\s+of\s+the\s+(?:one|two|three|four|\d+)\s+properties|tour\s+first)[^.!?\n]*\?/gi,
      "What time works best for you?",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${cleaned}${hasSignature ? `\n\nBest,\n${IRIS_AGENT_NAME}` : ""}`;
}

function irisEmailClaudeModel(): string {
  return process.env.IRIS_EMAIL_RESPOND_MODEL || process.env.CLAUDE_RESPOND || "claude-sonnet-4-6";
}

function anthropicApiKey(): string {
  return process.env.ANTHROPIC_API_KEY || "";
}

const CLAUDE_PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 0.8, output: 4 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

function claudeTokenCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = CLAUDE_PRICING_PER_MILLION[model] || { input: 3, output: 15 };
  return ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000;
}

async function generateClaudeIrisEmailReplyText(
  message: IrisEmailMessage,
  classification: IrisEmailClassification,
  properties: SheetRow[],
): Promise<string | null> {
  const key = anthropicApiKey();
  if (!key) return null;
  const propertyContext = dedupeProperties(properties).slice(0, 4).map((property, index) => ({
    index: index + 1,
    address: property.address,
    price: formatCurrency(property.price || ""),
    beds: property.beds,
    baths: property.baths,
    sqft: property.sqft,
    property_type: property.property_type,
    status: property.status,
    features: property.features,
    listing_url: property.listing_url,
  }));
  const system = `You are ${IRIS_AGENT_NAME}, the real estate email assistant. Claude is the reasoning brain for this email agent.
Write only the email body, no markdown and no subject line.
Rules:
- Keep it concise and useful.
${advancedQualificationPlaybook()}
- Use only provided facts. Do not invent availability, schools, neighborhood claims, lending advice, legal advice, or broker judgment.
- The app will render property facts in an HTML property card above your body, so do not repeat the full price/beds/baths/sqft block in prose.
- Mention the primary address at most once.
- If this is a showing request and a primary property is provided, treat that property as selected. Do not ask which property or which option they want.
- If the latest inbound says they are no longer interested in a prior property or asks for other options, pivot to the new search. Do not lead with the previous property.
- Ask at most one next-step question.
- Never use em dashes. Use commas, periods, or simple hyphens instead.
- End exactly with:
Best,
${IRIS_AGENT_NAME}`;
  const latestBody = cleanBody(latestEmailBody(message.body));
  const contextBody = cleanBody(threadContextBody(message.body));
  const user = `Inbound email:
From: ${message.from}
Subject: ${message.subject}
Body:
${latestBody}

Prior thread context for memory only:
${contextBody || "(none)"}

Classification:
${JSON.stringify(classification)}

Property facts available to the HTML card:
${JSON.stringify(propertyContext)}`;

  const startedAt = Date.now();
  const model = irisEmailClaudeModel();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 360,
      temperature: 0.4,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return null;
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const costUsd = claudeTokenCostUsd(model, inputTokens, outputTokens);
  const contact = parseEmailContact(message.from);
  await writeRequestAuditEvent({
    route: "agent:iris-email",
    method: "LLM",
    channel: "email",
    provider: "anthropic",
    threadRef: message.threadId,
    contactRef: contact.email || message.from,
    providerMessageId: message.id,
    stage: "reply_generate",
    outcome: "sent",
    durationMs: Date.now() - startedAt,
    costUsd,
    costService: "claude",
    costUnits: {
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      price_per_million_input: CLAUDE_PRICING_PER_MILLION[model]?.input || 3,
      price_per_million_output: CLAUDE_PRICING_PER_MILLION[model]?.output || 15,
    },
    metadata: {
      intent: classification.intent,
      property_count: propertyContext.length,
    },
  }).catch(() => null);
  const content = Array.isArray(payload.content) ? payload.content as Array<{ type?: string; text?: string }> : [];
  const text = content.find((block) => block.type === "text")?.text?.trim() || "";
  return text && /Best,\s*\n\s*Iris\s*$/i.test(text) ? text : null;
}

async function generateIrisEmailReplyRich(
  message: IrisEmailMessage,
  classification: IrisEmailClassification,
): Promise<IrisEmailReplyDraft | null> {
  const fallbackPlain = generateIrisEmailReply(message, classification);
  if (!fallbackPlain) return null;
  if (!databaseEnabled()) {
    const plain = await generateClaudeIrisEmailReplyText(message, classification, []).catch(() => null) || fallbackPlain;
    return { text: plain, html: buildHtmlEmailReply(plain, [], classification).html };
  }
  const latestBody = cleanBody(latestEmailBody(message.body));
  const contextAddresses = extractAddresses(threadContextBody(message.body));
  const excludeAddresses = classification.opportunity_tags.includes("property_pivot") ? contextAddresses.slice(0, 1) : [];
  const shouldAttachProperties = ["property_search", "property_details", "showing_request"].includes(classification.intent);
  const budgetRange = extractBudgetRange(
    [classification.lead_fields.budget || "", latestBody].filter(Boolean).join(" "),
  );
  const properties = !shouldAttachProperties
    ? []
    : classification.addresses.length && classification.intent !== "property_search"
      ? await findPropertiesByAddressesFromDatabase(classification.addresses, 4)
      : await retrievePropertiesForAgent({
        query: latestBody,
        area: classification.lead_fields.area || latestBody,
        beds: classification.lead_fields.beds || undefined,
        minPrice: budgetRange.min || undefined,
        maxPrice: budgetRange.max || undefined,
        excludeAddresses,
        mode: "general",
      }, 4, { channel: "email" });
  const plain = await generateClaudeIrisEmailReplyText(message, classification, properties).catch(() => null) || fallbackPlain;
  return buildHtmlEmailReply(plain, properties, classification);
}

function normalizeReplyDraft(reply: string | IrisEmailReplyDraft | null): IrisEmailReplyDraft | null {
  if (!reply) return null;
  if (typeof reply === "string") return { text: removeEmDashes(reply) };
  if (!reply.text.trim() && !reply.html?.trim()) return null;
  return { ...reply, text: removeEmDashes(reply.text), html: removeEmDashes(reply.html || "") };
}

async function messageWithLeadContext(message: IrisEmailMessage): Promise<IrisEmailMessage> {
  if (!databaseEnabled()) return message;
  const contact = parseEmailContact(message.from);
  if (!contact.email) return message;
  const lead = await findLeadInDatabase({ email: contact.email });
  const events = await readEventsForLeadFromDatabase({ email: contact.email, phone: lead?.phone }, 8);
  if (
    !lead?.property_interest
    && !lead?.budget
    && !lead?.area
    && !lead?.bedrooms
    && !lead?.summary
    && !events.length
  ) return message;
  const recentEvents = events.slice(-6).map((event) => {
    const when = event.event_at || event.created_at || "";
    const text = cleanBody(stripHtml(event.message_text || event.summary || "")).slice(0, 220);
    return `${when} ${event.channel || "unknown"} ${event.direction || "unknown"} ${event.status || ""}: ${text}`;
  });
  const context = [
    lead?.property_interest ? `Previous property interest: ${lead.property_interest}` : "",
    lead?.budget ? `Known budget: ${lead.budget}` : "",
    lead?.area ? `Known area: ${lead.area}` : "",
    lead?.bedrooms ? `Known bedrooms: ${lead.bedrooms}` : "",
    lead?.summary ? `Prior summary: ${lead.summary.slice(0, 500)}` : "",
    recentEvents.length ? `Recent omnichannel timeline:\n${recentEvents.join("\n")}` : "",
  ].filter(Boolean).join("\n");
  return {
    ...message,
    body: `${message.body}\n\n${THREAD_CONTEXT_MARKER}\n${context}`,
  };
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function handoffSummary(message: IrisEmailMessage, classification: IrisEmailClassification, execution: IrisEmailExecution): string {
  const contact = parseEmailContact(message.from);
  const fields = classification.lead_fields;
  return [
    `Lead: ${contact.name || "Unknown"} <${contact.email || message.from}>`,
    `Source: gmail / ${message.subject || ""}`,
    `Intent: ${classification.intent}`,
    `Role: ${classification.primary_lead_role}`,
    `Opportunity tags: ${classification.opportunity_tags.join(", ") || "none"}`,
    `Property interest: ${classification.addresses.join(", ") || "none"}`,
    `Timeline: ${fields.timeline || "unknown"} | Budget: ${fields.budget || "unknown"} | Area: ${fields.area || "unknown"}`,
    `Compliance flags: ${classification.compliance_flags.join(", ") || "none"}`,
    `Handoff reason: ${execution.handoffReason || "none"}`,
    `Next action: ${classification.recommended_next_action}`,
    `Last message: ${cleanBody(message.body).slice(0, 700)}`,
  ].join("\n");
}

export function buildIrisEmailLeadMemoryRow(
  message: IrisEmailMessage,
  classification: IrisEmailClassification,
  execution: IrisEmailExecution,
): Partial<SheetRow> {
  const contact = parseEmailContact(message.from);
  const fields = classification.lead_fields;
  return {
    email: contact.email,
    full_name: contact.name,
    lead_source: "email",
    source_detail: message.subject || "",
    lead_role: classification.primary_lead_role,
    intent: classification.intent,
    property_interest: classification.addresses.join(", "),
    budget: fields.budget || "",
    area: fields.area || "",
    timeline: fields.timeline || "",
    preferred_channel: fields.preferred_channel === "phone" ? "voice" : fields.preferred_channel || "email",
    last_channel: "email",
    last_ai_touch_at: new Date().toISOString(),
    handoff_status: execution.status === "needs_human" || execution.status === "spam" ? "needs_human" : "",
    handoff_reason: execution.handoffReason,
    next_action: classification.recommended_next_action,
    summary: handoffSummary(message, classification, execution),
    bedrooms: fields.beds || "",
    do_not_contact: classification.opportunity_tags.includes("opt_out") ? "true" : "",
  };
}

export function buildIrisEmailConversationEventRow(
  message: IrisEmailMessage,
  classification: IrisEmailClassification,
  execution: IrisEmailExecution,
): Partial<SheetRow> {
  const contact = parseEmailContact(message.from);
  return {
    event_at: new Date().toISOString(),
    channel: "email",
    direction: "inbound",
    email: contact.email,
    full_name: contact.name,
    source: "gmail",
    thread_ref: message.threadId,
    agent_name: IRIS_AGENT_NAME,
    event_type: execution.eventType,
    message_text: cleanBody(message.body),
    summary: handoffSummary(message, classification, execution),
    ai_action: execution.aiAction,
    handoff_reason: execution.handoffReason,
    status: execution.status,
    mailbox_email: message.mailboxEmail || "",
    gmail_thread_id: message.threadId,
    gmail_message_id: message.id,
    thread_status: message.mailboxEmail ? "current_mailbox_thread" : "",
    media_json: JSON.stringify(message.media || []),
  };
}

export function buildIrisEmailOutboundEventRow(
  message: IrisEmailMessage,
  classification: IrisEmailClassification,
  replyDraft: IrisEmailReplyDraft,
  result?: GmailReplyResult | void,
): Partial<SheetRow> {
  const contact = parseEmailContact(message.from);
  const gmailResult = result || {};
  return {
    event_at: new Date().toISOString(),
    channel: "email",
    direction: "outbound",
    email: contact.email,
    full_name: contact.name,
    source: "gmail",
    thread_ref: (gmailResult as GmailReplyResult).threadId || message.threadId,
    agent_name: IRIS_AGENT_NAME,
    event_type: "email_ai_reply",
    message_text: replyDraft.html || replyDraft.text,
    summary: `Iris replied to ${contact.name || contact.email || "the lead"} about ${classification.address || classification.intent}.`,
    ai_action: "auto_reply_sent",
    status: "sent",
    mailbox_email: (gmailResult as GmailReplyResult).mailboxEmail || message.mailboxEmail || "",
    gmail_thread_id: (gmailResult as GmailReplyResult).threadId || message.threadId,
    gmail_message_id: (gmailResult as GmailReplyResult).messageId || "",
    thread_status: (gmailResult as GmailReplyResult).threaded === false ? "sent_unthreaded" : "current_mailbox_thread",
  };
}

export async function recordIrisEmailInteraction(
  message: IrisEmailMessage,
  classification: IrisEmailClassification,
  execution: IrisEmailExecution,
): Promise<void> {
  if (!databaseEnabled()) {
    throw new Error("DATABASE_URL is required for hosted Iris email writes");
  }
  await upsertLeadMemoryToDatabase(buildIrisEmailLeadMemoryRow(message, classification, execution));
  await appendConversationEventToDatabase(buildIrisEmailConversationEventRow(message, classification, execution));
  await upsertThreadLinkInDatabase({
    threadRef: message.threadId,
    channel: "email",
    mailboxEmail: message.mailboxEmail || "",
    gmailThreadId: message.threadId,
    gmailMessageId: message.id,
    threadStatus: message.mailboxEmail ? "current_mailbox_thread" : "",
  });
}

export async function processIrisEmailPoll(
  options: IrisEmailPollOptions = {},
  deps: IrisEmailPollDeps = {},
): Promise<IrisEmailPollResult> {
  const dryRun = options.dryRun !== false;
  const limit = Math.max(1, Math.min(options.limit || 10, 50));
  const emailClient = deps.emailClient || await createGmailIrisEmailClient();
  const recordInteraction = deps.recordInteraction || recordIrisEmailInteraction;
  const classify = deps.classify || classifyIrisEmailText;
  const generateReply = deps.generateReply || generateIrisEmailReplyRich;
  const categories = databaseEnabled() ? await readInboxCategoriesFromDatabase() : [];
  const syncedCategories = !dryRun && emailClient.syncCategoryLabels
    ? await emailClient.syncCategoryLabels(categories)
    : categories;
  const listedMessages = await emailClient.listUnreadMessages(limit);
  const { messages, superseded } = coalesceIrisEmailThreadFollowUps(listedMessages);
  const results: IrisEmailProcessResult[] = [];

  // Same-thread follow-ups are folded into the newest message. Mark older copies
  // handled so a later inbox scan cannot send a second reply.
  if (!dryRun) {
    for (const message of superseded) {
      await emailClient.applyLabels(message.id, ["AUTO_REPLIED"]);
    }
  }

  for (const message of messages) {
    const classificationMessage = await messageWithLeadContext(message);
    const classification = classify(classificationMessage);
    const execution = decideIrisEmailExecution(classification);
    const replyDraft = normalizeReplyDraft(await generateReply(message, classification));
    const categorySlug = syncedCategories.length
      ? inferCategorySlug([buildIrisEmailConversationEventRow(message, classification, execution) as SheetRow], syncedCategories)
      : "";
    const categoryLabel = syncedCategories.find((category) => category.slug === categorySlug)?.gmail_label_name || "";
    const labels = categoryLabel ? [...execution.labels, categoryLabel] : execution.labels;
    let recorded = false;
    let labeled = false;
    let sent = false;
    let skippedDuplicate = false;

    if (!dryRun) {
      const existingEvent = deps.duplicateExists
        ? ((await deps.duplicateExists(message.id)) ? ({ status: "processed" } as SheetRow) : null)
        : databaseEnabled()
          ? await readConversationEventByGmailMessageId(message.id)
          : null;
      const hasRecoveredReply = existingEvent?.thread_ref && existingEvent.event_at && databaseEnabled()
        ? await hasOutboundEmailReplyAfterEventInDatabase({
          threadRef: existingEvent.thread_ref,
          eventAt: existingEvent.event_at,
        })
        : false;
      const canRecoverNeedsHuman = Boolean(existingEvent && existingEvent.status === "needs_human" && execution.canReply && !hasRecoveredReply);
      skippedDuplicate = Boolean(existingEvent && !canRecoverNeedsHuman);
      if (!existingEvent) {
        await recordInteraction(message, classification, execution, replyDraft?.text || null);
        recorded = true;
      }
      await emailClient.applyLabels(message.id, labels);
      labeled = true;
      if (!skippedDuplicate && options.sendReplies && execution.canReply && replyDraft && emailClient.sendReply) {
        const replyResult = await emailClient.sendReply(message, replyDraft.text, replyDraft.html);
        if (!deps.recordInteraction && databaseEnabled()) {
          await appendConversationEventToDatabase(
            buildIrisEmailOutboundEventRow(message, classification, replyDraft, replyResult),
          );
        }
        sent = true;
      } else if (!skippedDuplicate && !execution.canReply && replyDraft?.text && databaseEnabled()) {
        // Fixer-style: store AI draft in review queue even when needsHuman=true.
        // The draft appears in the dashboard and can be approved+sent or dismissed in one click.
        const threadRef = message.threadId || message.id;
        const gmailDraft = emailClient.createDraft
          ? await emailClient.createDraft(message, replyDraft.text, replyDraft.html).catch(() => null)
          : null;
        await upsertAiDraftInDatabase({
          thread_ref: threadRef,
          channel: "email",
          body: replyDraft.text,
          category_slug: categorySlug || "needs_human",
          confidence: classification.confidence ?? 0.75,
          reason: execution.handoffReason || "Human review — draft ready to send",
          next_action: "review_send",
          safe_to_auto_send: false,
          needs_human: true,
          model: "iris_email",
          fingerprint: `iris-draft:${message.id}`,
          gmail_draft_id: gmailDraft?.draftId || "",
          gmail_message_id: gmailDraft?.messageId || "",
          gmail_thread_id: gmailDraft?.threadId || message.threadId || "",
          gmail_mailbox_email: gmailDraft?.mailboxEmail || message.mailboxEmail || "",
          gmail_draft_synced_at: gmailDraft?.draftId ? new Date().toISOString() : "",
        }).catch(() => null);
      }
    }

    results.push({
      messageId: message.id,
      threadId: message.threadId,
      from: message.from,
      subject: message.subject,
      classification,
      execution,
      replyDraft: replyDraft?.text || null,
      recorded,
      labeled,
      sent,
      skippedDuplicate,
      dryRun,
    });
  }

  return {
    ok: true,
    dryRun,
    processed: results.length,
    recorded: results.filter((result) => result.recorded).length,
    labeled: results.filter((result) => result.labeled).length,
    sent: results.filter((result) => result.sent).length,
    results,
  };
}

function header(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64Url(value = ""): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<\s*(p|div|li|tr)\b[^>]*>/gi, "\n")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => `${label} ${href}`)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyFromPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "";
  const body = payload.body as { data?: string } | undefined;
  const mimeType = String(payload.mimeType || "");
  if (body?.data) {
    const decoded = decodeBase64Url(body.data);
    return /html/i.test(mimeType) ? htmlToText(decoded) : decoded;
  }
  const parts = payload.parts as Record<string, unknown>[] | undefined;
  if (!parts?.length) return "";
  const plain = parts.find((part) => String(part.mimeType || "") === "text/plain");
  if (plain) return bodyFromPayload(plain);
  const html = parts.find((part) => /html/i.test(String(part.mimeType || "")));
  if (html) return bodyFromPayload(html);
  return parts.map((part) => bodyFromPayload(part)).filter(Boolean).join("\n").trim();
}

function gmailPartFilename(part: Record<string, unknown>): string {
  return String(part.filename || "").trim();
}

function gmailPartBody(part: Record<string, unknown>): { data?: string; attachmentId?: string; size?: number } {
  return (part.body && typeof part.body === "object" ? part.body : {}) as { data?: string; attachmentId?: string; size?: number };
}

function gmailMediaType(mimeType: string): OmnichannelMedia["type"] {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("video/")) return "video";
  return "file";
}

function collectGmailAttachmentParts(payload: Record<string, unknown> | undefined, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!payload) return out;
  const mimeType = String(payload.mimeType || "");
  const body = gmailPartBody(payload);
  const filename = gmailPartFilename(payload);
  if ((filename || body.attachmentId) && !/text\/plain|text\/html/i.test(mimeType)) out.push(payload);
  const parts = payload.parts as Record<string, unknown>[] | undefined;
  for (const part of parts || []) collectGmailAttachmentParts(part, out);
  return out;
}

async function gmailAttachmentBytes(gmail: GmailClient, messageId: string, part: Record<string, unknown>): Promise<string> {
  const body = gmailPartBody(part);
  if (body.data) return body.data;
  if (!body.attachmentId) return "";
  const attachment = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: body.attachmentId,
  });
  return attachment.data.data || "";
}

async function mediaFromGmailPayload(
  gmail: GmailClient,
  messageId: string,
  payload: Record<string, unknown> | undefined,
): Promise<OmnichannelMedia[]> {
  const parts = collectGmailAttachmentParts(payload).slice(0, 6);
  const media: OmnichannelMedia[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const mimeType = String(part.mimeType || "application/octet-stream");
    const filename = gmailPartFilename(part) || `gmail-attachment-${index}`;
    const item: OmnichannelMedia = {
      id: `${messageId}:${index}`,
      type: gmailMediaType(mimeType),
      contentType: mimeType,
      filename,
      providerMetadata: {
        provider: "gmail",
        attachmentId: gmailPartBody(part).attachmentId || "",
      },
    };
    if (item.type === "image") {
      try {
        const data = await gmailAttachmentBytes(gmail, messageId, part);
        if (data) {
          item.providerMetadata = {
            ...item.providerMetadata,
            visionContentType: mimeType,
            visionBytesBase64: data.replace(/-/g, "+").replace(/_/g, "/"),
          };
        }
      } catch {
        // Keep heuristic attachment context if Gmail attachment download fails.
      }
    }
    media.push(item);
  }
  return understandMediaItems(media);
}

function gmailSearchToken(value: string): string {
  return value.replace(/[\\"]/g, "").trim();
}

export function irisEmailPollQuery(): string {
  const override = process.env.IRIS_EMAIL_POLL_QUERY?.trim();
  if (override) return override;
  const lookback = (process.env.IRIS_EMAIL_LOOKBACK || "14d").trim();
  const inboundEmail = (
    process.env.IRIS_EMAIL_INBOUND_TO ||
    process.env.TEAM_LEAD_EMAIL ||
    process.env.GMAIL_INBOUND_EMAIL ||
    ""
  ).trim().toLowerCase();
  const parts = ["in:inbox", "is:unread", `newer_than:${gmailSearchToken(lookback)}`];
  if (inboundEmail.includes("@")) {
    const token = gmailSearchToken(inboundEmail);
    parts.push(`{to:${token} deliveredto:${token}}`);
  }
  return parts.join(" ");
}

export function isIrisEligibleEmail(message: Pick<IrisEmailMessage, "from" | "subject" | "body">): boolean {
  const contact = parseEmailContact(message.from);
  const sender = contact.email || message.from.toLowerCase();
  if (!sender) return false;
  if (/@(?:lumenosis\.local|localhost)$/i.test(sender)) return false;
  if (/^(no-?reply|do-?not-?reply|donotreply|noreply|notification|notifications|mailer-daemon|postmaster)@/i.test(sender)) return false;
  if (/^(sales|marketing|partnerships?|outreach|hello|team|founder|growth)@/i.test(sender)) return false;
  if (/@(?:.*\.)?(?:accounts\.google\.com|google\.com|gohighlevel\.com|github\.com|vercel\.com|calendly\.com|luckyfours\.com)$/i.test(sender)) return false;
  const text = `${message.subject || ""}\n${message.body || ""}`;
  if (/(security alert|verification code|password reset|new sign-in|login attempt|oauth application|deployment failed|workflow run|confirm (?:your )?email|confirm email address|activate account|complete your registration|account (?:has been )?(?:created|activated)|bulk email checker)/i.test(text)) return false;
  if (/(unsubscribe|manage preferences|view in browser|privacy policy|trial discount|end of trial|webinar|newsletter|limited time|book a demo|schedule a demo|product update|sales automation|marketing automation|google for startups|cloud program update|zero slide decks?|technical founders?|prospects sell themselves|want the method|selling all day|deals moving|actual deals)/i.test(text)) return false;
  if (/\b(api|saas|software|platform|automation|cold email|lead gen|partnership|partners?|integrat(?:e|ion)|demo|quick re|quick question|checking in|outreach|prospects?)\b/i.test(text)
    && !/\b(home|house|condo|property|listing|showing|tour|buyer|seller|rent|lease|real estate|bed(?:room)?|bath|mortgage|valuation|zillow|mls)\b/i.test(text)) {
    return false;
  }
  return true;
}

async function listUnreadMessages(gmail: GmailClient, limit: number, mailboxEmail = ""): Promise<IrisEmailMessage[]> {
  const listed = await gmail.users.messages.list({
    userId: "me",
    maxResults: limit,
    q: irisEmailPollQuery(),
  });
  const refs = listed.data.messages || [];
  const messages: IrisEmailMessage[] = [];
  for (const ref of refs) {
    if (!ref.id) continue;
      const detail = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "full" });
      const payload = detail.data.payload as Record<string, unknown> | undefined;
      const headers = (payload?.headers || []) as Array<{ name?: string | null; value?: string | null }>;
      const body = bodyFromPayload(payload);
      const media = await mediaFromGmailPayload(gmail, ref.id, payload);
      const message = {
        id: ref.id,
        threadId: detail.data.threadId || ref.threadId || ref.id,
        from: header(headers, "From"),
        to: header(headers, "To"),
        subject: header(headers, "Subject"),
        body: normalizedMessageText({ text: body, media }),
        snippet: detail.data.snippet || "",
        messageId: header(headers, "Message-ID"),
        references: header(headers, "References"),
        receivedAt: header(headers, "Date"),
        mailboxEmail,
        media,
      };
    const sender = parseEmailContact(message.from).email;
    if (mailboxEmail && sender && sender === mailboxEmail.toLowerCase()) continue;
    if (isIrisEligibleEmail(message)) messages.push(message);
  }
  return messages;
}

async function listMessagesByIds(gmail: GmailClient, messageIds: string[], mailboxEmail = ""): Promise<IrisEmailMessage[]> {
  const uniqueIds = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))].slice(0, 25);
  const messages: IrisEmailMessage[] = [];
  for (const id of uniqueIds) {
    const detail = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const labelIds = detail.data.labelIds || [];
    // Explicit-id fetch is used for recovery of parked needs_human messages, which
    // Iris already marked read (UNREAD removed) during first processing. Only require
    // the message still lives in the inbox; do not require UNREAD, or parked
    // real-estate inquiries could never be recovered.
    if (!labelIds.includes("INBOX")) continue;
    const payload = detail.data.payload as Record<string, unknown> | undefined;
    const headers = (payload?.headers || []) as Array<{ name?: string | null; value?: string | null }>;
    const body = bodyFromPayload(payload);
    const media = await mediaFromGmailPayload(gmail, id, payload);
    const message = {
      id,
      threadId: detail.data.threadId || id,
      from: header(headers, "From"),
      to: header(headers, "To"),
      subject: header(headers, "Subject"),
      body: normalizedMessageText({ text: body, media }),
      snippet: detail.data.snippet || "",
      messageId: header(headers, "Message-ID"),
      references: header(headers, "References"),
      receivedAt: header(headers, "Date"),
      mailboxEmail,
      media,
    };
    const sender = parseEmailContact(message.from).email;
    if (mailboxEmail && sender && sender === mailboxEmail.toLowerCase()) continue;
    if (isIrisEligibleEmail(message)) messages.push(message);
  }
  return messages;
}

async function applyGmailLabels(gmail: GmailClient, messageId: string, labels: string[]): Promise<void> {
  const addLabelIds = await Promise.all(labels.map((name) => ensureGmailLabel(gmail, name)));
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds, removeLabelIds: ["UNREAD"] },
  });
}

async function syncGmailCategoryLabels(gmail: GmailClient, categories: InboxCategory[]): Promise<InboxCategory[]> {
  if (!categories.length) return categories;
  const synced: InboxCategory[] = [];
  for (const category of categories) {
    const labelName = category.gmail_label_name || `Iris/${category.name}`;
    // Pass category color so Gmail labels are color-coded to match the dashboard
    const labelId = await ensureGmailLabel(gmail, labelName, category.color);
    const next = { ...category, gmail_label_id: labelId, gmail_label_name: labelName };
    synced.push(next);
    if (databaseEnabled() && (category.gmail_label_id !== labelId || category.gmail_label_name !== labelName)) {
      await updateInboxCategoryGmailLabelInDatabase({
        slug: category.slug,
        gmailLabelId: labelId,
        gmailLabelName: labelName,
      });
    }
  }
  return synced;
}

export async function syncInboxCategoriesWithGmail(categories: InboxCategory[]): Promise<InboxCategory[]> {
  const session = await createIrisGmailSession();
  return syncGmailCategoryLabels(session.gmail, categories);
}

export async function createGmailIrisEmailClient(): Promise<IrisEmailClient> {
  const session = await createIrisGmailSession();
  const gmail = session.gmail;
  return {
    listUnreadMessages: (limit) => listUnreadMessages(gmail, limit, session.accountEmail),
    applyLabels: (messageId, labels) => applyGmailLabels(gmail, messageId, labels),
    syncCategoryLabels: (categories) => syncGmailCategoryLabels(gmail, categories),
    sendReply: (message, body, htmlBody) => {
      return sendGmailReplyWithOptions(gmail, {
        to: parseEmailContact(message.from).email,
        subject: message.subject,
        body,
        htmlBody,
        threadId: message.threadId,
        messageId: message.messageId,
        references: message.references,
      }, { mailboxEmail: session.accountEmail });
    },
    createDraft: (message, body, htmlBody) => {
      return createGmailReplyDraftWithOptions(gmail, {
        to: parseEmailContact(message.from).email,
        subject: message.subject,
        body,
        htmlBody,
        threadId: message.threadId,
        messageId: message.messageId,
        references: message.references,
      }, { mailboxEmail: session.accountEmail });
    },
  };
}

export async function processIrisEmailMessageIds(
  messageIds: string[],
  options: IrisEmailPollOptions = {},
  deps: Omit<IrisEmailPollDeps, "emailClient"> = {},
): Promise<IrisEmailPollResult> {
  const session = await createIrisGmailSession();
  const gmail = session.gmail;
  const emailClient: IrisEmailClient = {
    listUnreadMessages: () => listMessagesByIds(gmail, messageIds, session.accountEmail),
    applyLabels: (messageId, labels) => applyGmailLabels(gmail, messageId, labels),
    syncCategoryLabels: (categories) => syncGmailCategoryLabels(gmail, categories),
    sendReply: (message, body, htmlBody) => {
      return sendGmailReplyWithOptions(gmail, {
        to: parseEmailContact(message.from).email,
        subject: message.subject,
        body,
        htmlBody,
        threadId: message.threadId,
        messageId: message.messageId,
        references: message.references,
      }, { mailboxEmail: session.accountEmail });
    },
    createDraft: (message, body, htmlBody) => {
      return createGmailReplyDraftWithOptions(gmail, {
        to: parseEmailContact(message.from).email,
        subject: message.subject,
        body,
        htmlBody,
        threadId: message.threadId,
        messageId: message.messageId,
        references: message.references,
      }, { mailboxEmail: session.accountEmail });
    },
  };
  return processIrisEmailPoll(
    { ...options, limit: Math.max(1, Math.min(messageIds.length || options.limit || 10, 25)) },
    { ...deps, emailClient },
  );
}
