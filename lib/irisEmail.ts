import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import {
  appendConversationEventToDatabase,
  databaseEnabled,
  upsertLeadMemoryToDatabase,
} from "@/lib/database";
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

export type IrisEmailClient = {
  listUnreadMessages(limit: number): Promise<IrisEmailMessage[]>;
  applyLabels(messageId: string, labels: string[]): Promise<void>;
  sendReply?(message: IrisEmailMessage, body: string): Promise<void>;
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
  generateReply?: (message: IrisEmailMessage, classification: IrisEmailClassification) => string | null;
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

function extractBudget(text: string): string | null {
  const match = text.match(/\$ ?\d[\d,.]*(?:\s?[kKmM])?|\b\d[\d,.]*\s?(?:k|m)\b/);
  return match ? match[0].replace(/\s+/g, "") : null;
}

function extractBeds(text: string): string | null {
  const match = text.match(/\b([1-9])\s*(?:bed|beds|bedroom|bedrooms|bd)\b/i);
  return match ? match[1] : null;
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
  const clean = cleanBody(`${message.subject || ""}\n${message.body || ""}`);
  const addresses = extractAddresses(clean);
  const flags = detectIrisComplianceFlags(clean);
  const noSignal = noOrStopSignal(clean);
  const fields: IrisLeadFields = {
    timeline: extractTimeline(clean),
    budget: extractBudget(clean),
    area: extractArea(clean),
    beds: extractBeds(clean),
    current_property_status: /\b(i own|my house|my home)\b/i.test(clean) ? "owns" : /\b(i rent|renting)\b/i.test(clean) ? "rents" : "unknown",
    preferred_channel: preferredChannel(clean),
  };

  let intent: IrisEmailIntent = "human_required";
  let role: IrisLeadRole = "unknown";
  const opportunityTags: string[] = [];

  const spamLike = /(seo|backlinks?|guest post|sponsored post|crypto|web design|rank on google|lead generation service|press release distribution)/i.test(clean);
  const realEstateLike = /(home|house|condo|property|listing|showing|tour|buy|sell|rent|lease|realtor|real estate|bedroom|mortgage)/i.test(clean) || addresses.length > 0;
  if (spamLike && !realEstateLike) {
    intent = "spam";
  } else if (flags.some((flag) => SENSITIVE_FLAGS.has(flag)) || noSignal === "stop") {
    intent = "human_required";
  } else if (addresses.length) {
    intent = /(show|tour|see|visit|schedule|available today|open house)/i.test(clean) ? "showing_request" : "property_details";
    role = "buyer";
  } else if (/(showing|tour|open house|see it|view it|schedule|appointment)/i.test(clean)) {
    intent = "showing_request";
    role = "buyer";
  } else if (/(sell|listing appointment|list my|home value|valuation|what is my house worth|cma)/i.test(clean)) {
    intent = "seller_lead";
    role = "seller";
    opportunityTags.push("valuation_interest");
  } else if (/(rent|lease|rental|tenant)/i.test(clean)) {
    intent = "renter_lead";
    role = "renter";
  } else if (/(looking for|homes?|houses?|condos?|available|inventory|options|under \$|bedroom|bd)/i.test(clean)) {
    intent = "property_search";
    role = "buyer";
  } else if (/(buy|purchase|preapproved|pre-approved|mortgage|loan)/i.test(clean)) {
    intent = "buyer_lead";
    role = /(mortgage|loan|preapproved|pre-approved)/i.test(clean) ? "mortgage_adjacent_lead" : "buyer";
  }

  if (/(asap|today|tomorrow|urgent|this week)/i.test(clean)) opportunityTags.push("high_urgency");
  if (/(mortgage|loan|preapproved|pre-approved|lender|rate)/i.test(clean)) opportunityTags.push("mortgage_interest");
  if (/(sell before (?:i )?buy|need to sell first|contingent)/i.test(clean)) opportunityTags.push("sell_before_buy");
  if (noSignal) opportunityTags.push(noSignal === "stop" ? "opt_out" : "clear_no");

  if (role === "mortgage_adjacent_lead" && flags.includes("mortgage_license")) intent = "human_required";
  if (intent === "human_required" && role === "unknown" && /(complaint|angry|upset|report|legal|attorney|lawyer)/i.test(clean)) {
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
    tone_state: flags.includes("angry_or_complaint") ? "annoyed" : /asap|urgent|today|tomorrow/i.test(clean) ? "urgent" : "neutral",
    urgency: /asap|urgent|today|tomorrow/i.test(clean) ? "high" : "unknown",
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
  const needsHuman = classification.intent === "human_required" || classification.intent === "spam" ||
    classification.recommended_next_action === "route_human" ||
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
      "I can help you get a realistic read on value and next steps.",
      "",
      question || "What address should I look at, and what timeline are you considering?",
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
  const generateReply = deps.generateReply || generateIrisEmailReply;
  const messages = await emailClient.listUnreadMessages(limit);
  const results: IrisEmailProcessResult[] = [];

  for (const message of messages) {
    const classification = classify(message);
    const execution = decideIrisEmailExecution(classification);
    const replyDraft = generateReply(message, classification);
    let recorded = false;
    let labeled = false;
    let sent = false;

    if (!dryRun) {
      await recordInteraction(message, classification, execution, replyDraft);
      recorded = true;
      await emailClient.applyLabels(message.id, execution.labels);
      labeled = true;
      if (options.sendReplies && execution.canReply && replyDraft && emailClient.sendReply) {
        await emailClient.sendReply(message, replyDraft);
        sent = true;
      }
    }

    results.push({
      messageId: message.id,
      threadId: message.threadId,
      from: message.from,
      subject: message.subject,
      classification,
      execution,
      replyDraft,
      recorded,
      labeled,
      sent,
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

type GmailClient = ReturnType<typeof google.gmail>;

function gmailClient(): GmailClient {
  const credentialsPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.GMAIL_CREDENTIALS_PATH || "credentials.json");
  const tokenPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.GMAIL_TOKEN_PATH || "token.json");
  const creds = JSON.parse(fs.readFileSync(credentialsPath, "utf8")) as { installed?: Record<string, string | string[]>; web?: Record<string, string | string[]> };
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  const app = creds.installed || creds.web;
  if (!app) throw new Error("Gmail credentials must include installed or web client config");
  const redirectUris = Array.isArray(app.redirect_uris) ? app.redirect_uris : [];
  const auth = new google.auth.OAuth2(String(app.client_id || ""), String(app.client_secret || ""), String(redirectUris[0] || ""));
  auth.setCredentials(token);
  return google.gmail({ version: "v1", auth });
}

function header(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64Url(value = ""): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function bodyFromPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "";
  const body = payload.body as { data?: string } | undefined;
  if (body?.data) return decodeBase64Url(body.data);
  const parts = payload.parts as Record<string, unknown>[] | undefined;
  if (!parts?.length) return "";
  const plain = parts.find((part) => part.mimeType === "text/plain");
  return bodyFromPayload(plain || parts[0]);
}

async function listUnreadMessages(gmail: GmailClient, limit: number): Promise<IrisEmailMessage[]> {
  const listed = await gmail.users.messages.list({
    userId: "me",
    maxResults: limit,
    q: "is:unread -label:AUTO_REPLIED -label:NEEDS_HUMAN",
  });
  const refs = listed.data.messages || [];
  const messages: IrisEmailMessage[] = [];
  for (const ref of refs) {
    if (!ref.id) continue;
    const detail = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "full" });
    const payload = detail.data.payload as Record<string, unknown> | undefined;
    const headers = (payload?.headers || []) as Array<{ name?: string | null; value?: string | null }>;
    messages.push({
      id: ref.id,
      threadId: detail.data.threadId || ref.threadId || ref.id,
      from: header(headers, "From"),
      to: header(headers, "To"),
      subject: header(headers, "Subject"),
      body: bodyFromPayload(payload),
      snippet: detail.data.snippet || "",
      messageId: header(headers, "Message-ID"),
      references: header(headers, "References"),
      receivedAt: header(headers, "Date"),
    });
  }
  return messages;
}

async function labelId(gmail: GmailClient, name: string): Promise<string> {
  const labels = await gmail.users.labels.list({ userId: "me" });
  const existing = labels.data.labels?.find((label) => label.name === name);
  if (existing?.id) return existing.id;
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
  });
  if (!created.data.id) throw new Error(`Unable to create Gmail label ${name}`);
  return created.data.id;
}

async function applyGmailLabels(gmail: GmailClient, messageId: string, labels: string[]): Promise<void> {
  const addLabelIds = await Promise.all(labels.map((name) => labelId(gmail, name)));
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds },
  });
}

export async function createGmailIrisEmailClient(): Promise<IrisEmailClient> {
  const gmail = gmailClient();
  return {
    listUnreadMessages: (limit) => listUnreadMessages(gmail, limit),
    applyLabels: (messageId, labels) => applyGmailLabels(gmail, messageId, labels),
  };
}
