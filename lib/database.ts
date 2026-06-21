import { Pool } from "pg";

import {
  CONVERSATION_EVENTS_HEADERS,
  LEAD_MEMORY_HEADERS,
  PROPERTIES_HEADERS,
  type SheetRow,
} from "@/lib/sheetSchema";
import {
  DEFAULT_INBOX_CATEGORIES,
  DEFAULT_INBOX_SETTINGS,
  normalizeInboxCategory,
  normalizeInboxSettings,
  type AiDraft,
  type InboxCategory,
  type InboxSettings,
} from "@/lib/inboxSettings";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { mergeNonEmpty, normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadIdentity";
import {
  AUSTIN_NEIGHBORHOODS,
  CENTRAL_TEXAS_ALIASES,
  CENTRAL_TEXAS_CITIES,
} from "@/lib/serviceAreas";

let pool: Pool | null = null;
const tableColumnCache = new Map<string, Set<string>>();

export type PropertySearchCriteria = {
  query?: string;
  area?: string;
  beds?: string | number;
  baths?: string | number;
  minPrice?: string | number;
  maxPrice?: string | number;
  mode?: "general" | "similar" | "neighboring";
  reference?: Partial<SheetRow>;
  excludeAddresses?: string[];
};

const GREATER_AUSTIN_CITIES = CENTRAL_TEXAS_CITIES;
const AREA_ALIASES: Record<string, string[]> = CENTRAL_TEXAS_ALIASES;

export function databaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function clientId(): string {
  return process.env.CLIENT_ID || "default";
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for database reads");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function tableColumns(tableName: string): Promise<Set<string>> {
  const cached = tableColumnCache.get(tableName);
  if (cached) return cached;
  const result = await getPool().query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1`,
    [tableName],
  );
  const columns = new Set(result.rows.map((row) => String(row.column_name)));
  tableColumnCache.set(tableName, columns);
  return columns;
}

async function selectHeaders(tableName: string, headers: readonly string[]): Promise<string> {
  const columns = await tableColumns(tableName);
  return headers
    .map((header) => columns.has(header) ? header : `'' as ${header}`)
    .join(", ");
}

function clientName(): string {
  return process.env.CLIENT_NAME || clientId();
}

function cleanRow(headers: readonly string[], row: Partial<SheetRow>): SheetRow {
  return Object.fromEntries(headers.map((header) => [header, row[header] || ""])) as SheetRow;
}

function rowToStrings(headers: readonly string[], row: Record<string, unknown>): SheetRow {
  return Object.fromEntries(headers.map((header) => [header, row[header] == null ? "" : String(row[header])]));
}

function intDbValue(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function nullableIntDbValue(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function boolDbValue(value: unknown): boolean {
  return ["1", "true", "yes", "on", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function leadMemoryDbValue(header: string, value: unknown): unknown {
  if (header === "lead_score" || header === "appointment_count") return intDbValue(value);
  if (header === "do_not_contact") return boolDbValue(value);
  return value ?? "";
}

function eventDbValue(header: string, value: unknown): unknown {
  if (header === "call_duration_seconds") return nullableIntDbValue(value);
  return value ?? "";
}

export async function ensureClientInDatabase(): Promise<void> {
  await getPool().query(
    `insert into clients (id, name)
     values ($1, $2)
     on conflict (id) do update set
       name = excluded.name,
       updated_at = now()`,
    [clientId(), clientName()],
  );
}

export async function readPropertiesFromDatabase(): Promise<SheetRow[]> {
  const columns = await selectHeaders("properties", PROPERTIES_HEADERS);
  const result = await getPool().query(
    `select ${columns}
       from properties
      where client_id = $1
      order by updated_at desc, address asc`,
    [clientId()],
  );
  return result.rows.map((row) => rowToStrings(PROPERTIES_HEADERS, row));
}

export async function readLeadsFromDatabase(): Promise<SheetRow[]> {
  const columns = await selectHeaders("lead_memory", LEAD_MEMORY_HEADERS);
  const result = await getPool().query(
    `select ${columns}
       from lead_memory
      where client_id = $1
      order by updated_at desc`,
    [clientId()],
  );
  return result.rows.map((row) => rowToStrings(LEAD_MEMORY_HEADERS, row));
}

export async function readEventsFromDatabase(): Promise<SheetRow[]> {
  const columns = await selectHeaders("conversation_events", CONVERSATION_EVENTS_HEADERS);
  const result = await getPool().query(
    `select ${columns}
       from conversation_events
      where client_id = $1
      order by id asc`,
    [clientId()],
  );
  return result.rows.map((row) => rowToStrings(CONVERSATION_EVENTS_HEADERS, row));
}

const VOICE_CALL_HEADERS = [
  "call_id",
  "thread_ref",
  "direction",
  "email",
  "phone",
  "full_name",
  "lead_role",
  "agent_name",
  "started_at",
  "ended_at",
  "duration_sec",
  "disposition",
  "summary",
  "transcript",
  "recording_url",
  "ended_reason",
  "human_owner",
  "created_at",
] as const;

export async function readVoiceCallsFromDatabase(): Promise<SheetRow[]> {
  const columns = await selectHeaders("voice_calls", VOICE_CALL_HEADERS);
  const result = await getPool().query(
    `select ${columns}
       from voice_calls
      where client_id = $1
      order by coalesce(
        nullif(ended_at, '')::timestamptz,
        nullif(started_at, '')::timestamptz,
        created_at
      ) desc`,
    [clientId()],
  );
  return result.rows.map((row) => rowToStrings(VOICE_CALL_HEADERS, row));
}

export type EmailAccountRecord = {
  id: string;
  client_id: string;
  provider: string;
  email: string;
  display_name: string;
  token_json_encrypted: string;
  scopes: string[];
  is_default: boolean;
  status: string;
  connected_by: string;
  last_error: string;
  last_used_at: string;
  created_at: string;
  updated_at: string;
};

export type ThreadLinkRecord = {
  thread_ref: string;
  channel: string;
  mailbox_email: string;
  gmail_thread_id: string;
  gmail_message_id: string;
  thread_status: string;
  updated_at: string;
};

function emailAccountFromRow(row: Record<string, unknown>): EmailAccountRecord {
  return {
    id: String(row.id || ""),
    client_id: String(row.client_id || ""),
    provider: String(row.provider || "gmail"),
    email: String(row.email || ""),
    display_name: String(row.display_name || ""),
    token_json_encrypted: String(row.token_json_encrypted || ""),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    is_default: Boolean(row.is_default),
    status: String(row.status || ""),
    connected_by: String(row.connected_by || ""),
    last_error: String(row.last_error || ""),
    last_used_at: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : "",
    created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : "",
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : "",
  };
}

async function emailAccountsTableReady(): Promise<boolean> {
  return (await tableColumns("email_accounts")).has("token_json_encrypted");
}

async function tableReady(tableName: string, requiredColumn = "client_id"): Promise<boolean> {
  return (await tableColumns(tableName)).has(requiredColumn);
}

export async function readEmailAccountsFromDatabase(): Promise<EmailAccountRecord[]> {
  if (!await emailAccountsTableReady()) return [];
  const result = await getPool().query(
    `select id, client_id, provider, email, display_name, token_json_encrypted, scopes,
            is_default, status, connected_by, last_error, last_used_at, created_at, updated_at
       from email_accounts
      where client_id = $1
      order by is_default desc, updated_at desc`,
    [clientId()],
  );
  return result.rows.map(emailAccountFromRow);
}

export async function readDefaultEmailAccountFromDatabase(): Promise<EmailAccountRecord | null> {
  if (!await emailAccountsTableReady()) return null;
  const result = await getPool().query(
    `select id, client_id, provider, email, display_name, token_json_encrypted, scopes,
            is_default, status, connected_by, last_error, last_used_at, created_at, updated_at
       from email_accounts
      where client_id = $1
        and provider = 'gmail'
        and is_default = true
        and status = 'connected'
      order by updated_at desc
      limit 1`,
    [clientId()],
  );
  return result.rows[0] ? emailAccountFromRow(result.rows[0]) : null;
}

export async function upsertEmailAccountInDatabase(input: {
  email: string;
  displayName?: string;
  tokenJsonEncrypted: string;
  scopes?: string[];
  connectedBy?: string;
}): Promise<EmailAccountRecord> {
  await ensureClientInDatabase();
  if (!input.email.trim()) throw new Error("Gmail account email is required");
  await getPool().query(
    `update email_accounts
        set is_default = false,
            updated_at = now()
      where client_id = $1
        and provider = 'gmail'`,
    [clientId()],
  );
  const result = await getPool().query(
    `insert into email_accounts (
        client_id, provider, email, display_name, token_json_encrypted, scopes,
        is_default, status, connected_by, last_error
      ) values (
        $1, 'gmail', $2, $3, $4, $5, true, 'connected', $6, ''
      )
      on conflict (client_id, provider, email) do update set
        display_name = excluded.display_name,
        token_json_encrypted = excluded.token_json_encrypted,
        scopes = excluded.scopes,
        is_default = true,
        status = 'connected',
        connected_by = excluded.connected_by,
        last_error = '',
        updated_at = now()
      returning id, client_id, provider, email, display_name, token_json_encrypted, scopes,
                is_default, status, connected_by, last_error, last_used_at, created_at, updated_at`,
    [
      clientId(),
      input.email.trim().toLowerCase(),
      input.displayName || "",
      input.tokenJsonEncrypted,
      input.scopes || [],
      input.connectedBy || "",
    ],
  );
  return emailAccountFromRow(result.rows[0]);
}

export async function updateEmailAccountTokenInDatabase(email: string, tokenJsonEncrypted: string): Promise<void> {
  if (!email.trim()) return;
  await getPool().query(
    `update email_accounts
        set token_json_encrypted = $2,
            status = 'connected',
            last_error = '',
            last_used_at = now(),
            updated_at = now()
      where client_id = $1
        and provider = 'gmail'
        and email = $3`,
    [clientId(), tokenJsonEncrypted, email.trim().toLowerCase()],
  );
}

export async function markEmailAccountErrorInDatabase(email: string, error: string): Promise<void> {
  if (!email.trim() || !await emailAccountsTableReady()) return;
  await getPool().query(
    `update email_accounts
        set status = 'error',
            last_error = $2,
            updated_at = now()
      where client_id = $1
        and provider = 'gmail'
        and email = $3`,
    [clientId(), error.slice(0, 500), email.trim().toLowerCase()],
  );
}

function inboxCategoryFromRow(row: Record<string, unknown>): InboxCategory {
  return normalizeInboxCategory({
    slug: String(row.slug || ""),
    name: String(row.name || ""),
    color: String(row.color || ""),
    sort_order: Number(row.sort_order || 0),
    enabled: Boolean(row.enabled),
    gmail_label_id: String(row.gmail_label_id || ""),
    gmail_label_name: String(row.gmail_label_name || ""),
    auto_rules: row.auto_rules && typeof row.auto_rules === "object" ? row.auto_rules as Record<string, unknown> : {},
  });
}

function aiDraftFromRow(row: Record<string, unknown>): AiDraft {
  return {
    thread_ref: String(row.thread_ref || ""),
    channel: String(row.channel || ""),
    body: String(row.body || ""),
    category_slug: String(row.category_slug || ""),
    confidence: Number(row.confidence || 0),
    reason: String(row.reason || ""),
    next_action: String(row.next_action || ""),
    safe_to_auto_send: Boolean(row.safe_to_auto_send),
    needs_human: Boolean(row.needs_human),
    model: String(row.model || ""),
    status: String(row.status || ""),
    fingerprint: String(row.fingerprint || ""),
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : "",
  };
}

export async function ensureInboxDefaultsInDatabase(): Promise<void> {
  if (!await tableReady("inbox_settings")) return;
  await ensureClientInDatabase();
  await getPool().query(
    `insert into inbox_settings (client_id)
     values ($1)
     on conflict (client_id) do nothing`,
    [clientId()],
  );
  if (!await tableReady("inbox_categories")) return;
  for (const category of DEFAULT_INBOX_CATEGORIES) {
    await getPool().query(
      `insert into inbox_categories (
          client_id, slug, name, color, sort_order, enabled, gmail_label_name, auto_rules
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        on conflict (client_id, slug) do nothing`,
      [
        clientId(),
        category.slug,
        category.name,
        category.color,
        category.sort_order,
        category.enabled,
        category.gmail_label_name,
        JSON.stringify(category.auto_rules),
      ],
    );
  }
}

export async function readInboxSettingsFromDatabase(): Promise<InboxSettings> {
  if (!await tableReady("inbox_settings")) return DEFAULT_INBOX_SETTINGS;
  await ensureInboxDefaultsInDatabase();
  const result = await getPool().query(
    `select draft_first, auto_send_email, auto_send_sms, auto_send_whatsapp,
            auto_send_messenger, auto_send_instagram, auto_send_website_chat,
            channels_enabled, cache_status
       from inbox_settings
      where client_id = $1
      limit 1`,
    [clientId()],
  );
  const row = result.rows[0];
  if (!row) return DEFAULT_INBOX_SETTINGS;
  return normalizeInboxSettings({
    draft_first: Boolean(row.draft_first),
    auto_send: {
      email: Boolean(row.auto_send_email),
      sms: Boolean(row.auto_send_sms),
      whatsapp: Boolean(row.auto_send_whatsapp),
      messenger: Boolean(row.auto_send_messenger),
      instagram: Boolean(row.auto_send_instagram),
      website_chat: Boolean(row.auto_send_website_chat),
    },
    channels_enabled: row.channels_enabled || {},
    cache_status: row.cache_status || {},
  });
}

export async function upsertInboxSettingsInDatabase(settings: Partial<InboxSettings>): Promise<InboxSettings> {
  if (!await tableReady("inbox_settings")) return normalizeInboxSettings(settings);
  await ensureInboxDefaultsInDatabase();
  const normalized = normalizeInboxSettings(settings);
  await getPool().query(
    `insert into inbox_settings (
        client_id, draft_first, auto_send_email, auto_send_sms, auto_send_whatsapp,
        auto_send_messenger, auto_send_instagram, auto_send_website_chat,
        channels_enabled, cache_status
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
      on conflict (client_id) do update set
        draft_first = excluded.draft_first,
        auto_send_email = excluded.auto_send_email,
        auto_send_sms = excluded.auto_send_sms,
        auto_send_whatsapp = excluded.auto_send_whatsapp,
        auto_send_messenger = excluded.auto_send_messenger,
        auto_send_instagram = excluded.auto_send_instagram,
        auto_send_website_chat = excluded.auto_send_website_chat,
        channels_enabled = excluded.channels_enabled,
        cache_status = excluded.cache_status,
        updated_at = now()`,
    [
      clientId(),
      normalized.draft_first,
      normalized.auto_send.email,
      normalized.auto_send.sms,
      normalized.auto_send.whatsapp,
      normalized.auto_send.messenger,
      normalized.auto_send.instagram,
      normalized.auto_send.website_chat,
      JSON.stringify(normalized.channels_enabled),
      JSON.stringify(normalized.cache_status),
    ],
  );
  return normalized;
}

export async function readInboxCategoriesFromDatabase(): Promise<InboxCategory[]> {
  if (!await tableReady("inbox_categories")) return DEFAULT_INBOX_CATEGORIES;
  await ensureInboxDefaultsInDatabase();
  const result = await getPool().query(
    `select slug, name, color, sort_order, enabled, gmail_label_id, gmail_label_name, auto_rules
       from inbox_categories
      where client_id = $1
      order by sort_order asc, name asc`,
    [clientId()],
  );
  return result.rows.length ? result.rows.map(inboxCategoryFromRow) : DEFAULT_INBOX_CATEGORIES;
}

export async function upsertInboxCategoriesInDatabase(categories: Partial<InboxCategory>[]): Promise<InboxCategory[]> {
  if (!await tableReady("inbox_categories")) return categories.map((category, index) => normalizeInboxCategory(category, DEFAULT_INBOX_CATEGORIES[index]));
  await ensureInboxDefaultsInDatabase();
  for (const [index, input] of categories.entries()) {
    const category = normalizeInboxCategory(input, DEFAULT_INBOX_CATEGORIES[index]);
    await getPool().query(
      `insert into inbox_categories (
          client_id, slug, name, color, sort_order, enabled, gmail_label_id, gmail_label_name, auto_rules
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        on conflict (client_id, slug) do update set
          name = excluded.name,
          color = excluded.color,
          sort_order = excluded.sort_order,
          enabled = excluded.enabled,
          gmail_label_id = excluded.gmail_label_id,
          gmail_label_name = excluded.gmail_label_name,
          auto_rules = excluded.auto_rules,
          updated_at = now()`,
      [
        clientId(),
        category.slug,
        category.name,
        category.color,
        category.sort_order,
        category.enabled,
        category.gmail_label_id,
        category.gmail_label_name,
        JSON.stringify(category.auto_rules),
      ],
    );
  }
  return readInboxCategoriesFromDatabase();
}

export async function readActiveAiDraftsFromDatabase(): Promise<Record<string, AiDraft>> {
  if (!await tableReady("ai_drafts")) return {};
  const result = await getPool().query(
    `select thread_ref, channel, body, category_slug, confidence, reason, next_action,
            safe_to_auto_send, needs_human, model, status, fingerprint, updated_at
       from ai_drafts
      where client_id = $1
        and status = 'draft'
      order by updated_at desc`,
    [clientId()],
  );
  return Object.fromEntries(result.rows.map((row) => {
    const draft = aiDraftFromRow(row);
    return [`${draft.channel}:${draft.thread_ref}`, draft];
  }));
}

export async function readAiDraftFromDatabase(input: { threadRef: string; channel: string }): Promise<AiDraft | null> {
  if (!await tableReady("ai_drafts")) return null;
  const result = await getPool().query(
    `select thread_ref, channel, body, category_slug, confidence, reason, next_action,
            safe_to_auto_send, needs_human, model, status, fingerprint, updated_at
       from ai_drafts
      where client_id = $1
        and thread_ref = $2
        and channel = $3
        and status = 'draft'
      order by updated_at desc
      limit 1`,
    [clientId(), input.threadRef, input.channel],
  );
  return result.rows[0] ? aiDraftFromRow(result.rows[0]) : null;
}

export async function upsertAiDraftInDatabase(input: Omit<AiDraft, "updated_at" | "status"> & { status?: string }): Promise<AiDraft> {
  if (!await tableReady("ai_drafts")) {
    return { ...input, status: input.status || "draft", updated_at: new Date().toISOString() };
  }
  await ensureClientInDatabase();
  const result = await getPool().query(
    `insert into ai_drafts (
        client_id, thread_ref, channel, body, category_slug, confidence, reason,
        next_action, safe_to_auto_send, needs_human, model, status, fingerprint
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      on conflict (client_id, thread_ref, channel) where status = 'draft'
      do update set
        body = excluded.body,
        category_slug = excluded.category_slug,
        confidence = excluded.confidence,
        reason = excluded.reason,
        next_action = excluded.next_action,
        safe_to_auto_send = excluded.safe_to_auto_send,
        needs_human = excluded.needs_human,
        model = excluded.model,
        fingerprint = excluded.fingerprint,
        updated_at = now()
      returning thread_ref, channel, body, category_slug, confidence, reason, next_action,
                safe_to_auto_send, needs_human, model, status, fingerprint, updated_at`,
    [
      clientId(),
      input.thread_ref,
      input.channel,
      input.body,
      input.category_slug,
      input.confidence,
      input.reason,
      input.next_action,
      input.safe_to_auto_send,
      input.needs_human,
      input.model,
      input.status || "draft",
      input.fingerprint,
    ],
  );
  return aiDraftFromRow(result.rows[0]);
}

export async function updateAiDraftStatusInDatabase(input: {
  threadRef: string;
  channel: string;
  status: "sent" | "dismissed" | "archived";
}): Promise<void> {
  if (!await tableReady("ai_drafts")) return;
  await getPool().query(
    `update ai_drafts
        set status = $4,
            updated_at = now()
      where client_id = $1
        and thread_ref = $2
        and channel = $3
        and status = 'draft'`,
    [clientId(), input.threadRef, input.channel, input.status],
  );
}

export async function upsertThreadLinkInDatabase(input: {
  threadRef: string;
  channel: string;
  mailboxEmail?: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
  threadStatus?: string;
}): Promise<void> {
  if (!await tableReady("thread_links")) return;
  await ensureClientInDatabase();
  await getPool().query(
    `insert into thread_links (
        client_id, thread_ref, channel, mailbox_email, gmail_thread_id,
        gmail_message_id, thread_status
      ) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (client_id, thread_ref, channel) do update set
        mailbox_email = coalesce(nullif(excluded.mailbox_email, ''), thread_links.mailbox_email),
        gmail_thread_id = coalesce(nullif(excluded.gmail_thread_id, ''), thread_links.gmail_thread_id),
        gmail_message_id = coalesce(nullif(excluded.gmail_message_id, ''), thread_links.gmail_message_id),
        thread_status = coalesce(nullif(excluded.thread_status, ''), thread_links.thread_status),
        updated_at = now()`,
    [
      clientId(),
      input.threadRef,
      input.channel,
      input.mailboxEmail || "",
      input.gmailThreadId || "",
      input.gmailMessageId || "",
      input.threadStatus || "",
    ],
  );
}

export async function readEventsForThreadFromDatabase(threadRef: string, limit = 12): Promise<SheetRow[]> {
  const columns = await selectHeaders("conversation_events", CONVERSATION_EVENTS_HEADERS);
  const result = await getPool().query(
    `select ${columns}
       from conversation_events
      where client_id = $1
        and thread_ref = $2
      order by id desc
      limit $3`,
    [clientId(), threadRef, limit],
  );
  return result.rows.reverse().map((row) => rowToStrings(CONVERSATION_EVENTS_HEADERS, row));
}

export async function hasNewerInboundForThreadInDatabase(threadRef: string, eventAt: string): Promise<boolean> {
  const result = await getPool().query(
    `with current_event as (
       select created_at
         from conversation_events
        where client_id = $1
          and thread_ref = $2
          and event_at = $3
          and direction = 'inbound'
        order by id desc
        limit 1
     )
     select exists (
       select 1
         from conversation_events ce, current_event
        where ce.client_id = $1
          and ce.thread_ref = $2
          and ce.direction = 'inbound'
          and ce.created_at > current_event.created_at
     ) as has_newer`,
    [clientId(), threadRef, eventAt],
  );
  return Boolean(result.rows[0]?.has_newer);
}

// Cross-channel history for one lead, matched by phone and/or email (not thread).
// Used by identity resolution so a caller's prior email/SMS/voice events surface.
export async function readEventsForLeadFromDatabase(
  lead: { phone?: string; email?: string },
  limit = 20,
): Promise<SheetRow[]> {
  const phone = normalizePhone(lead.phone);
  const email = normalizeEmail(lead.email);
  if (!phone && !email) return [];
  const columns = await selectHeaders("conversation_events", CONVERSATION_EVENTS_HEADERS);
  const result = await getPool().query(
    `select ${columns}
       from conversation_events
      where client_id = $1
        and (
          ($2 <> '' and (
            regexp_replace(phone, '\\D', '', 'g') = $2
            or (
              length(regexp_replace(phone, '\\D', '', 'g')) = 10
              and concat('1', regexp_replace(phone, '\\D', '', 'g')) = $2
            )
          ))
          or ($3 <> '' and lower(email) = $3)
        )
      order by id desc
      limit $4`,
    [clientId(), phone, email, limit],
  );
  return result.rows.reverse().map((row) => rowToStrings(CONVERSATION_EVENTS_HEADERS, row));
}

async function findMatchingLead(incoming: SheetRow): Promise<SheetRow | null> {
  const phone = normalizePhone(incoming.phone);
  const email = normalizeEmail(incoming.email);
  const fullName = normalizeName(incoming.full_name);
  if (!phone && !email && !fullName) {
    return null;
  }

  const columns = await selectHeaders("lead_memory", LEAD_MEMORY_HEADERS);
  const result = await getPool().query(
    `select ${columns}
       from lead_memory
      where client_id = $1
        and (
          ($2 <> '' and (
            regexp_replace(phone, '\\D', '', 'g') = $2
            or (
              length(regexp_replace(phone, '\\D', '', 'g')) = 10
              and concat('1', regexp_replace(phone, '\\D', '', 'g')) = $2
            )
          ))
          or ($3 <> '' and lower(email) = $3)
          or ($4 <> '' and lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) = $4)
        )
      order by updated_at desc
      limit 1`,
    [clientId(), phone, email, fullName],
  );
  return result.rows[0] ? rowToStrings(LEAD_MEMORY_HEADERS, result.rows[0]) : null;
}

export async function findLeadInDatabase(incoming: Partial<SheetRow>): Promise<SheetRow | null> {
  return findMatchingLead(cleanRow(LEAD_MEMORY_HEADERS, incoming));
}

function normalizeSearchText(value?: string | number): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\btexas\b/g, "tx")
    .replace(/\s+/g, " ");
}

function numericValue(value?: string | number): number | null {
  const text = String(value ?? "").toLowerCase().replace(/,/g, "").trim();
  if (!text) return null;
  const match = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?/i);
  if (!match) return null;
  let amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const suffix = match[2] || "";
  if (/^m|million/.test(suffix)) amount *= 1_000_000;
  if (/^k|thousand/.test(suffix)) amount *= 1_000;
  return amount;
}

function criteriaFromQuery(query: string | PropertySearchCriteria = ""): PropertySearchCriteria {
  if (typeof query !== "string") return query;
  return { query, area: query, mode: "general" };
}

function areaTerms(criteria: PropertySearchCriteria): string[] {
  const text = normalizeSearchText([criteria.area, criteria.query].filter(Boolean).join(" "));
  const aliasTerms = new Set<string>();
  const neighborhoodTerms = new Set<string>();
  const cityTerms = new Set<string>();
  for (const [alias, values] of Object.entries(AREA_ALIASES)) {
    if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
      values.forEach((value) => aliasTerms.add(value));
    }
  }
  for (const city of GREATER_AUSTIN_CITIES) {
    if (new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) cityTerms.add(city);
  }
  for (const neighborhood of AUSTIN_NEIGHBORHOODS) {
    if (new RegExp(`\\b${neighborhood.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) neighborhoodTerms.add(neighborhood);
  }
  if (aliasTerms.size) return [...aliasTerms];
  if (neighborhoodTerms.size) return [...neighborhoodTerms];
  return [...cityTerms];
}

function propertyHaystack(property: SheetRow): string {
  return normalizeSearchText([
    property.address,
    property.city,
    property.zip,
    property.neighborhood,
    property.property_type,
    property.features,
    property.description,
  ].filter(Boolean).join(" "));
}

function textTokens(criteria: PropertySearchCriteria): string[] {
  const text = normalizeSearchText(criteria.query || criteria.area || "");
  return text
    .replace(/\b(show|send|find|give|me|more|other|similar|neighboring|nearby|properties|property|homes|home|listings|listing|spec|same|around|area|available|can|photos|photo|pictures|picture|too|least|month|monthly|in|the|a|an|to|of|with|under|over)\b/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !/^\d+$/.test(token));
}

function wantsRental(criteria: PropertySearchCriteria): boolean {
  const text = normalizeSearchText([criteria.query, criteria.area].filter(Boolean).join(" "));
  const maxPrice = numericValue(criteria.maxPrice);
  return /\b(apartment|apartments|apt|apts|condo|condos|rent|rental|lease|leasing|per month|a month|monthly|mo)\b/i.test(text)
    || (maxPrice != null && maxPrice <= 20000);
}

function propertyLooksRental(property: SheetRow): boolean {
  const text = normalizeSearchText([
    property.price,
    property.property_type,
    property.status,
    property.listing_url,
    property.description,
  ].filter(Boolean).join(" "));
  return /\b(per month|month|monthly|rent|rental|lease|leasing|apartment|apartments|apt|condo|condos)\b/i.test(text)
    || /\/apartments\//i.test(property.listing_url || "");
}

function hasHardStructuredCriteria(criteria: PropertySearchCriteria): boolean {
  return numericValue(criteria.beds) != null
    || numericValue(criteria.baths) != null
    || numericValue(criteria.minPrice) != null
    || numericValue(criteria.maxPrice) != null
    || wantsRental(criteria);
}

function matchesArea(property: SheetRow, terms: string[]): boolean {
  if (!terms.length) return true;
  const haystack = propertyHaystack(property);
  return terms.some((term) => haystack.includes(normalizeSearchText(term)));
}

function referenceRange(criteria: PropertySearchCriteria, key: "price" | "beds" | "baths"): [number | null, number | null] {
  const referenceValue = numericValue(criteria.reference?.[key]);
  if (!referenceValue || criteria.mode === "general") return [null, null];
  if (key === "price") return [Math.max(0, referenceValue * 0.75), referenceValue * 1.25];
  if (key === "beds") return [Math.max(0, referenceValue - 1), referenceValue + 1];
  return [Math.max(0, referenceValue - 1), referenceValue + 1];
}

function propertyMatchesCriteria(property: SheetRow, criteria: PropertySearchCriteria): boolean {
  const excluded = new Set((criteria.excludeAddresses || []).map((address) => normalizeSearchText(address)));
  if (excluded.has(normalizeSearchText(property.address))) return false;
  if (wantsRental(criteria) && !propertyLooksRental(property)) return false;

  const terms = areaTerms(criteria);
  if (!matchesArea(property, terms)) return false;

  const tokens = textTokens(criteria);
  const haystack = propertyHaystack(property);

  const beds = numericValue(property.beds);
  const baths = numericValue(property.baths);
  const price = numericValue(property.price);
  const requestedBeds = numericValue(criteria.beds);
  const requestedBaths = numericValue(criteria.baths);
  const explicitMinPrice = numericValue(criteria.minPrice);
  const explicitMaxPrice = numericValue(criteria.maxPrice);
  const [referenceMinPrice, referenceMaxPrice] = referenceRange(criteria, "price");
  const [referenceMinBeds, referenceMaxBeds] = referenceRange(criteria, "beds");
  const [referenceMinBaths, referenceMaxBaths] = referenceRange(criteria, "baths");
  const minPrice = explicitMinPrice ?? referenceMinPrice;
  const maxPrice = explicitMaxPrice ?? referenceMaxPrice;
  const hasStructuredCriteria = requestedBeds != null
    || requestedBaths != null
    || minPrice != null
    || maxPrice != null
    || Boolean(criteria.reference?.address)
    || criteria.mode === "similar"
    || criteria.mode === "neighboring";
  if (!terms.length && tokens.length && !hasStructuredCriteria && !tokens.some((token) => haystack.includes(token))) return false;

  if (requestedBeds != null && beds != null && beds < requestedBeds) return false;
  if (requestedBeds != null && beds == null) return false;
  if (requestedBaths != null && baths != null && baths < requestedBaths) return false;
  if (requestedBaths != null && baths == null) return false;
  if (referenceMinBeds != null && beds != null && beds < referenceMinBeds) return false;
  if (referenceMaxBeds != null && beds != null && beds > referenceMaxBeds) return false;
  if (referenceMinBaths != null && baths != null && baths < referenceMinBaths) return false;
  if (referenceMaxBaths != null && baths != null && baths > referenceMaxBaths) return false;
  if ((minPrice != null || maxPrice != null) && price == null) return false;
  if (minPrice != null && price != null && price < minPrice) return false;
  if (maxPrice != null && price != null && price > maxPrice) return false;

  return true;
}

function scorePropertyCandidate(property: SheetRow, criteria: PropertySearchCriteria): number {
  let score = 0;
  const terms = areaTerms(criteria);
  const haystack = propertyHaystack(property);
  if (wantsRental(criteria) && propertyLooksRental(property)) score -= 50;
  if (/\b(apartment|apartments|apt|apts)\b/i.test(normalizeSearchText(criteria.query || "")) && /\b(apartment|apartments|apt)\b/i.test(normalizeSearchText(property.property_type))) score -= 20;
  if (terms.some((term) => normalizeSearchText(property.city) === normalizeSearchText(term))) score -= 40;
  if (terms.some((term) => normalizeSearchText(property.neighborhood).includes(normalizeSearchText(term)))) score -= 35;
  if (terms.some((term) => haystack.includes(normalizeSearchText(term)))) score -= 10;

  const reference = criteria.reference || {};
  const price = numericValue(property.price);
  const refPrice = numericValue(reference.price);
  const beds = numericValue(property.beds);
  const refBeds = numericValue(reference.beds);
  const baths = numericValue(property.baths);
  const refBaths = numericValue(reference.baths);
  if (refBeds != null && beds != null) score += Math.abs(beds - refBeds) * 12;
  if (refBaths != null && baths != null) score += Math.abs(baths - refBaths) * 8;
  if (refPrice != null && price != null) score += Math.min(50, Math.abs(price - refPrice) / Math.max(refPrice, 1) * 50);
  if (reference.neighborhood && normalizeSearchText(property.neighborhood) === normalizeSearchText(reference.neighborhood)) score -= criteria.mode === "neighboring" ? 30 : 8;
  if (reference.city && normalizeSearchText(property.city) === normalizeSearchText(reference.city)) score -= criteria.mode === "neighboring" ? 20 : 4;
  if (property.photo_url) score -= 1;
  if (property.listing_url) score -= 1;
  return score;
}

export async function findCandidatePropertiesFromDatabase(query: string | PropertySearchCriteria = "", limit = 5): Promise<SheetRow[]> {
  const criteria = criteriaFromQuery(query);
  const result = await getPool().query(
    `select ${PROPERTIES_HEADERS.join(", ")}
       from properties
      where client_id = $1
      order by updated_at desc, address asc
      limit 500`,
    [clientId()],
  );
  const rows = result.rows.map((row) => rowToStrings(PROPERTIES_HEADERS, row));
  const matched = rows.filter((property) => propertyMatchesCriteria(property, criteria));
  const candidates = matched.length || hasHardStructuredCriteria(criteria) ? matched : rows.filter((property) => {
    const terms = areaTerms(criteria);
    return terms.length ? matchesArea(property, terms) : true;
  });
  return candidates
    .sort((a, b) => scorePropertyCandidate(a, criteria) - scorePropertyCandidate(b, criteria) || a.address.localeCompare(b.address))
    .slice(0, limit);
}

function propertyAddressStem(address: string): string {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/\btexas\b/g, "tx")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(/^(\d+\s+.*?\b(?:st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|cir|circle|trl|trail|path|cv|cove)\b)/);
  return match?.[1] || normalized;
}

export async function findPropertiesByAddressesFromDatabase(addresses: string[], limit = 5): Promise<SheetRow[]> {
  const cleaned = addresses.map((address) => address.trim().toLowerCase()).filter(Boolean);
  if (!cleaned.length) return [];
  const rows: SheetRow[] = [];
  const seen = new Set<string>();
  for (const address of cleaned) {
    if (rows.length >= limit) break;
    const stem = propertyAddressStem(address);
    const result = await getPool().query(
      `select ${PROPERTIES_HEADERS.join(", ")}
         from properties
        where client_id = $1
          and (
            lower(address) = $2
            or lower(regexp_replace(address, '[^a-zA-Z0-9#]+', ' ', 'g')) like $3
          )
        order by case when lower(address) = $2 then 0 else 1 end, updated_at desc
        limit $4`,
      [clientId(), address, `${stem}%`, Math.max(1, limit - rows.length)],
    );
    for (const row of result.rows) {
      const mapped = rowToStrings(PROPERTIES_HEADERS, row);
      const key = mapped.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(mapped);
    }
  }
  return rows;
}

export async function upsertPropertyToDatabase(incoming: Partial<SheetRow>, source = "live_lookup"): Promise<SheetRow | null> {
  const cleaned = cleanRow(PROPERTIES_HEADERS, incoming);
  if (!cleaned.address.trim()) return null;
  await ensureClientInDatabase();
  await getPool().query(
    `insert into properties (client_id, ${PROPERTIES_HEADERS.join(", ")}, source)
     values ($1, ${PROPERTIES_HEADERS.map((_, index) => `$${index + 2}`).join(", ")}, $${PROPERTIES_HEADERS.length + 2})
     on conflict (client_id, address) do update set
       ${PROPERTIES_HEADERS.filter((header) => header !== "address").map((header) => `${header} = coalesce(nullif(excluded.${header}, ''), properties.${header})`).join(", ")},
       source = case
         when properties.source = 'sheets' then properties.source
         else excluded.source
       end,
       updated_at = now()`,
    [clientId(), ...PROPERTIES_HEADERS.map((header) => cleaned[header]), source],
  );
  return cleaned;
}

export async function upsertLeadMemoryToDatabase(incoming: Partial<SheetRow>): Promise<SheetRow> {
  await ensureClientInDatabase();
  const cleaned = cleanRow(LEAD_MEMORY_HEADERS, incoming);
  const existing = await findMatchingLead(cleaned);
  const next = existing ? mergeNonEmpty(existing, cleaned) : cleaned;

  if (existing) {
    await getPool().query(
      `update lead_memory
          set ${LEAD_MEMORY_HEADERS.map((header, index) => `${header} = $${index + 2}`).join(", ")},
              updated_at = now()
        where client_id = $1
          and email = $${LEAD_MEMORY_HEADERS.length + 2}
          and phone = $${LEAD_MEMORY_HEADERS.length + 3}
          and full_name = $${LEAD_MEMORY_HEADERS.length + 4}`,
      [clientId(), ...LEAD_MEMORY_HEADERS.map((header) => leadMemoryDbValue(header, next[header])), existing.email, existing.phone, existing.full_name],
    );
    return next;
  }

  await getPool().query(
    `insert into lead_memory (client_id, ${LEAD_MEMORY_HEADERS.join(", ")})
     values ($1, ${LEAD_MEMORY_HEADERS.map((_, index) => `$${index + 2}`).join(", ")})
     on conflict (client_id, email, phone, full_name) do update set
       ${LEAD_MEMORY_HEADERS.filter((header) => !["email", "phone", "full_name"].includes(header))
         .map((header) => `${header} = excluded.${header}`)
         .join(", ")},
       updated_at = now()`,
    [clientId(), ...LEAD_MEMORY_HEADERS.map((header) => leadMemoryDbValue(header, next[header]))],
  );
  return next;
}

export async function appendConversationEventToDatabase(event: Partial<SheetRow>): Promise<SheetRow> {
  await ensureClientInDatabase();
  const cleaned = cleanRow(CONVERSATION_EVENTS_HEADERS, event);
  const columns = await tableColumns("conversation_events");
  const writableHeaders = CONVERSATION_EVENTS_HEADERS.filter((header) => columns.has(header));
  await getPool().query(
    `insert into conversation_events (client_id, ${writableHeaders.join(", ")})
     values ($1, ${writableHeaders.map((_, index) => `$${index + 2}`).join(", ")})`,
    [clientId(), ...writableHeaders.map((header) => eventDbValue(header, cleaned[header]))],
  );
  return cleaned;
}

export type VoiceCallRecord = {
  call_id: string;
  thread_ref?: string;
  direction?: string;
  email?: string;
  phone?: string;
  full_name?: string;
  lead_role?: string;
  agent_name?: string;
  started_at?: string;
  ended_at?: string;
  duration_sec?: number;
  disposition?: string;
  intents?: string[];
  actions?: unknown[];
  summary?: string;
  transcript?: string;
  recording_url?: string;
  ended_reason?: string;
  human_owner?: string;
};

// One row per call. Upsert keyed by (client_id, call_id) so a status-update
// followed by an end-of-call-report merge into the same row. Non-empty text
// fields win on conflict; numeric/array/json fields take the latest value.
export async function upsertVoiceCallToDatabase(call: VoiceCallRecord): Promise<void> {
  if (!call.call_id) return;
  await ensureClientInDatabase();
  await getPool().query(
    `insert into voice_calls (
        client_id, call_id, thread_ref, direction, email, phone, full_name, lead_role,
        agent_name, started_at, ended_at, duration_sec, disposition, intents, actions,
        summary, transcript, recording_url, ended_reason, human_owner
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15::jsonb,
        $16, $17, $18, $19, $20
      )
      on conflict (client_id, call_id) do update set
        thread_ref = coalesce(nullif(excluded.thread_ref, ''), voice_calls.thread_ref),
        direction = coalesce(nullif(excluded.direction, ''), voice_calls.direction),
        email = coalesce(nullif(excluded.email, ''), voice_calls.email),
        phone = coalesce(nullif(excluded.phone, ''), voice_calls.phone),
        full_name = coalesce(nullif(excluded.full_name, ''), voice_calls.full_name),
        lead_role = coalesce(nullif(excluded.lead_role, ''), voice_calls.lead_role),
        agent_name = coalesce(nullif(excluded.agent_name, ''), voice_calls.agent_name),
        started_at = coalesce(nullif(excluded.started_at, ''), voice_calls.started_at),
        ended_at = coalesce(nullif(excluded.ended_at, ''), voice_calls.ended_at),
        duration_sec = greatest(excluded.duration_sec, voice_calls.duration_sec),
        disposition = coalesce(nullif(excluded.disposition, ''), voice_calls.disposition),
        intents = case when array_length(excluded.intents, 1) is null then voice_calls.intents else excluded.intents end,
        actions = case when excluded.actions = '[]'::jsonb then voice_calls.actions else excluded.actions end,
        summary = coalesce(nullif(excluded.summary, ''), voice_calls.summary),
        transcript = coalesce(nullif(excluded.transcript, ''), voice_calls.transcript),
        recording_url = coalesce(nullif(excluded.recording_url, ''), voice_calls.recording_url),
        ended_reason = coalesce(nullif(excluded.ended_reason, ''), voice_calls.ended_reason),
        human_owner = coalesce(nullif(excluded.human_owner, ''), voice_calls.human_owner)`,
    [
      clientId(),
      call.call_id,
      call.thread_ref || "",
      call.direction || "inbound",
      call.email || "",
      call.phone || "",
      call.full_name || "",
      call.lead_role || "",
      call.agent_name || IRIS_AGENT_NAME,
      call.started_at || "",
      call.ended_at || "",
      Math.max(0, Math.round(Number(call.duration_sec || 0))),
      call.disposition || "",
      call.intents && call.intents.length ? call.intents : [],
      JSON.stringify(call.actions || []),
      call.summary || "",
      call.transcript || "",
      call.recording_url || "",
      call.ended_reason || "",
      call.human_owner || "",
    ],
  );
}

export type StyleExample = {
  category: string;
  tone_tags: string[];
  redacted_excerpt: string;
};

// Approved few-shot style examples for the client, newest first. Optional
// category filter (e.g. "property_reply"). Empty when none approved.
export async function readStyleExamplesFromDatabase(category = "", limit = 3): Promise<StyleExample[]> {
  const params: unknown[] = [clientId()];
  let where = "client_id = $1 and approved = true";
  if (category) {
    params.push(category);
    where += ` and category = $${params.length}`;
  }
  params.push(Math.max(1, limit));
  const result = await getPool().query(
    `select category, tone_tags, redacted_excerpt
       from email_style_examples
      where ${where}
      order by created_at desc
      limit $${params.length}`,
    params,
  );
  return result.rows.map((row) => ({
    category: String(row.category || ""),
    tone_tags: Array.isArray(row.tone_tags) ? row.tone_tags.map(String) : [],
    redacted_excerpt: String(row.redacted_excerpt || ""),
  }));
}

export async function loadAgentInboxDataFromDatabase() {  const [leads, events, properties, voiceCalls] = await Promise.all([
    readLeadsFromDatabase(),
    readEventsFromDatabase(),
    readPropertiesFromDatabase(),
    readVoiceCallsFromDatabase(),
  ]);
  return { leads, events, properties, voiceCalls };
}
