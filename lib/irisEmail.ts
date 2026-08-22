import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { removeEmDashes } from "@/lib/noEmDash";
import {
  appendConversationEventToDatabase,
  databaseEnabled,
  findCandidatePropertiesFromDatabase,
  findPropertiesByAddressesFromDatabase,
  findLeadInDatabase,
  hasOutboundEmailReplyAfterEventInDatabase,
  insertApprovedEmailStyleExampleInDatabase,
  readAiDraftFromDatabase,
  readConversationEventByGmailMessageId,
  readEventsForLeadFromDatabase,
  readInboxCategoriesFromDatabase,
  readInboxSettingsFromDatabase,
  updateInboxCategoryGmailLabelInDatabase,
  updateAiDraftStatusInDatabase,
  upsertAiDraftInDatabase,
  upsertThreadLinkInDatabase,
  upsertLeadMemoryToDatabase,
} from "@/lib/database";
import {
  createGmailReplyDraftWithOptions,
  createIrisGmailSession,
  deleteGmailDraft,
  ensureGmailLabel,
  replaceGmailThreadLabels,
  sendGmailReplyWithOptions,
  updateGmailReplyDraftWithOptions,
  type GmailClient,
  type GmailDraftResult,
  type GmailReplyResult,
} from "@/lib/gmailConnection";
import {
  AUTO_REPLIED_LABEL,
  planMailboxLabels,
  type MailboxLabelPlan,
} from "@/lib/inboxLabelPlan";
import {
  DEFAULT_INBOX_SETTINGS,
  inferCategorySlug,
  mailboxCategories,
  type AiDraft,
  type InboxCategory,
  type InboxSettings,
} from "@/lib/inboxSettings";
import { releaseTakeover } from "@/lib/humanTakeover";
import { isProxiableImageUrl, mediaProxyUrl } from "@/lib/mediaProxy";
import { writeRequestAuditEvent } from "@/lib/requestAudit";
import { retrievePropertiesForAgent } from "@/lib/propertyRetrieval";
import { understandMediaItems } from "@/lib/mediaUnderstanding";
import { advancedQualificationPlaybook } from "@/lib/qualificationPlaybooks";
import { normalizedMessageText, type OmnichannelMedia } from "@/lib/omnichannelEvents";
import type { SheetRow } from "@/lib/sheetSchema";
import { fetchStyleContext, redactEmailStyleExample } from "@/lib/styleTraining";

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
  direction?: "inbound" | "outbound";
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
  /** Provider label/category names already on the thread. Read-only input to the label plan. */
  labelIds?: string[];
  /** The sender is an existing lead for this tenant. Never cold, at any marketing strictness. */
  knownContact?: boolean;
};

export type IrisEmailExecution = {
  /**
   * INTERNAL machine state, not mailbox label names. `lib/inboxLabelPlan.ts` translates these into
   * the user-facing `Auto Replied` / `Needs Human` labels; nothing writes these tokens to a mailbox.
   */
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
  /** What was (or on a dry run, would have been) written to the mailbox, with its audit trail. */
  labelPlan: MailboxLabelPlan & { statusSlug: string };
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
  applyLabels(
    message: IrisEmailMessage,
    labels: string[],
    managedLabels?: string[],
    options?: { removeFromInbox?: boolean },
  ): Promise<void>;
  syncCategoryLabels?(categories: InboxCategory[]): Promise<InboxCategory[]>;
  sendReply?(message: IrisEmailMessage, body: string, htmlBody?: string): Promise<GmailReplyResult | void>;
  createDraft?(message: IrisEmailMessage, body: string, htmlBody?: string): Promise<GmailDraftResult | void>;
  saveDraft?(message: IrisEmailMessage, body: string, htmlBody?: string, existingDraftId?: string): Promise<GmailDraftResult | void>;
  deleteDraft?(draftId: string): Promise<void>;
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
  categories?: InboxCategory[];
  /** Tenant inbox settings. Defaults to the untouched-inbox defaults, never to categorization on. */
  settings?: InboxSettings;
  readActiveDraft?: (threadRef: string) => Promise<Pick<AiDraft, "gmail_draft_id"> | null>;
  storeReviewDraft?: (draft: Omit<AiDraft, "updated_at" | "status">) => Promise<void>;
  archiveActiveDraft?: (threadRef: string) => Promise<void>;
  resolveSentReview?: (message: IrisEmailMessage, state: { alreadyRecorded: boolean }) => Promise<void>;
};

const SENSITIVE_FLAGS = new Set([
  "fair_housing",
  "mortgage_license",
  "legal",
  "contract_terms",
  "angry_or_complaint",
  "privacy",
  "broker_approval",
  "prompt_injection",
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
  // Fair housing: anything that asks the agent to characterize an area by who lives there,
  // or to rank areas on the usual protected-class proxies (safety, "family friendly",
  // school quality, crime), goes to a human. Factual asks like "which school district is
  // this in" stay answerable.
  if (
    /(safe (?:\w+ ){0,2}(?:neighborhood|area|part of town|side of town)|family (?:friendly )?(?:neighborhood|area)|good neighborhood for families|families with kids|people like me|demographics|ethnicity|\brace\b|religion|mostly families|mostly young|crime rate|low crime|crime stats?|good schools|best schools|school rating|school ratings|section 8|housing voucher)/
      .test(text_l)
  ) {
    flags.push("fair_housing");
  }
  if (/(do i qualify|can i qualify|will i qualify|get approved|approved for a loan|what rate can i get|which loan should|should i choose fha|nmls)/.test(text_l)) {
    flags.push("mortgage_license");
  }
  // Word boundaries matter here: an unanchored "sue" fires on "hosue", and an unanchored
  // "contract" fires on "contractor".
  if (/(legal advice|\battorney\b|\blawyer\b|\blawsuit\b|\bsue\b|\bsuing\b|break my lease|\bevict\b|\beviction\b)/.test(text_l)) {
    flags.push("legal");
  }
  if (/(waive inspection|\bcontract\b|\bcounteroffer\b|\bcommission\b|buyer agreement|listing agreement|agency agreement|representation agreement)/.test(text_l)) {
    flags.push("contract_terms");
  }
  if (
    /(?:what (?:exact )?price should i offer|how much (?:below|above) asking|offer strategy|negotiate (?:the )?(?:price|best terms|terms)|write (?:an|the) offer|submit (?:an|the) offer)/.test(text_l)
    || /(?:conflicting (?:appointments?|showings?|times?)|(?:move|cancel|reschedule) (?:one|an? appointment|an? showing) without asking|which showing should i attend|\b(?:move|reschedule)\b[^.]{0,140}\b(?:another|other)\s+showing\b)/.test(text_l)
  ) {
    flags.push("broker_approval");
  }
  if (/(scam|fraud|bait and switch|report you|harassment|stop spamming|spam complaint)/.test(text_l)) {
    flags.push("angry_or_complaint");
  }
  if (/(social security|ssn|bank account|routing number)/.test(text_l)) {
    flags.push("privacy");
  }
  // Instruction-override attempts. A lead never legitimately asks for the system prompt,
  // so the whole message goes to review rather than into the reply model unfiltered.
  if (
    /\b(?:ignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules?)|disregard (?:your|all|the) (?:instructions?|rules?|prompt)|system prompt|you are now|new instructions?:|pretend (?:to be|you are)|reveal (?:your|the) (?:prompt|instructions?|system)|print your (?:prompt|instructions?)|developer mode|jailbreak|forget (?:your|all) (?:rules?|instructions?)|override (?:your|the) (?:safety|rules?|guardrails?))\b/
      .test(text_l)
  ) {
    flags.push("prompt_injection");
  }
  return flags;
}

function extractAddresses(text: string): string[] {
  const standard = text.match(STREET_ADDRESS_RE) || [];
  const suffixless = [...text.matchAll(/\b(?:at|about|for|in|listing at|property at)[ \t]+(\d{2,6}[ \t]+(?:north|south|east|west|n|s|e|w)[ \t]+[A-Za-z][A-Za-z.'-]*(?:[ \t]+[A-Za-z][A-Za-z.'-]*){0,2}?)(?=[.,;!?\n]|[ \t]+(?:is|are|can|could|what|does|do|has|please|and)\b|$)/gi)]
    .map((match) => match[1]);
  return uniq([...standard, ...suffixless].map((value) => value.replace(/\s+/g, " ")));
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
  const match = text.match(/\$ ?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM])?|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m)\b/);
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
  const match = text.match(/\b(asap|today|tomorrow|this week|next week|this weekend|next month|(?:by|before)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)|in \d+\s+(?:days|weeks|months)|within \d+\s+(?:days|weeks|months)|\d+\s+(?:days|weeks|months))\b/i);
  return match ? match[0] : null;
}

function extractArea(text: string): string | null {
  const buyingArea = text.match(/\b(?:buy(?:ing)?|purchas(?:e|ing)|next (?:home|place))\b[^.!?\n]{0,80}\b(?:in|near|around)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\b/);
  const match = buyingArea || text.match(/\b(?:in|near|around)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\b/);
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

function wrongRecipientSignal(text: string): boolean {
  return /\b(?:wrong (?:person|number|email|address)|not the right person|you have the wrong|i am not (?:the )?\w+|never contacted you|who is this)\b/i.test(text);
}

function nextQuestion(intent: IrisEmailIntent, fields: IrisLeadFields, role: IrisLeadRole, tags: string[], latestText = ""): string | null {
  if (intent === "showing_request") {
    const hasDayAndTime = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(latestText)
      && /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(latestText);
    return hasDayAndTime ? null : "What day and time works best for a quick showing?";
  }
  if (role === "second_time_buyer" && !tags.includes("valuation_consented")) return "Would you like a free valuation of your current property while we help with your next purchase?";
  if (!fields.timeline && ["property_search", "buyer_lead", "seller_lead", "renter_lead"].includes(intent)) return "What timeline are you working with?";
  if (!fields.area && ["property_search", "buyer_lead", "renter_lead"].includes(intent)) return "Which area should I focus on?";
  if (!fields.budget && ["property_search", "buyer_lead", "renter_lead"].includes(intent)) return "What price range should I stay under?";
  if (["property_details", "buyer_lead"].includes(intent) && fields.current_property_status === "unknown") return "Is this your first purchase, or do you also own a property that may need a valuation?";
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
  const secondTimeBuyer = /\b(second[ -]?time buyer|bought before|already own|currently own|own(?:s)? (?:a|my|our) (?:[\w-]+\s+){0,3}(?:home|house|property)|have (?:a|our) (?:home|house|property) to sell|need to sell (?:my|our) (?:home|house|property))\b/i.test(latestClean);
  const contextSecondTimeBuyer = /\b(second_time_buyer|second[ -]?time buyer|currently own|already own|current property status:\s*owns)\b/i.test(contextClean);
  const valuationConsent = /\b(?:yes|sure|please|interested|sounds good|let'?s do it|book|schedule)\b.{0,80}\b(?:valuation|home value|property value|appraisal|cma)\b|\b(?:valuation|home value|property value|appraisal|cma)\b.{0,80}\b(?:yes|sure|please|interested|book|schedule)\b/i.test(latestClean);
  const fields: IrisLeadFields = {
    // Fields carry forward across the thread: a follow-up email that answers only
    // budget must not wipe the area/beds the lead already gave earlier. Latest
    // message wins; thread context fills the gaps. This is what stops Iris
    // re-asking "which area?" for criteria it was already told.
    timeline: extractTimeline(latestClean) || contextTimeline(contextClean),
    budget: extractBudget(latestClean) || contextBudget(contextClean),
    area: extractArea(latestClean) || contextArea(contextClean),
    beds: extractBeds(latestClean) || contextBeds(contextClean),
    current_property_status: secondTimeBuyer || contextSecondTimeBuyer ? "owns" : /\b(i rent|renting)\b/i.test(latestClean) ? "rents" : "unknown",
    preferred_channel: preferredChannel(latestClean),
  };

  let intent: IrisEmailIntent = "human_required";
  let role: IrisLeadRole = "unknown";
  const opportunityTags: string[] = [];

  const systemEmailLike = /(confirm (?:your )?email|confirm email address|activate account|complete your registration|account (?:has been )?(?:created|activated)|verification link|welcome to .{0,40}(?:checker|platform|portal)|bulk email checker)/i.test(latestClean);
  const businessOutreachLike = /(seo|backlinks?|guest post|sponsored post|crypto|web design|rank on google|lead generation service|press release distribution|partners? at|technical founders?|zero slide decks?|collaborative docs?|prospects sell themselves|want the method|selling all day|deals moving|actual deals|cold email|sales automation|marketing automation|partnerships?)/i.test(latestClean);
  const explicitNonRealEstate = /\b(?:not about|not related to|unrelated to)\b.{0,50}\b(?:buying|selling|real estate|property|homes?)\b/i.test(latestClean);
  const realEstateLeadLike = !explicitNonRealEstate && (/(home|house|condo|property|listing|showing|tour|buyer|seller|\brent\b|\blease\b|realtor|real estate|bedroom|bathroom|mortgage|valuation|zillow|mls|open house)/i.test(latestClean) || addresses.length > 0 || propertyUrls.length > 0);
  const spamLike = systemEmailLike || (businessOutreachLike && !realEstateLeadLike);
  const wrongRecipient = wrongRecipientSignal(latestClean);
  // An email whose body is only an attachment placeholder gives Iris nothing to answer.
  // A human glances at the image; Iris does not guess what it shows.
  const bodyOnlyClean = cleanBody(latestEmailBody(message.body || ""));
  const noUsableText = !bodyOnlyClean.replace(/\[[^\]]*\]/g, "").replace(/[^a-z0-9]/gi, "").trim()
    && !addresses.length
    && !propertyUrls.length;
  const unresolvedVagueAsk = /\b(?:that|the) thing\b|\bwhat we discussed\b|\btake care of it\b|\bhandle (?:that|it)\b/i.test(latestClean)
    && !latestAddresses.length
    && !propertyUrls.length;
  if (spamLike) {
    intent = "spam";
  } else if (wrongRecipient) {
    // Answering a stranger's "you have the wrong person" with more qualification questions
    // is how an inbox earns a spam complaint.
    intent = "human_required";
  } else if (flags.some((flag) => SENSITIVE_FLAGS.has(flag)) || noSignal === "stop" || unresolvedVagueAsk) {
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
  } else if (/\b(rent|lease|rental|tenant)\b/i.test(latestClean)) {
    intent = "renter_lead";
    role = "renter";
  } else if (/(looking (?:for|to buy)|homes?|houses?|condos?|properties|property|available|inventory|options|under \$|\$[\d,]+ ?(?:to|-|–|and) ?\$?[\d,]+|price range|budget|move in|relocat|bedroom|bd)/i.test(latestClean)) {
    intent = "property_search";
    role = "buyer";
  } else if (/(buy|purchase|preapproved|pre-approved|mortgage|loan)/i.test(latestClean)) {
    intent = "buyer_lead";
    role = /(mortgage|loan|preapproved|pre-approved)/i.test(latestClean) ? "mortgage_adjacent_lead" : "buyer";
  }

  // Autonomy floor. The chain above starts at human_required, so anything it does not
  // recognise gets parked for a human even when it is an ordinary lead email with no
  // compliance flag, no opt-out and a real human sender (isIrisEligibleEmail already
  // screened robots, vendors and system mail). Iris answers those, which is the difference
  // between a realtor reading 15% of the inbox and reading all of it. Human review stays
  // for real risk: sensitive flags, opt-outs, wrong recipients, spam.
  // The autonomy floor exists so Iris answers ordinary real-estate mail without a human. It
  // must require AFFIRMATIVE real-estate evidence, not merely the absence of red flags.
  //
  // Without `realEstateLeadLike` this was fail-open on anything the blocklist did not name:
  // a Mercury fintech cold-outbound ("IO card", "cash back", "spend controls") matches no
  // businessOutreachLike keyword and no real-estate keyword, so it was downgraded to
  // property_search/buyer at 0.72 and auto-replied to with a property card and a valuation CTA.
  // Unknown mail now stays human_required, which does not reply.
  if (
    intent === "human_required"
    && realEstateLeadLike
    && !flags.length
    && !noSignal
    && !wrongRecipient
    && !noUsableText
    && !unresolvedVagueAsk
    && !businessOutreachLike
    && !systemEmailLike
  ) {
    intent = addresses.length || propertyUrls.length ? "property_details" : "property_search";
    if (role === "unknown") role = "buyer";
    opportunityTags.push("autonomy_floor_reply");
  }
  // Out of scope means AFFIRMATIVELY someone else's business: cold outbound, vendor pitch,
  // SaaS/fintech marketing, automated system mail. Triage it, never answer it, never attach a
  // property card or valuation CTA. Tier C: classify only.
  //
  // Absence of real-estate evidence is NOT enough to be silent. "How much is it?" from a real
  // lead has no keywords either, and going silent on a lead is its own failure. Those get a
  // complete human-approved draft instead (Tier B), never silence.
  const affirmativelyOutOfScope = !realEstateLeadLike
    && (businessOutreachLike || systemEmailLike || /(unsubscribe|view in browser|manage preferences|sales navigator|book a demo|our platform|pricing plans?|free trial|webinar|newsletter)/i.test(latestClean));
  if (intent === "human_required" && affirmativelyOutOfScope && !flags.length && !noSignal) {
    opportunityTags.push("out_of_scope_no_reply");
  }

  if (/(asap|today|tomorrow|urgent|this week)/i.test(latestClean)) opportunityTags.push("high_urgency");
  if (/(mortgage|loan|preapproved|pre-approved|lender|rate)/i.test(latestClean)) opportunityTags.push("mortgage_interest");
  if (/\bsell(?:ing)?\b.{0,80}\bbefore\s+(?:(?:i|we)\s+)?buy(?:ing)?\b|need to sell first|contingent/i.test(latestClean)) opportunityTags.push("sell_before_buy");
  if (noSignal) opportunityTags.push(noSignal === "stop" ? "opt_out" : "clear_no");
  if (secondTimeBuyer || contextSecondTimeBuyer) {
    role = "second_time_buyer";
    opportunityTags.push("sell_before_buy", "valuation_interest");
  }
  if (valuationConsent && (secondTimeBuyer || contextSecondTimeBuyer)) opportunityTags.push("valuation_consented");

  if (role === "mortgage_adjacent_lead" && flags.includes("mortgage_license")) intent = "human_required";
  if (intent === "human_required" && role === "unknown" && /(complaint|angry|upset|report|legal|attorney|lawyer)/i.test(latestClean)) {
    role = "unknown";
  }

  const routeHuman = intent === "human_required" || intent === "spam" || flags.some((flag) => SENSITIVE_FLAGS.has(flag));
  const recommended = intent === "spam" ? "review" : routeHuman ? "route_human" : intent === "showing_request" || opportunityTags.includes("valuation_consented") ? "send_booking_link" : "reply_and_qualify";
  const confidence = intent === "human_required" && !flags.length && !noSignal ? 0.35 : spamLike ? 0.8 : 0.72;

  return {
    intent,
    message_intent: intent,
    primary_lead_role: role,
    secondary_roles: role === "second_time_buyer" ? ["seller"] : [],
    opportunity_tags: uniq(opportunityTags),
    tone_state: flags.includes("angry_or_complaint") ? "annoyed" : /asap|urgent|today|tomorrow/i.test(latestClean) ? "urgent" : "neutral",
    urgency: /asap|urgent|today|tomorrow/i.test(latestClean) ? "high" : "unknown",
    compliance_flags: flags,
    confidence,
    address: addresses[0] || null,
    addresses,
    lead_fields: fields,
    next_best_question: routeHuman ? null : nextQuestion(intent, fields, role, opportunityTags, latestClean),
    recommended_next_action: recommended,
    human_handoff_reason: routeHuman ? humanHandoffReason(intent, flags, noSignal, wrongRecipient) : null,
  };
}

function humanHandoffReason(intent: IrisEmailIntent, flags: string[], noSignal: string, wrongRecipient = false): string {
  if (intent === "spam") return "spam_or_promotional_email";
  if (noSignal === "stop") return "opt_out_or_stop_request";
  if (flags.length) return flags.join(",");
  if (wrongRecipient) return "wrong_recipient";
  return "needs_human_review";
}
/** Intents that can ever be answered without a human. Anything absent from this set drafts. */
const TIER_A_INTENTS = new Set<IrisEmailIntent>([
  "property_search",
  "property_details",
  "showing_request",
  "buyer_lead",
  "seller_lead",
  "renter_lead",
]);

// Deliberately NOT a confidence threshold. Measured across the 55-scenario corpus, this
// classifier's `confidence` is effectively two-valued (0.35 / 0.72): cases that must auto-send
// top out at 0.72 while cases that must NOT reach 0.80, so the signal is inverted at the top
// and cannot separate the classes. A numeric bar here would block every intended auto-reply and
// admit the highest-confidence blocked one. Confidence is still surfaced in the UI; it does not
// gate sending until it is genuinely calibrated.

export function decideIrisEmailExecution(classification: IrisEmailClassification): IrisEmailExecution {
  // ALLOWLIST, not blocklist. The previous rule was "reply unless something is obviously
  // wrong", which sent real replies to cold outbound sales mail because nothing matched a
  // blocklist keyword. Auto-send now has to be affirmatively earned on every gate.
  const closesWithoutReply = classification.intent === "spam" || classification.human_handoff_reason === "opt_out_or_stop_request";
  const outOfScope = (classification.opportunity_tags || []).includes("out_of_scope_no_reply");
  const needsHuman = classification.intent === "human_required" ||
    classification.compliance_flags.some((flag) => SENSITIVE_FLAGS.has(flag));
  if (closesWithoutReply) {
    return {
      labels: [],
      status: "spam",
      eventType: "spam",
      aiAction: "review",
      canReply: false,
      handoffReason: classification.human_handoff_reason || "spam_or_promotional_email",
    };
  }
  // Out of scope is not "needs human judgment", it is "not our mail". Classify only: no reply,
  // no draft, and never a redirect, property card or valuation CTA.
  if (outOfScope) {
    return {
      labels: [],
      status: "processed",
      eventType: "email_inbound",
      aiAction: "review",
      canReply: false,
      handoffReason: "out_of_scope_no_reply",
    };
  }
  if (needsHuman) {
    // Tier B, not silence. A human-review case still gets a complete, sendable draft: Iris
    // answers everything it can answer safely and marks only the uncertain span via
    // IRIS_REVIEW_MARKER, so the realtor edits one line instead of composing from scratch.
    return {
      labels: ["NEEDS_HUMAN"],
      status: "needs_human",
      eventType: "human_handoff",
      aiAction: "draft_reply",
      canReply: false,
      handoffReason: classification.human_handoff_reason || "needs_human_review",
    };
  }
  // Tier A gate: affirmative real-estate intent and no unresolved routing doubt.
  const tierA = TIER_A_INTENTS.has(classification.intent)
    && classification.recommended_next_action !== "route_human";
  if (!tierA) {
    // Tier B: a complete, sendable draft a human approves. Not a placeholder.
    return {
      labels: ["NEEDS_HUMAN"],
      status: "needs_human",
      eventType: "email_inbound",
      aiAction: "draft_reply",
      canReply: false,
      handoffReason: classification.human_handoff_reason || "below_auto_send_bar",
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

// A human-review draft is still a real email. The agent answers everything it can
// answer safely and marks only the genuinely uncertain part, so the realtor edits one
// line instead of composing from scratch. The handoff itself is internal metadata
// (labels, ai_drafts.needs_human) and never the entire visible message.
export const IRIS_REVIEW_MARKER = "[Review before sending:";

function irisReviewNextStep(classification: IrisEmailClassification): string {
  // Out of scope means no real-estate pitch of any kind. Offering "a shortlist against your
  // price range and bedroom count" to a fintech cold email is the same class of defect as
  // attaching a property card to it: Iris is selling houses to someone who never asked.
  if ((classification.opportunity_tags || []).includes("out_of_scope_no_reply")) {
    return "confirming what you are actually asking for before I take this any further";
  }
  const address = classification.address;
  if (classification.intent === "showing_request") {
    return `getting${address ? ` ${address}` : " the property"} on your calendar, so tell me a day and a rough time window and I will confirm access`;
  }
  if (address) {
    return `pulling the current facts on ${address}, list price, taxes, HOA dues, days on market, and what has sold nearby`;
  }
  const area = classification.lead_fields.area;
  // Only pitch a search when the intent is genuinely real estate. Extracted lead_fields are not
  // sufficient evidence: "$15k deposit threshold" in a fintech cold email parses as a budget, and
  // gating on field presence let that mail get a shortlist pitch anyway.
  if (!TIER_A_INTENTS.has(classification.intent)) {
    return "confirming what you are actually asking for before I take this any further";
  }
  // No address, no area, no stated criteria: do not invent a buyer brief. Ask first.
  if (!area && !classification.lead_fields.budget && !classification.lead_fields.beds) {
    return "confirming what you are looking for before I put anything together";
  }
  return `putting a shortlist together${area ? ` in ${area}` : ""} against your price range and bedroom count`;
}

/**
 * Safe substantive answer plus the single item a human must confirm.
 * Every branch is a reply a licensed agent could send as written.
 */
function irisReviewDraftParts(classification: IrisEmailClassification): { answer: string[]; confirm: string } {
  const address = classification.address;
  const forProperty = address ? ` for ${address}` : "";
  const flags = classification.compliance_flags;
  const nextStep = irisReviewNextStep(classification);

  if (classification.human_handoff_reason === "wrong_recipient") {
    return {
      answer: [
        "Apologies for the mix up, it sounds like this thread reached the wrong person.",
        "I have stopped the follow ups on this address. If you would rather we delete the record entirely, say the word and it is done, otherwise nothing further will come from us.",
      ],
      confirm: "the record is actually removed from the follow up list",
    };
  }
  if (flags.includes("prompt_injection")) {
    return {
      answer: [
        `Happy to help with the property side. I can start on ${nextStep}.`,
        "Part of your message asked me to change how I operate or repeat my internal instructions, and I am not able to do that. If that was not you, someone may be testing the inbox and it is worth a look.",
      ],
      confirm: "that the property question is legitimate before replying",
    };
  }
  if (flags.includes("privacy")) {
    return {
      answer: [
        "Please do not send a social security number, bank account, or routing number by email, to us or to anyone else. Nothing at this stage needs it.",
        `When that information is genuinely required it goes through the title company's secure portal, never a message thread. In the meantime I can keep moving on ${nextStep}.`,
      ],
      confirm: "nothing is outstanding, this is safe to send as written",
    };
  }
  if (flags.includes("fair_housing")) {
    return {
      answer: [
        "I am not able to characterize an area by the people who live there, so I will not answer it that way. What I can give you is objective and checkable.",
        `${address ? `For ${address} I` : "I"} can send the school district and attendance boundary, the published crime statistics from the local police department, commute and walkability times, and the HOA documents if there are any. You draw your own conclusions from the source data.`,
      ],
      confirm: "which of those objective reports to attach",
    };
  }
  if (flags.includes("mortgage_license")) {
    return {
      answer: [
        "I am not licensed to quote a rate or tell you what you would be approved for, and I would rather not guess at a number that can move on you.",
        `What I can do is introduce you to our lender for a same day pre-approval, and send the list price, tax assessment, and HOA dues${forProperty} so you can run your own math tonight.`,
      ],
      confirm: "which lender to introduce",
    };
  }
  if (flags.includes("legal")) {
    return {
      answer: [
        "This is a legal question and you deserve a real answer instead of my best guess, so I am not going to improvise one.",
        `I can walk you through the practical timeline and the documents involved, and get you in front of our broker or a real estate attorney this week. Separately I can keep working on ${nextStep}.`,
      ],
      confirm: "who to route the legal question to",
    };
  }
  if (flags.includes("contract_terms")) {
    return {
      answer: [
        "Commission, representation, and inspection terms are set by the broker rather than by me, so I want them confirmed in writing before you rely on anything I say about them.",
        `What is not blocked is the actual work: I can start ${nextStep}.`,
      ],
      confirm: "the exact commission and contract terms to quote",
    };
  }
  if (flags.includes("angry_or_complaint")) {
    return {
      answer: [
        "You are right to be frustrated, and I would rather fix this than explain it.",
        `Here is what I am doing about it: ${nextStep}. If a call is easier, give me a window today or tomorrow and someone will phone you directly.`,
      ],
      confirm: "what happened on our side so the apology is accurate",
    };
  }
  if (flags.includes("broker_approval")) {
    return {
      answer: [
        "This one needs broker sign off before it goes out in writing, so I am not going to commit us to it.",
        `In the meantime I can get on with ${nextStep}.`,
      ],
      confirm: "broker approval on the wording",
    };
  }
  // No compliance flag, just an unclear ask. Answer the clear part, name the unclear part.
  return {
    answer: [
      `Happy to help. Here is where I can start without waiting: ${nextStep}.`,
      "I want to make sure I answer the rest of your question properly rather than approximately, so tell me a little more and I will come back with specifics.",
    ],
    confirm: "what the lead is actually asking before this goes out",
  };
}

export function generateIrisEmailReply(message: IrisEmailMessage, classification: IrisEmailClassification): string | null {
  const execution = decideIrisEmailExecution(classification);
  if (!execution.canReply) {
    if (execution.status === "spam") return null;
    const { answer, confirm } = irisReviewDraftParts(classification);
    return [
      "Hello,",
      "",
      ...answer.flatMap((paragraph) => [paragraph, ""]),
      "Best,",
      IRIS_AGENT_NAME,
      "",
      `${IRIS_REVIEW_MARKER} ${confirm}. Delete this line before you send.]`,
    ].join("\n");
  }
  const question = classification.next_best_question;
  if (classification.intent === "showing_request") {
    const showingCopy = question
      ? `I can help arrange a showing${classification.address ? ` for ${classification.address}` : ""}. ${question}`
      : `Thanks, I have your requested time${classification.address ? ` for ${classification.address}` : ""} and will have the team confirm availability.`;
    return [
      "Hello,",
      "",
      showingCopy,
      "",
      "Best,",
      IRIS_AGENT_NAME,
    ].join("\n");
  }
  if (classification.primary_lead_role === "second_time_buyer") {
    const valuationAccepted = classification.opportunity_tags.includes("valuation_consented");
    const valuationUrl = (process.env.FILLOUT_VALUATION_URL || process.env.CALENDLY_URL || "").trim();
    return [
      "Hello,",
      "",
      valuationAccepted
        ? "Thanks for confirming. We can help with your next purchase and arrange a free valuation of your current property."
        : "Thanks for confirming. Since you already own a property, we can help with your next purchase and coordinate a free valuation of your current property too.",
      "",
      valuationAccepted
        ? valuationUrl || "What is the address of the property you would like valued?"
        : question || "Would you like me to arrange the valuation?",
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

export function formatPlainTextEmail(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/([^\n])\s+(https?:\/\/[^\s<>]+)/g, "$1\n\n$2")
    .replace(/(https?:\/\/[^\s<>]+)\s+([^\n])/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function irisEmailCta(classification?: IrisEmailClassification): { label: string; url: string; color: string } | null {
  if (!classification) return null;
  const scheduling = classification.intent === "showing_request" || classification.intent === "property_details";
  const valuation = classification.intent === "seller_lead" || classification.primary_lead_role === "second_time_buyer";
  const rawUrl = scheduling
    ? process.env.CALENDLY_URL || ""
    : valuation
      ? process.env.FILLOUT_VALUATION_URL || ""
      : "";
  try {
    const url = new URL(rawUrl.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    return scheduling
      ? { label: "Schedule Showing", url: url.toString(), color: "#2563eb" }
      : { label: "Get Free Home Valuation", url: url.toString(), color: "#16803c" };
  } catch {
    return null;
  }
}

function irisEmailCtaHtml(cta: { label: string; url: string; color: string }): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td bgcolor="${cta.color}" style="border-radius:5px;background-color: ${cta.color}"><a href="${htmlEscape(cta.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 18px;border:1px solid ${cta.color};border-radius:5px;background-color: ${cta.color};color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.2;text-decoration:none">${htmlEscape(cta.label)}</a></td></tr></table>`;
}

export function buildHtmlEmailReply(text: string, properties: SheetRow[] = [], classification?: IrisEmailClassification): IrisEmailReplyDraft {
  const cleanProperties = dedupeProperties(properties);
  const featured = cleanProperties[0];
  const rest = cleanProperties.slice(1, 4);
  const bodyText = refineShowingReplyForSelectedProperty(text, featured, classification);
  const cta = irisEmailCta(classification);
  const htmlBodyText = cta
    ? bodyText.split("\n").filter((line) => line.trim() !== cta.url).join("\n").trim()
    : bodyText;
  const wantsAlternatives = /\b(similar|options?|alternatives?|compare|another|other)\b/i.test(text);
  const showAlternatives = Boolean(
    rest.length
    && classification?.intent !== "showing_request"
    && (classification?.intent === "property_search" || wantsAlternatives)
  );
  // Never announce matches when there is no card to back them up. An empty property list
  // with "I found the best matching options" is a fabricated claim.
  const subjectLine = !cleanProperties.length
    ? ""
    : classification?.intent === "property_search"
      ? "I found the best matching options from our inventory."
      : classification?.intent === "showing_request"
        ? ""
        : featured
          ? "Here are the property details from our inventory."
          : "";
  const plainProperties = showAlternatives ? cleanProperties.slice(0, 4) : cleanProperties.slice(0, featured ? 1 : 0);
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;color:#111827;line-height:1.45">
${plainToHtml(htmlBodyText.replace(/\n*Best,\nIris\s*$/i, "").trim())}
${subjectLine ? `<p style="margin:20px 0 14px;line-height:1.55">${htmlEscape(subjectLine)}</p>` : ""}
${featured ? propertyCardHtml(featured, true) : ""}
${showAlternatives ? `<h3 style="margin:20px 0 10px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#475569">Similar options</h3>${rest.map((property) => propertyCardHtml(property)).join("")}` : ""}
<p style="margin:20px 0 0;color:#555;line-height:1.45">Best,<br><strong>Iris</strong></p>
${cta ? irisEmailCtaHtml(cta) : ""}
</div>`;
  const propertyText = plainProperties.length
    ? `\n\nProperty details:\n${plainProperties.map(propertyPlain).join("\n\n")}`
    : "";
  const ctaText = cta && !bodyText.includes(cta.url) ? `\n\n${cta.label}\n\n${cta.url}` : "";
  return {
    text: formatPlainTextEmail(`${bodyText}${propertyText}${ctaText}`),
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
  styleContext = "",
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
  const reviewDraft = !decideIrisEmailExecution(classification).canReply;
  const system = `You are ${IRIS_AGENT_NAME}, the real estate email assistant. Claude is the reasoning brain for this email agent.
Write only the email body, no markdown and no subject line.
Rules:
- Keep it concise and useful.
${advancedQualificationPlaybook()}
- Use only provided facts. Do not invent availability, schools, neighborhood claims, lending advice, legal advice, or broker judgment.
- The app will render property facts in an HTML property card below your body, so do not repeat the full price/beds/baths/sqft block in prose.
- Mention the primary address at most once.
- If this is a showing request and a primary property is provided, treat that property as selected. Do not ask which property or which option they want.
- If the latest inbound says they are no longer interested in a prior property or asks for other options, pivot to the new search. Do not lead with the previous property.
- Ask at most one next-step question.
- ${reviewDraft
    ? `This draft goes to a human for review before sending, so it must still be a real reply the agent could send as written. Answer everything you can answer safely and specifically. Do not decide the flagged sensitive point and do not invent facts. Never write a message whose only content is that the team will review it. After the signature, add exactly one line starting with "${IRIS_REVIEW_MARKER}" naming the single item the human must confirm, then "Delete this line before you send.]".`
    : "This reply is approved for autonomous sending. Answer and advance the conversation without mentioning internal review."}
- Never use em dashes. Use commas, periods, or simple hyphens instead.
- ${reviewDraft
    ? `End with:\nBest,\n${IRIS_AGENT_NAME}\nthen the single "${IRIS_REVIEW_MARKER} ...]" review line and nothing after it.`
    : `End exactly with:\nBest,\n${IRIS_AGENT_NAME}`}
${styleContext ? `\nTenant and mailbox voice profile:\n${styleContext}` : ""}`;
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
  const styleContext = await fetchStyleContext(classification.intent, undefined, message.mailboxEmail || "");
  if (!databaseEnabled()) {
    const plain = await generateClaudeIrisEmailReplyText(message, classification, [], styleContext).catch(() => null) || fallbackPlain;
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
  const plain = await generateClaudeIrisEmailReplyText(message, classification, properties, styleContext).catch(() => null) || fallbackPlain;
  return buildHtmlEmailReply(plain, properties, classification);
}

function normalizeReplyDraft(reply: string | IrisEmailReplyDraft | null): IrisEmailReplyDraft | null {
  if (!reply) return null;
  if (typeof reply === "string") return { text: formatPlainTextEmail(removeEmDashes(reply)) };
  if (!reply.text.trim() && !reply.html?.trim()) return null;
  return { ...reply, text: formatPlainTextEmail(removeEmDashes(reply.text)), html: removeEmDashes(reply.html || "") };
}

async function messageWithLeadContext(message: IrisEmailMessage): Promise<IrisEmailMessage> {
  if (!databaseEnabled()) return message;
  const contact = parseEmailContact(message.from);
  if (!contact.email) return message;
  const lead = await findLeadInDatabase({ email: contact.email });
  const events = await readEventsForLeadFromDatabase({ email: contact.email, phone: lead?.phone }, 20);
  const threadEvents = events.filter((event) => (event.thread_ref || event.gmail_thread_id) === message.threadId);
  const knownContact = Boolean(lead);
  if (
    !lead?.property_interest
    && !lead?.budget
    && !lead?.area
    && !lead?.bedrooms
    && !lead?.summary
    && !threadEvents.length
  ) return { ...message, knownContact };
  const recentEvents = threadEvents.slice(-6).map((event) => {
    const when = event.event_at || event.created_at || "";
    const text = cleanBody(stripHtml(event.message_text || event.summary || "")).slice(0, 220);
    return `${when} ${event.channel || "unknown"} ${event.direction || "unknown"} ${event.status || ""}: ${text}`;
  });
  const context = [
    !threadEvents.length && lead?.budget ? `Known budget: ${lead.budget}` : "",
    !threadEvents.length && lead?.area ? `Known area: ${lead.area}` : "",
    !threadEvents.length && lead?.bedrooms ? `Known bedrooms: ${lead.bedrooms}` : "",
    recentEvents.length ? `Recent thread timeline:\n${recentEvents.join("\n")}` : "",
  ].filter(Boolean).join("\n");
  return {
    ...message,
    knownContact,
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

function irisEmailStatusCategorySlug(execution: IrisEmailExecution, sent: boolean, skippedDuplicate: boolean): string {
  if (execution.status === "spam") return "closed_no_reply";
  if (execution.status === "needs_human") return "needs_human";
  if (sent || skippedDuplicate) return "waiting_lead";
  return "needs_reply";
}

function irisEmailTopicCategorySlugs(classification: IrisEmailClassification): string[] {
  const slugs: string[] = [];
  if (classification.intent === "showing_request") slugs.push("showing");
  if (
    classification.intent === "seller_lead"
    || classification.primary_lead_role === "seller"
    || classification.primary_lead_role === "second_time_buyer"
    || classification.opportunity_tags.some((tag) => /valuation|sell_before_buy/.test(tag))
  ) slugs.push("seller_valuation");
  if (classification.primary_lead_role === "mortgage_adjacent_lead") slugs.push("financing");
  if (classification.urgency === "high" || classification.intent === "showing_request") slugs.push("hot_lead");
  return [...new Set(slugs)];
}

/**
 * Maps INTERNAL execution state onto the mailbox plan. The internal status slug stays in the
 * database; only `planMailboxLabels` decides what a user ever sees.
 *
 * `skippedDuplicate` deliberately does NOT count as a confirmed send. A duplicate means "this
 * message was already handled", which is not evidence that a reply went out on this pass, so it
 * cannot mint an `Auto Replied` label. The re-assert below preserves a label the earlier pass
 * legitimately wrote, so idempotency survives without lying about what happened.
 */
function irisEmailLabels(
  execution: IrisEmailExecution,
  classification: IrisEmailClassification,
  categories: InboxCategory[],
  sent: boolean,
  skippedDuplicate: boolean,
  settings: InboxSettings = DEFAULT_INBOX_SETTINGS,
  message?: IrisEmailMessage,
): MailboxLabelPlan & { statusSlug: string } {
  const statusSlug = irisEmailStatusCategorySlug(execution, sent, skippedDuplicate);
  const plan = planMailboxLabels({
    settings,
    categories,
    sendConfirmed: sent,
    stoppedForReview: execution.status === "needs_human",
    signals: {
      fromEmail: message?.from,
      subject: message?.subject,
      body: message?.body,
      existingLabels: message?.labelIds || [],
      knownContact: Boolean(message?.knownContact),
    },
  });
  // Preserve, never mint: an already-handled duplicate keeps whatever managed label it carries.
  const carriedOver = skippedDuplicate && !sent
    ? plan.managedLabels.filter((name) => (message?.labelIds || []).includes(name))
    : [];
  const topicSlugs = irisEmailTopicCategorySlugs(classification);
  return {
    ...plan,
    addLabels: [...new Set([...plan.addLabels, ...carriedOver])],
    // Internal-only topic slugs stay internal; they are surfaced to callers for the DB row.
    categorySlug: plan.categorySlug || topicSlugs[0] || "",
    statusSlug,
  };
}

async function recordIrisHumanReviewSend(
  message: IrisEmailMessage,
  categories: InboxCategory[],
  emailClient: IrisEmailClient,
  alreadyRecorded: boolean,
  settings: InboxSettings = DEFAULT_INBOX_SETTINGS,
): Promise<void> {
  const threadRef = message.threadId || message.id;
  const mailboxEmail = (message.mailboxEmail || parseEmailContact(message.from).email).toLowerCase();
  const recipient = parseEmailContact(message.to || "");
  const body = cleanBody(message.body);
  const now = new Date().toISOString();

  if (!alreadyRecorded) {
    await appendConversationEventToDatabase({
      event_at: now,
      channel: "email",
      direction: "outbound",
      email: recipient.email,
      full_name: recipient.name || recipient.email,
      source: "gmail",
      thread_ref: threadRef,
      agent_name: "IRIS",
      event_type: "email_human_reply",
      message_text: body,
      summary: "Human sent an Iris review draft",
      ai_action: "human_approved_send",
      status: "sent",
      mailbox_email: mailboxEmail,
      gmail_message_id: message.id,
      gmail_thread_id: message.threadId,
    });
  }

  // A human pressing send in Gmail IS a confirmed authorized send, so `Auto Replied` is earned and
  // `Needs Human` is cleared. Nothing else about the user's organization is touched.
  const plan = planMailboxLabels({
    settings,
    categories,
    sendConfirmed: true,
    stoppedForReview: false,
    signals: {
      fromEmail: message.from,
      subject: message.subject,
      existingLabels: message.labelIds || [],
      knownContact: message.knownContact,
    },
  });
  await emailClient.applyLabels(message, plan.addLabels, plan.managedLabels, {
    removeFromInbox: plan.removeFromInbox,
  });
  await upsertThreadLinkInDatabase({
    threadRef,
    channel: "email",
    mailboxEmail,
    gmailThreadId: message.threadId,
    gmailMessageId: message.id,
    threadStatus: "current_mailbox_thread",
  });
  const redactedExcerpt = redactEmailStyleExample(body);
  if (redactedExcerpt) {
    await insertApprovedEmailStyleExampleInDatabase({
      sourceMessageId: message.id,
      mailboxEmail,
      category: "",
      toneTags: ["human_approved"],
      redactedExcerpt,
    });
  }
  await releaseTakeover(threadRef, "email");
  await updateAiDraftStatusInDatabase({ threadRef, channel: "email", status: "sent" });
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
  const categories = deps.categories ?? (databaseEnabled() ? await readInboxCategoriesFromDatabase() : []);
  // Read the tenant's real settings, exactly like the categories line above. Without this the
  // production poll always ran on DEFAULT_INBOX_SETTINGS, so a user who opted in and pressed start
  // still got nothing organized. No database means the untouched-inbox defaults, never opt-in.
  const settings = deps.settings ?? (databaseEnabled() ? await readInboxSettingsFromDatabase() : DEFAULT_INBOX_SETTINGS);
  // Only ever create the labels the plan can actually write. With categorization off that is the
  // two managed system labels and nothing else, so a poll never litters a user's label list.
  const syncedCategories = !dryRun && emailClient.syncCategoryLabels
    ? await emailClient.syncCategoryLabels(mailboxCategories(settings, categories))
    : categories;
  const listedMessages = await emailClient.listUnreadMessages(limit);
  const outboundMessages = listedMessages.filter((message) => message.direction === "outbound");
  const inboundMessages = listedMessages.filter((message) => message.direction !== "outbound");
  const { messages, superseded } = coalesceIrisEmailThreadFollowUps(inboundMessages);
  const results: IrisEmailProcessResult[] = [];
  const readActiveDraft = deps.readActiveDraft || (async (threadRef: string) => (
    databaseEnabled() ? await readAiDraftFromDatabase({ threadRef, channel: "email" }) : null
  ));
  const storeReviewDraft = deps.storeReviewDraft || (async (draft: Omit<AiDraft, "updated_at" | "status">) => {
    if (databaseEnabled()) await upsertAiDraftInDatabase(draft);
  });
  const archiveActiveDraft = deps.archiveActiveDraft || (async (threadRef: string) => {
    if (databaseEnabled()) await updateAiDraftStatusInDatabase({ threadRef, channel: "email", status: "archived" });
  });
  const resolveSentReview = deps.resolveSentReview || (async (message, state) => {
    await recordIrisHumanReviewSend(message, syncedCategories, emailClient, state.alreadyRecorded, settings);
  });

  if (!dryRun) {
    for (const message of outboundMessages) {
      const existingEvent = deps.duplicateExists
        ? await deps.duplicateExists(message.id)
        : databaseEnabled()
          ? Boolean(await readConversationEventByGmailMessageId(message.id))
          : false;
      const activeDraft = await readActiveDraft(message.threadId || message.id);
      if (activeDraft) await resolveSentReview(message, { alreadyRecorded: existingEvent });
    }
  }

  // Same-thread follow-ups are folded into the newest message. Mark older copies handled so a
  // later inbox scan cannot send a second reply.
  //
  // Marking read is ALL that happens here. The old code stamped `Auto Replied` on every superseded
  // copy, which claimed a send that never happened for that message and — because the Gmail call is
  // thread-scoped — raced the newest message's own plan a few lines below. Empty managed set means
  // nothing is removed either, so a label the previous pass legitimately wrote survives.
  if (!dryRun) {
    for (const message of superseded) {
      await emailClient.applyLabels(message, [], []);
    }
  }

  for (const message of messages) {
    const classificationMessage = await messageWithLeadContext(message);
    const classification = classify(classificationMessage);
    const execution = decideIrisEmailExecution(classification);
    const generatedReply = await generateReply(message, classification);
    const replyDraft = normalizeReplyDraft(
      generatedReply || (execution.status === "needs_human" ? generateIrisEmailReply(message, classification) : null),
    );
    let recorded = false;
    let labeled = false;
    let sent = false;
    let skippedDuplicate = false;
    let labelPlan: (MailboxLabelPlan & { statusSlug: string }) | null = null;

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
      const threadRef = message.threadId || message.id;
      const activeDraft = !skippedDuplicate ? await readActiveDraft(threadRef) : null;
      if (!skippedDuplicate && options.sendReplies && execution.canReply && replyDraft && emailClient.sendReply) {
        const replyResult = await emailClient.sendReply(message, replyDraft.text, replyDraft.html);
        if (!deps.recordInteraction && databaseEnabled()) {
          await appendConversationEventToDatabase(
            buildIrisEmailOutboundEventRow(message, classification, replyDraft, replyResult),
          );
        }
        sent = true;
        if (activeDraft) {
          if (activeDraft.gmail_draft_id && emailClient.deleteDraft) {
            await emailClient.deleteDraft(activeDraft.gmail_draft_id).catch(() => undefined);
          }
          await archiveActiveDraft(threadRef);
        }
      } else if (!skippedDuplicate && execution.status === "needs_human" && replyDraft?.text) {
        const saved = emailClient.saveDraft
          ? await emailClient.saveDraft(
            message,
            replyDraft.text,
            replyDraft.html,
            activeDraft?.gmail_draft_id || "",
          ).catch(() => null)
          : emailClient.createDraft
            ? await emailClient.createDraft(message, replyDraft.text, replyDraft.html).catch(() => null)
            : null;
        const gmailDraft = saved && typeof saved === "object" ? saved : null;
        await storeReviewDraft({
          thread_ref: threadRef,
          channel: "email",
          body: replyDraft.text,
          category_slug: "needs_human",
          confidence: classification.confidence ?? 0.75,
          reason: execution.handoffReason || "Human review, draft ready to send",
          next_action: "review_send",
          safe_to_auto_send: false,
          needs_human: true,
          model: "iris_email",
          fingerprint: `iris-draft:${message.id}`,
          gmail_draft_id: gmailDraft?.draftId || activeDraft?.gmail_draft_id || "",
          gmail_message_id: gmailDraft?.messageId || "",
          gmail_thread_id: gmailDraft?.threadId || message.threadId || "",
          gmail_mailbox_email: gmailDraft?.mailboxEmail || message.mailboxEmail || "",
          gmail_draft_synced_at: gmailDraft?.draftId ? new Date().toISOString() : "",
        });
      }

      // Label writes come AFTER the send resolves, always. `sent` is only true once sendReply has
      // returned, so `Auto Replied` can never appear on a thread whose send failed or is in flight.
      const labelState = irisEmailLabels(
        execution,
        classification,
        syncedCategories,
        sent,
        skippedDuplicate,
        settings,
        { ...classificationMessage, labelIds: message.labelIds || [] },
      );
      await emailClient.applyLabels(message, labelState.addLabels, labelState.managedLabels, {
        removeFromInbox: labelState.removeFromInbox,
      });
      labeled = true;
      labelPlan = labelState;
      // Persist WHY the mailbox changed. Reorganizing someone's mail without a readable trail is
      // the thing that makes an inbox agent impossible to trust after the fact. Never fatal.
      await writeRequestAuditEvent({
        route: "agent:iris-email",
        method: "LABEL",
        channel: "email",
        provider: "gmail",
        threadRef: message.threadId,
        contactRef: parseEmailContact(message.from).email || message.from,
        providerMessageId: message.id,
        stage: "mailbox_label",
        outcome: labelState.removeFromInbox ? "filed" : "labeled",
        metadata: {
          added: labelState.addLabels,
          managed: labelState.managedLabels,
          removed_from_inbox: labelState.removeFromInbox,
          category_slug: labelState.categorySlug,
          reasons: labelState.reasons,
        },
      }).catch(() => undefined);
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
      // On a dry run this is the plan that WOULD have been applied, so `--dry-run` doubles as the
      // preview surface for a mailbox nobody has agreed to reorganize yet.
      labelPlan: labelPlan || irisEmailLabels(
        execution,
        classification,
        syncedCategories,
        sent,
        skippedDuplicate,
        settings,
        { ...classificationMessage, labelIds: message.labelIds || [] },
      ),
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

export function irisGmailMessageDirection(
  labelIds: string[],
  from: string,
  mailboxEmail: string,
): IrisEmailMessage["direction"] | null {
  const sender = parseEmailContact(from).email;
  const mailbox = mailboxEmail.trim().toLowerCase();
  if (labelIds.includes("SENT") && mailbox && sender === mailbox) return "outbound";
  if (labelIds.includes("INBOX") && (!mailbox || sender !== mailbox)) return "inbound";
  return null;
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

/**
 * Gmail returns opaque label IDs (`Label_12`) for user labels and bare tokens (`INBOX`) for system
 * ones. The label plan reasons about NAMES, so resolve once per poll rather than per message.
 * A failure here degrades to "no known labels", which makes `respect_existing_labels` conservative
 * in the wrong direction, so it deliberately keeps the system tokens it can map without the API.
 */
async function gmailLabelNamesById(gmail: GmailClient): Promise<Map<string, string>> {
  try {
    const listed = await gmail.users.labels.list({ userId: "me" });
    return new Map((listed.data.labels || []).flatMap((label) => (
      label.id && label.name ? [[label.id, label.name] as const] : []
    )));
  } catch {
    return new Map();
  }
}

function resolveLabelNames(labelIds: string[], namesById: Map<string, string>): string[] {
  return labelIds.map((id) => namesById.get(id) || id).filter(Boolean);
}

async function listUnreadMessages(gmail: GmailClient, limit: number, mailboxEmail = ""): Promise<IrisEmailMessage[]> {
  const listed = await gmail.users.messages.list({
    userId: "me",
    maxResults: limit,
    q: irisEmailPollQuery(),
  });
  const refs = listed.data.messages || [];
  const messages: IrisEmailMessage[] = [];
  const labelNamesById = refs.length ? await gmailLabelNamesById(gmail) : new Map<string, string>();
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
        direction: "inbound" as const,
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
        labelIds: resolveLabelNames(detail.data.labelIds || [], labelNamesById),
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
  const labelNamesById = uniqueIds.length ? await gmailLabelNamesById(gmail) : new Map<string, string>();
  for (const id of uniqueIds) {
    let detail;
    try {
      detail = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    } catch (error) {
      const candidate = error as { code?: unknown; response?: { status?: unknown } };
      const status = Number(candidate?.code || candidate?.response?.status || 0);
      // Gmail history is eventually consistent: a message can be deleted between
      // history.list and messages.get. One vanished message must not poison the
      // entire push batch and prevent newer mail from being processed.
      if (status === 404) continue;
      throw error;
    }
    const labelIds = detail.data.labelIds || [];
    // Explicit-id fetch handles both new inbound mail and sent review drafts.
    // Parked needs_human messages can be read already, so UNREAD is not required.
    const payload = detail.data.payload as Record<string, unknown> | undefined;
    const headers = (payload?.headers || []) as Array<{ name?: string | null; value?: string | null }>;
    const body = bodyFromPayload(payload);
    const media = await mediaFromGmailPayload(gmail, id, payload);
    const message = {
      id,
      threadId: detail.data.threadId || id,
      direction: irisGmailMessageDirection(labelIds, header(headers, "From"), mailboxEmail),
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
      labelIds: resolveLabelNames(labelIds, labelNamesById),
    };
    if (message.direction === "outbound") messages.push({ ...message, direction: "outbound" });
    if (message.direction === "inbound" && isIrisEligibleEmail(message)) {
      messages.push({ ...message, direction: "inbound" });
    }
  }
  return messages;
}

async function applyGmailLabels(
  gmail: GmailClient,
  message: IrisEmailMessage,
  labels: string[],
  managedLabels: string[] = [],
  options: { removeFromInbox?: boolean } = {},
): Promise<void> {
  await replaceGmailThreadLabels(gmail, {
    threadId: message.threadId,
    messageId: message.id,
    addLabelNames: labels,
    // UNREAD is always managed (Iris has handled the message). INBOX only joins the managed set
    // when the plan actually asked to file the thread, so a default run can never archive mail.
    managedLabelNames: [...managedLabels, "UNREAD", ...(options.removeFromInbox ? ["INBOX"] : [])],
  });
}

async function syncGmailCategoryLabels(gmail: GmailClient, categories: InboxCategory[]): Promise<InboxCategory[]> {
  if (!categories.length) return categories;
  const synced: InboxCategory[] = [];
  for (const category of categories) {
    // No `Iris/` fallback. A category with no explicit label name is a configuration bug, not a
    // licence to invent a namespaced label inside someone's mailbox, so it is skipped.
    const labelName = category.gmail_label_name.trim();
    if (!labelName || category.auto_rules?.mailbox !== true) {
      synced.push(category);
      continue;
    }
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

export async function syncInboxCategoriesWithGmail(
  categories: InboxCategory[],
  settings: InboxSettings = DEFAULT_INBOX_SETTINGS,
): Promise<InboxCategory[]> {
  const session = await createIrisGmailSession();
  // Create only what the plan may write. Saving settings must not pre-create a taxonomy the user
  // has not switched on.
  const eligible = mailboxCategories(settings, categories);
  const eligibleSlugs = new Set(eligible.map((category) => category.slug));
  const synced = new Map(
    (await syncGmailCategoryLabels(session.gmail, eligible)).map((category) => [category.slug, category] as const),
  );
  return categories.map((category) => (
    eligibleSlugs.has(category.slug) ? synced.get(category.slug) || category : category
  ));
}

export async function createGmailIrisEmailClient(): Promise<IrisEmailClient> {
  const session = await createIrisGmailSession();
  const gmail = session.gmail;
  return {
    listUnreadMessages: (limit) => listUnreadMessages(gmail, limit, session.accountEmail),
    applyLabels: (message, labels, managedLabels, options) => applyGmailLabels(gmail, message, labels, managedLabels, options),
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
    saveDraft: (message, body, htmlBody, existingDraftId) => {
      const input = {
        to: parseEmailContact(message.from).email,
        subject: message.subject,
        body,
        htmlBody,
        threadId: message.threadId,
        messageId: message.messageId,
        references: message.references,
      };
      return existingDraftId
        ? updateGmailReplyDraftWithOptions(gmail, existingDraftId, input, { mailboxEmail: session.accountEmail })
        : createGmailReplyDraftWithOptions(gmail, input, { mailboxEmail: session.accountEmail });
    },
    deleteDraft: (draftId) => deleteGmailDraft(gmail, draftId),
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
    applyLabels: (message, labels, managedLabels, options) => applyGmailLabels(gmail, message, labels, managedLabels, options),
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
    saveDraft: (message, body, htmlBody, existingDraftId) => {
      const input = {
        to: parseEmailContact(message.from).email,
        subject: message.subject,
        body,
        htmlBody,
        threadId: message.threadId,
        messageId: message.messageId,
        references: message.references,
      };
      return existingDraftId
        ? updateGmailReplyDraftWithOptions(gmail, existingDraftId, input, { mailboxEmail: session.accountEmail })
        : createGmailReplyDraftWithOptions(gmail, input, { mailboxEmail: session.accountEmail });
    },
    deleteDraft: (draftId) => deleteGmailDraft(gmail, draftId),
  };
  return processIrisEmailPoll(
    { ...options, limit: Math.max(1, Math.min(messageIds.length || options.limit || 10, 25)) },
    { ...deps, emailClient },
  );
}
