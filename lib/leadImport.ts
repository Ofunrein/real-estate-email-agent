import crypto from "node:crypto";

import {
  appendLeadImportItemToDatabase,
  createLeadImportBatchInDatabase,
  databaseEnabled,
  findLeadInDatabase,
  updateLeadImportBatchInDatabase,
  upsertLeadMemoryToDatabase,
} from "@/lib/database";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadIdentity";
import type { SheetRow } from "@/lib/sheetSchema";

export const LEAD_IMPORT_STATUSES = ["uploaded", "mapped", "validated", "imported", "segmented", "failed", "archived"] as const;
export const LEAD_IMPORT_SOURCE_TYPES = ["csv", "google_sheets", "crm", "manual", "inbox_history", "composio"] as const;
export const LEAD_IMPORT_SEGMENTS = [
  "hot_buyer",
  "seller_valuation",
  "showing_ready",
  "nurture",
  "financing",
  "renter",
  "needs_human",
  "missing_contact_info",
  "do_not_contact",
  "duplicate_merged",
  "closed_no_reply",
] as const;

export type LeadImportStatus = typeof LEAD_IMPORT_STATUSES[number];
export type LeadImportSourceType = typeof LEAD_IMPORT_SOURCE_TYPES[number];
export type LeadImportSegment = typeof LEAD_IMPORT_SEGMENTS[number];

export type NormalizedLeadImport = {
  email: string;
  phone: string;
  fullName: string;
  firstName: string;
  lastName: string;
  sourceType: LeadImportSourceType;
  sourceProvider: string;
  sourceId: string;
  tags: string[];
  stage: string;
  owner: string;
  notes: string;
  propertyInterest: string;
  leadRole: string;
  intent: string;
  budget: string;
  area: string;
  timeline: string;
  preferredChannel: string;
  smsConsent: string;
  callConsent: string;
  whatsappConsent: string;
  doNotContact: boolean;
  lastActivityAt: string;
  raw: Record<string, unknown>;
};

export type LeadImportRowResult = {
  rowIndex: number;
  normalized: NormalizedLeadImport;
  unmappedColumns: string[];
  segments: LeadImportSegment[];
  status: "validated" | "imported" | "merged" | "duplicate" | "invalid" | "skipped";
  errors: string[];
  campaignEligible: boolean;
  dedupeKey: string;
};

export type LeadImportSummary = {
  batchId: string;
  sourceType: LeadImportSourceType;
  sourceProvider: string;
  totalRows: number;
  importedLeads: number;
  mergedDuplicates: number;
  duplicateRows: number;
  invalidRows: number;
  missingContactInfo: number;
  campaignEligible: number;
  segmentCounts: Record<string, number>;
  unmappedColumns: string[];
};

type ImportOptions = {
  sourceType: LeadImportSourceType;
  sourceProvider?: string;
  sourceName?: string;
  filename?: string;
  dryRun?: boolean;
  metadata?: Record<string, unknown>;
};

const FIELD_ALIASES: Record<keyof Omit<NormalizedLeadImport, "sourceType" | "sourceProvider" | "raw" | "tags" | "doNotContact"> | "tags" | "doNotContact", string[]> = {
  email: ["email", "email address", "primary email", "e-mail"],
  phone: ["phone", "phone number", "mobile", "cell", "cell phone", "primary phone"],
  fullName: ["name", "full name", "contact name", "lead name"],
  firstName: ["first name", "firstname"],
  lastName: ["last name", "lastname"],
  sourceId: ["id", "contact id", "crm id", "lead id", "source id"],
  tags: ["tags", "tag", "labels", "categories", "category"],
  stage: ["stage", "status", "pipeline stage", "lead status", "lifecycle stage"],
  owner: ["owner", "agent", "assigned agent", "assigned owner", "user"],
  notes: ["notes", "note", "description", "last note", "comments"],
  propertyInterest: ["property", "property interest", "address", "listing", "interested property"],
  leadRole: ["lead role", "role", "type"],
  intent: ["intent", "interest", "motivation"],
  budget: ["budget", "price range", "max price", "preapproval", "preapproval amount"],
  area: ["area", "city", "neighborhood", "location", "market"],
  timeline: ["timeline", "timeframe", "move timeline", "buying timeframe", "selling timeframe"],
  preferredChannel: ["preferred channel", "channel", "contact method"],
  smsConsent: ["sms consent", "text consent", "text opt in", "sms opt in"],
  callConsent: ["call consent", "phone consent", "call opt in"],
  whatsappConsent: ["whatsapp consent", "whatsapp opt in"],
  doNotContact: ["dnc", "do not contact", "opt out", "unsubscribed", "unsubscribe"],
  lastActivityAt: ["last activity", "last contacted", "last touch", "updated at", "created at"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function truthyText(value: unknown): boolean {
  return ["1", "true", "yes", "y", "on", "opted out", "unsubscribed", "dnc"].includes(cleanText(value).toLowerCase());
}

function compactTags(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function hasAny(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || record.length) {
    record.push(field);
    rows.push(record);
  }

  const headers = (rows.shift() || []).map((header) => header.trim());
  return {
    headers,
    rows: rows
      .filter((row) => row.some((value) => value.trim()))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]))),
  };
}

function buildHeaderIndex(row: Record<string, unknown>): Map<string, string> {
  const index = new Map<string, string>();
  for (const key of Object.keys(row)) {
    index.set(normalizeHeader(key), key);
  }
  return index;
}

function pick(row: Record<string, unknown>, headerIndex: Map<string, string>, aliases: string[], used: Set<string>): string {
  for (const alias of aliases) {
    const original = headerIndex.get(normalizeHeader(alias));
    if (original) {
      used.add(original);
      return cleanText(row[original]);
    }
  }
  return "";
}

function inferRoleAndIntent(input: {
  explicitRole: string;
  explicitIntent: string;
  tags: string[];
  stage: string;
  notes: string;
  propertyInterest: string;
}): { leadRole: string; intent: string } {
  const text = [input.explicitRole, input.explicitIntent, input.tags.join(" "), input.stage, input.notes, input.propertyInterest].join(" ").toLowerCase();
  const leadRole = input.explicitRole
    || (hasAny(text, /\b(sell|seller|valuation|home value|list my|listing)\b/) ? "seller"
      : hasAny(text, /\b(rent|renter|lease|tenant)\b/) ? "renter"
        : hasAny(text, /\b(buy|buyer|showing|tour|purchase|preapproval|property)\b/) ? "buyer" : "");
  const intent = input.explicitIntent
    || (hasAny(text, /\b(showing|tour|appointment|see it)\b/) ? "showing"
      : hasAny(text, /\b(valuation|home value|sell|listing)\b/) ? "valuation"
        : hasAny(text, /\b(financing|preapproval|mortgage|lender)\b/) ? "financing"
          : hasAny(text, /\b(no reply|closed|lost|dead)\b/) ? "closed_no_reply" : "nurture");
  return { leadRole, intent };
}

export function normalizeLeadImportRow(row: Record<string, unknown>, options: ImportOptions): LeadImportRowResult {
  const headerIndex = buildHeaderIndex(row);
  const used = new Set<string>();
  const firstName = pick(row, headerIndex, FIELD_ALIASES.firstName, used);
  const lastName = pick(row, headerIndex, FIELD_ALIASES.lastName, used);
  const explicitFullName = pick(row, headerIndex, FIELD_ALIASES.fullName, used);
  const fullName = explicitFullName || [firstName, lastName].filter(Boolean).join(" ");
  const tagText = pick(row, headerIndex, FIELD_ALIASES.tags, used);
  const stage = pick(row, headerIndex, FIELD_ALIASES.stage, used);
  const notes = pick(row, headerIndex, FIELD_ALIASES.notes, used);
  const propertyInterest = pick(row, headerIndex, FIELD_ALIASES.propertyInterest, used);
  const explicitRole = pick(row, headerIndex, FIELD_ALIASES.leadRole, used);
  const explicitIntent = pick(row, headerIndex, FIELD_ALIASES.intent, used);
  const tags = compactTags(tagText);
  const { leadRole, intent } = inferRoleAndIntent({ explicitRole, explicitIntent, tags, stage, notes, propertyInterest });

  const normalized: NormalizedLeadImport = {
    email: normalizeEmail(pick(row, headerIndex, FIELD_ALIASES.email, used)),
    phone: normalizePhone(pick(row, headerIndex, FIELD_ALIASES.phone, used)),
    fullName: fullName.trim(),
    firstName,
    lastName,
    sourceType: options.sourceType,
    sourceProvider: options.sourceProvider || "",
    sourceId: pick(row, headerIndex, FIELD_ALIASES.sourceId, used),
    tags,
    stage,
    owner: pick(row, headerIndex, FIELD_ALIASES.owner, used),
    notes,
    propertyInterest,
    leadRole,
    intent,
    budget: pick(row, headerIndex, FIELD_ALIASES.budget, used),
    area: pick(row, headerIndex, FIELD_ALIASES.area, used),
    timeline: pick(row, headerIndex, FIELD_ALIASES.timeline, used),
    preferredChannel: pick(row, headerIndex, FIELD_ALIASES.preferredChannel, used),
    smsConsent: pick(row, headerIndex, FIELD_ALIASES.smsConsent, used),
    callConsent: pick(row, headerIndex, FIELD_ALIASES.callConsent, used),
    whatsappConsent: pick(row, headerIndex, FIELD_ALIASES.whatsappConsent, used),
    doNotContact: truthyText(pick(row, headerIndex, FIELD_ALIASES.doNotContact, used)),
    lastActivityAt: pick(row, headerIndex, FIELD_ALIASES.lastActivityAt, used),
    raw: { ...row },
  };

  const segments = segmentImportedLead(normalized);
  const errors = !normalized.email && !normalized.phone && !normalized.fullName ? ["missing identity"] : [];
  const unmappedColumns = Object.keys(row).filter((key) => cleanText(row[key]) && !used.has(key));
  const campaignEligible = isCampaignEligible(normalized, segments);

  return {
    rowIndex: 0,
    normalized,
    unmappedColumns,
    segments,
    status: errors.length ? "invalid" : "validated",
    errors,
    campaignEligible,
    dedupeKey: dedupeKeyFor(normalized),
  };
}

export function segmentImportedLead(lead: NormalizedLeadImport): LeadImportSegment[] {
  const text = [
    lead.leadRole,
    lead.intent,
    lead.tags.join(" "),
    lead.stage,
    lead.notes,
    lead.propertyInterest,
    lead.budget,
    lead.timeline,
  ].join(" ").toLowerCase();
  const segments = new Set<LeadImportSegment>();

  if (!lead.email && !lead.phone) segments.add("missing_contact_info");
  if (lead.doNotContact || hasAny(text, /\b(do not contact|dnc|opted out|unsubscribe|unsubscribed)\b/)) segments.add("do_not_contact");
  if (lead.leadRole === "seller" || hasAny(text, /\b(sell|seller|valuation|home value|list my|listing)\b/)) segments.add("seller_valuation");
  if (lead.leadRole === "renter" || hasAny(text, /\b(rent|renter|lease|tenant)\b/)) segments.add("renter");
  if (hasAny(text, /\b(showing|tour|appointment|see it|open house)\b/)) segments.add("showing_ready");
  if (hasAny(text, /\b(financing|preapproval|pre-approved|mortgage|lender|loan)\b/) || Boolean(lead.budget)) segments.add("financing");
  if (hasAny(text, /\b(hot|urgent|asap|ready now|this week|today|tomorrow|soon|30 days)\b/)) segments.add("hot_buyer");
  if (hasAny(text, /\b(needs human|human|complaint|angry|legal|attorney|escalate)\b/)) segments.add("needs_human");
  if (hasAny(text, /\b(closed|lost|dead|no reply|unresponsive|not interested)\b/)) segments.add("closed_no_reply");
  if (!segments.size) segments.add("nurture");

  return [...segments];
}

export function isCampaignEligible(lead: NormalizedLeadImport, segments = segmentImportedLead(lead)): boolean {
  if (!lead.email && !lead.phone) return false;
  if (lead.doNotContact) return false;
  return !segments.some((segment) => ["missing_contact_info", "do_not_contact", "needs_human"].includes(segment));
}

export function dedupeKeyFor(lead: NormalizedLeadImport): string {
  if (lead.email) return `email:${lead.email}`;
  if (lead.phone) return `phone:${lead.phone}`;
  if (lead.sourceProvider && lead.sourceId) return `source:${lead.sourceProvider}:${lead.sourceId}`;
  const name = normalizeName(lead.fullName);
  return name ? `name:${name}` : "";
}

function scoreFor(segments: LeadImportSegment[]): number {
  if (segments.includes("do_not_contact") || segments.includes("missing_contact_info")) return 0;
  if (segments.includes("hot_buyer")) return 80;
  if (segments.includes("showing_ready")) return 70;
  if (segments.includes("seller_valuation")) return 65;
  if (segments.includes("financing")) return 55;
  if (segments.includes("needs_human")) return 20;
  return 30;
}

export function toLeadMemoryRow(lead: NormalizedLeadImport, segments = segmentImportedLead(lead)): Partial<SheetRow> {
  const sourceBits = [lead.sourceProvider || lead.sourceType, lead.sourceId, lead.stage].filter(Boolean);
  const nextAction = segments.includes("do_not_contact")
    ? "do_not_contact"
    : segments.includes("needs_human")
      ? "needs_human_review"
      : "review_reactivation_candidate";
  return {
    email: lead.email,
    phone: lead.phone,
    full_name: lead.fullName,
    lead_source: lead.sourceProvider || lead.sourceType,
    source_detail: sourceBits.join(" | "),
    lead_role: lead.leadRole,
    intent: lead.intent,
    property_interest: lead.propertyInterest,
    budget: lead.budget,
    area: lead.area,
    timeline: lead.timeline,
    preferred_channel: lead.preferredChannel,
    sms_consent: lead.smsConsent,
    call_consent: lead.callConsent,
    whatsapp_consent: lead.whatsappConsent,
    assigned_owner: lead.owner,
    handoff_status: segments.includes("needs_human") ? "needs_human" : "",
    next_action: nextAction,
    summary: [lead.notes, `Imported from ${lead.sourceProvider || lead.sourceType}. Segments: ${segments.join(", ")}`].filter(Boolean).join("\n"),
    lead_score: String(scoreFor(segments)),
    do_not_contact: lead.doNotContact ? "true" : "",
  };
}

export function buildImportPreview(rows: Record<string, unknown>[], options: ImportOptions): { results: LeadImportRowResult[]; summary: LeadImportSummary } {
  const seen = new Set<string>();
  const results = rows.map((row, index) => {
    const result = normalizeLeadImportRow(row, options);
    result.rowIndex = index + 1;
    if (result.dedupeKey && seen.has(result.dedupeKey)) {
      result.status = "duplicate";
      result.segments = [...new Set([...result.segments, "duplicate_merged" as LeadImportSegment])];
    }
    if (result.dedupeKey) seen.add(result.dedupeKey);
    return result;
  });
  return { results, summary: summarizeResults("", options, results) };
}

function summarizeResults(batchId: string, options: ImportOptions, results: LeadImportRowResult[]): LeadImportSummary {
  const segmentCounts: Record<string, number> = {};
  const unmappedColumns = new Set<string>();
  for (const result of results) {
    result.segments.forEach((segment) => {
      segmentCounts[segment] = (segmentCounts[segment] || 0) + 1;
    });
    result.unmappedColumns.forEach((column) => unmappedColumns.add(column));
  }
  return {
    batchId,
    sourceType: options.sourceType,
    sourceProvider: options.sourceProvider || "",
    totalRows: results.length,
    importedLeads: results.filter((result) => result.status === "imported").length,
    mergedDuplicates: results.filter((result) => result.status === "merged").length,
    duplicateRows: results.filter((result) => result.status === "duplicate").length,
    invalidRows: results.filter((result) => result.status === "invalid").length,
    missingContactInfo: results.filter((result) => result.segments.includes("missing_contact_info")).length,
    campaignEligible: results.filter((result) => result.campaignEligible).length,
    segmentCounts,
    unmappedColumns: [...unmappedColumns].sort(),
  };
}

function leadMemoryKey(row: Partial<SheetRow>): string {
  return [row.email || "", row.phone || "", row.full_name || ""].join("|");
}

export async function runLeadImport(rows: Record<string, unknown>[], options: ImportOptions): Promise<{ summary: LeadImportSummary; results: LeadImportRowResult[] }> {
  const batchId = crypto.randomUUID();
  const preview = buildImportPreview(rows, options);
  const results = preview.results;
  const shouldPersist = !options.dryRun && databaseEnabled();
  if (!shouldPersist) {
    return { results, summary: { ...preview.summary, batchId: "" } };
  }

  await createLeadImportBatchInDatabase({
    id: batchId,
    sourceType: options.sourceType,
    sourceName: options.sourceName,
    sourceProvider: options.sourceProvider,
    filename: options.filename,
    totalRows: rows.length,
    metadata: { ...(options.metadata || {}), auto_message: false },
  });

  for (const result of results) {
    const leadRow = toLeadMemoryRow(result.normalized, result.segments);
    if (result.status === "invalid" || result.status === "duplicate") {
      await appendLeadImportItemToDatabase({
        batchId,
        rowIndex: result.rowIndex,
        status: result.status,
        dedupeKey: result.dedupeKey,
        email: result.normalized.email,
        phone: result.normalized.phone,
        fullName: result.normalized.fullName,
        sourceId: result.normalized.sourceId,
        segments: result.segments,
        campaignEligible: result.campaignEligible,
        rawData: result.normalized.raw,
        normalizedData: result.normalized as unknown as Record<string, unknown>,
        error: result.errors.join("; "),
      });
      continue;
    }
    const existing = await findLeadInDatabase(leadRow);
    const saved = await upsertLeadMemoryToDatabase(leadRow);
    result.status = existing ? "merged" : "imported";
    if (existing) {
      result.segments = [...new Set([...result.segments, "duplicate_merged" as LeadImportSegment])];
    }
    await appendLeadImportItemToDatabase({
      batchId,
      rowIndex: result.rowIndex,
      status: result.status,
      dedupeKey: result.dedupeKey,
      email: result.normalized.email,
      phone: result.normalized.phone,
      fullName: result.normalized.fullName,
      sourceId: result.normalized.sourceId,
      segments: result.segments,
      campaignEligible: result.campaignEligible,
      leadMemoryKey: leadMemoryKey(saved),
      rawData: result.normalized.raw,
      normalizedData: result.normalized as unknown as Record<string, unknown>,
    });
  }

  const summary = summarizeResults(batchId, options, results);
  await updateLeadImportBatchInDatabase({
    id: batchId,
    status: "segmented",
    importedCount: summary.importedLeads,
    mergedCount: summary.mergedDuplicates,
    duplicateCount: summary.duplicateRows,
    invalidCount: summary.invalidRows,
    missingContactCount: summary.missingContactInfo,
    campaignEligibleCount: summary.campaignEligible,
    segmentCounts: summary.segmentCounts,
    unmappedColumns: summary.unmappedColumns,
    metadata: { completed_at: new Date().toISOString(), auto_message: false },
  });
  return { results, summary };
}
