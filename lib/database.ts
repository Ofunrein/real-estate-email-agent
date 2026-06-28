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
import type { ThreadReadState } from "@/lib/inboxData";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { mergeNonEmpty, normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadIdentity";
import {
  AUSTIN_NEIGHBORHOODS,
  CENTRAL_TEXAS_ALIASES,
  CENTRAL_TEXAS_CITIES,
} from "@/lib/serviceAreas";
import type { ChannelConnectionInput, ChannelConnectionRecord } from "@/lib/channelConnections";

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
  return Object.fromEntries(headers.map((header) => {
    const value = row[header];
    if (value == null) return [header, ""];
    if (typeof value === "object") return [header, JSON.stringify(value)];
    return [header, String(value)];
  }));
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
  if (header === "reply_job_id") return String(value ?? "").trim() || null;
  if (header === "media_json") return String(value ?? "").trim() || "[]";
  if (header === "provider_metadata") return String(value ?? "").trim() || "{}";
  return value ?? "";
}

export async function ensureClientInDatabase(cid = clientId(), name = clientName()): Promise<void> {
  await getPool().query(
    `insert into clients (id, name)
     values ($1, $2)
     on conflict (id) do update set
       name = excluded.name,
       updated_at = now()`,
    [cid, name],
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
      order by coalesce(
          nullif(event_at, '')::timestamptz,
          created_at
        ) asc,
        id asc`,
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
  gmail_watch_history_id: string;
  gmail_watch_expiration: string;
  gmail_watch_renewed_at: string;
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
    gmail_watch_history_id: String(row.gmail_watch_history_id || ""),
    gmail_watch_expiration: row.gmail_watch_expiration ? new Date(String(row.gmail_watch_expiration)).toISOString() : "",
    gmail_watch_renewed_at: row.gmail_watch_renewed_at ? new Date(String(row.gmail_watch_renewed_at)).toISOString() : "",
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

export type LeadImportBatchRecord = {
  id: string;
  client_id: string;
  source_type: string;
  source_name: string;
  source_provider: string;
  status: string;
  filename: string;
  total_rows: number;
  imported_count: number;
  merged_count: number;
  duplicate_count: number;
  invalid_count: number;
  missing_contact_count: number;
  campaign_eligible_count: number;
  segment_counts: Record<string, number>;
  unmapped_columns: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LeadImportItemInput = {
  batchId: string;
  rowIndex: number;
  status: "validated" | "imported" | "merged" | "duplicate" | "invalid" | "skipped";
  dedupeKey?: string;
  email?: string;
  phone?: string;
  fullName?: string;
  sourceId?: string;
  segments?: string[];
  campaignEligible?: boolean;
  leadMemoryKey?: string;
  rawData?: Record<string, unknown>;
  normalizedData?: Record<string, unknown>;
  error?: string;
};

export type LeadImportItemRecord = {
  id: number;
  batch_id: string;
  client_id: string;
  row_index: number;
  status: string;
  dedupe_key: string;
  email: string;
  phone: string;
  full_name: string;
  source_id: string;
  segments: string[];
  campaign_eligible: boolean;
  lead_memory_key: string;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown>;
  error: string;
  created_at: string;
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(jsonRecord(value)).map(([key, count]) => [key, Number(count || 0)]),
  );
}

function channelConnectionFromRow(row: Record<string, unknown>): ChannelConnectionRecord {
  return {
    id: String(row.id || ""),
    client_id: String(row.client_id || ""),
    channel: String(row.channel || ""),
    provider: String(row.provider || ""),
    external_user_id: String(row.external_user_id || ""),
    auth_config_id: String(row.auth_config_id || ""),
    connected_account_id: String(row.connected_account_id || ""),
    selected_asset_id: String(row.selected_asset_id || ""),
    selected_asset_name: String(row.selected_asset_name || ""),
    selected_asset_type: String(row.selected_asset_type || ""),
    status: String(row.status || ""),
    health_reason: String(row.health_reason || ""),
    webhook_status: String(row.webhook_status || ""),
    page_access_token: String(row.page_access_token || ""),
    token_expires_at: row.token_expires_at ? new Date(String(row.token_expires_at)).toISOString() : "",
    metadata: jsonRecord(row.metadata),
    created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : "",
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : "",
  };
}

function cleanConnectionText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanConnectionSlug(value: unknown): string {
  return cleanConnectionText(value).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function channelConnectionValues(input: ChannelConnectionInput) {
  const channel = cleanConnectionSlug(input.channel);
  if (!channel) throw new Error("channel is required");
  const provider = cleanConnectionSlug(input.provider || "manual");
  const selectedAssetId = cleanConnectionText(input.selected_asset_id);
  const connectedAccountId = cleanConnectionText(input.connected_account_id);
  return {
    channel,
    provider,
    externalUserId: cleanConnectionText(input.external_user_id),
    authConfigId: cleanConnectionText(input.auth_config_id),
    connectedAccountId,
    selectedAssetId,
    selectedAssetName: cleanConnectionText(input.selected_asset_name),
    selectedAssetType: cleanConnectionText(input.selected_asset_type),
    status: cleanConnectionSlug(input.status || (selectedAssetId || connectedAccountId ? "connected" : "needs_config")),
    healthReason: cleanConnectionText(input.health_reason),
    webhookStatus: cleanConnectionSlug(input.webhook_status || ""),
    pageAccessToken: cleanConnectionText(input.page_access_token),
    tokenExpiresAt: cleanConnectionText(input.token_expires_at),
    metadata: jsonRecord(input.metadata),
  };
}

function channelConnectionSelectList(hasTokenColumns: boolean): string {
  return `id, client_id, channel, provider, external_user_id, auth_config_id,
            connected_account_id, selected_asset_id, selected_asset_name, selected_asset_type,
            status, health_reason, webhook_status,
            ${hasTokenColumns ? "page_access_token, token_expires_at" : "''::text as page_access_token, null::timestamptz as token_expires_at"},
            metadata, created_at, updated_at`;
}

async function channelConnectionHasTokenColumns(): Promise<boolean> {
  const columns = await tableColumns("channel_connections");
  return columns.has("page_access_token") && columns.has("token_expires_at");
}

export async function listChannelConnectionsFromDatabase(cid = clientId()): Promise<ChannelConnectionRecord[]> {
  if (!await tableReady("channel_connections")) return [];
  const hasTokenColumns = await channelConnectionHasTokenColumns();
  const result = await getPool().query(
    `select ${channelConnectionSelectList(hasTokenColumns)}
       from channel_connections
      where client_id = $1
      order by channel asc, provider asc, selected_asset_name asc, updated_at desc`,
    [cid],
  );
  return result.rows.map(channelConnectionFromRow);
}

export async function getChannelConnectionFromDatabase(
  cid: string,
  id: string,
): Promise<ChannelConnectionRecord | null> {
  if (!await tableReady("channel_connections")) return null;
  const hasTokenColumns = await channelConnectionHasTokenColumns();
  const result = await getPool().query(
    `select ${channelConnectionSelectList(hasTokenColumns)}
       from channel_connections
      where client_id = $1
        and id = $2
      limit 1`,
    [cid, id],
  );
  return result.rows[0] ? channelConnectionFromRow(result.rows[0]) : null;
}

export async function upsertChannelConnectionInDatabase(
  cid: string,
  input: ChannelConnectionInput,
): Promise<ChannelConnectionRecord> {
  if (!await tableReady("channel_connections")) {
    throw new Error("channel_connections table is missing. Run db/migrations/013_channel_connections.sql");
  }
  await ensureClientInDatabase(cid, cid);
  const values = channelConnectionValues(input);
  const id = cleanConnectionText(input.id);
  const hasTokenColumns = await channelConnectionHasTokenColumns();

  if (id) {
    if (hasTokenColumns) {
      const result = await getPool().query(
        `update channel_connections
            set channel = $3,
                provider = $4,
                external_user_id = $5,
                auth_config_id = $6,
                connected_account_id = $7,
                selected_asset_id = $8,
                selected_asset_name = $9,
                selected_asset_type = $10,
                status = $11,
                health_reason = $12,
                webhook_status = $13,
                page_access_token = $14,
                token_expires_at = nullif($15, '')::timestamptz,
                metadata = $16::jsonb,
                updated_at = now()
          where client_id = $1
            and id = $2
          returning ${channelConnectionSelectList(true)}`,
        [
          cid,
          id,
          values.channel,
          values.provider,
          values.externalUserId,
          values.authConfigId,
          values.connectedAccountId,
          values.selectedAssetId,
          values.selectedAssetName,
          values.selectedAssetType,
          values.status,
          values.healthReason,
          values.webhookStatus,
          values.pageAccessToken,
          values.tokenExpiresAt,
          JSON.stringify(values.metadata),
        ],
      );
      if (result.rows[0]) return channelConnectionFromRow(result.rows[0]);
    }
    const result = await getPool().query(
      `update channel_connections
          set channel = $3,
              provider = $4,
              external_user_id = $5,
              auth_config_id = $6,
              connected_account_id = $7,
              selected_asset_id = $8,
              selected_asset_name = $9,
              selected_asset_type = $10,
              status = $11,
              health_reason = $12,
              webhook_status = $13,
              metadata = $14::jsonb,
              updated_at = now()
        where client_id = $1
          and id = $2
        returning id, client_id, channel, provider, external_user_id, auth_config_id,
                  connected_account_id, selected_asset_id, selected_asset_name, selected_asset_type,
                  status, health_reason, webhook_status, metadata, created_at, updated_at`,
      [
        cid,
        id,
        values.channel,
        values.provider,
        values.externalUserId,
        values.authConfigId,
        values.connectedAccountId,
        values.selectedAssetId,
        values.selectedAssetName,
        values.selectedAssetType,
        values.status,
        values.healthReason,
        values.webhookStatus,
        JSON.stringify(values.metadata),
      ],
    );
    if (result.rows[0]) return channelConnectionFromRow(result.rows[0]);
  }

  if (hasTokenColumns) {
    const result = await getPool().query(
      `insert into channel_connections (
          client_id, channel, provider, external_user_id, auth_config_id, connected_account_id,
          selected_asset_id, selected_asset_name, selected_asset_type, status, health_reason,
          webhook_status, page_access_token, token_expires_at, metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, nullif($14, '')::timestamptz, $15::jsonb)
        on conflict (client_id, channel, provider, selected_asset_id) do update set
          external_user_id = excluded.external_user_id,
          auth_config_id = excluded.auth_config_id,
          connected_account_id = excluded.connected_account_id,
          selected_asset_name = excluded.selected_asset_name,
          selected_asset_type = excluded.selected_asset_type,
          status = excluded.status,
          health_reason = excluded.health_reason,
          webhook_status = excluded.webhook_status,
          page_access_token = excluded.page_access_token,
          token_expires_at = excluded.token_expires_at,
          metadata = channel_connections.metadata || excluded.metadata,
          updated_at = now()
        returning ${channelConnectionSelectList(true)}`,
      [
        cid,
        values.channel,
        values.provider,
        values.externalUserId,
        values.authConfigId,
        values.connectedAccountId,
        values.selectedAssetId,
        values.selectedAssetName,
        values.selectedAssetType,
        values.status,
        values.healthReason,
        values.webhookStatus,
        values.pageAccessToken,
        values.tokenExpiresAt,
        JSON.stringify(values.metadata),
      ],
    );
    return channelConnectionFromRow(result.rows[0]);
  }

  const result = await getPool().query(
    `insert into channel_connections (
        client_id, channel, provider, external_user_id, auth_config_id, connected_account_id,
        selected_asset_id, selected_asset_name, selected_asset_type, status, health_reason,
        webhook_status, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      on conflict (client_id, channel, provider, selected_asset_id) do update set
        external_user_id = excluded.external_user_id,
        auth_config_id = excluded.auth_config_id,
        connected_account_id = excluded.connected_account_id,
        selected_asset_name = excluded.selected_asset_name,
        selected_asset_type = excluded.selected_asset_type,
        status = excluded.status,
        health_reason = excluded.health_reason,
        webhook_status = excluded.webhook_status,
        metadata = channel_connections.metadata || excluded.metadata,
        updated_at = now()
      returning id, client_id, channel, provider, external_user_id, auth_config_id,
                connected_account_id, selected_asset_id, selected_asset_name, selected_asset_type,
                status, health_reason, webhook_status, metadata, created_at, updated_at`,
    [
      cid,
      values.channel,
      values.provider,
      values.externalUserId,
      values.authConfigId,
      values.connectedAccountId,
      values.selectedAssetId,
      values.selectedAssetName,
      values.selectedAssetType,
      values.status,
      values.healthReason,
      values.webhookStatus,
      JSON.stringify(values.metadata),
    ],
  );
  return channelConnectionFromRow(result.rows[0]);
}

export async function deleteChannelConnectionFromDatabase(cid: string, id: string): Promise<boolean> {
  if (!await tableReady("channel_connections")) return false;
  const result = await getPool().query(
    `delete from channel_connections
      where client_id = $1
        and id = $2`,
    [cid, id],
  );
  return Number(result.rowCount || 0) > 0;
}

function leadImportBatchFromRow(row: Record<string, unknown>): LeadImportBatchRecord {
  return {
    id: String(row.id || ""),
    client_id: String(row.client_id || ""),
    source_type: String(row.source_type || ""),
    source_name: String(row.source_name || ""),
    source_provider: String(row.source_provider || ""),
    status: String(row.status || ""),
    filename: String(row.filename || ""),
    total_rows: Number(row.total_rows || 0),
    imported_count: Number(row.imported_count || 0),
    merged_count: Number(row.merged_count || 0),
    duplicate_count: Number(row.duplicate_count || 0),
    invalid_count: Number(row.invalid_count || 0),
    missing_contact_count: Number(row.missing_contact_count || 0),
    campaign_eligible_count: Number(row.campaign_eligible_count || 0),
    segment_counts: numberRecord(row.segment_counts),
    unmapped_columns: Array.isArray(row.unmapped_columns) ? row.unmapped_columns.map(String) : [],
    metadata: jsonRecord(row.metadata),
    created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : "",
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : "",
  };
}

function leadImportItemFromRow(row: Record<string, unknown>): LeadImportItemRecord {
  return {
    id: Number(row.id || 0),
    batch_id: String(row.batch_id || ""),
    client_id: String(row.client_id || ""),
    row_index: Number(row.row_index || 0),
    status: String(row.status || ""),
    dedupe_key: String(row.dedupe_key || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    full_name: String(row.full_name || ""),
    source_id: String(row.source_id || ""),
    segments: Array.isArray(row.segments) ? row.segments.map(String) : [],
    campaign_eligible: Boolean(row.campaign_eligible),
    lead_memory_key: String(row.lead_memory_key || ""),
    raw_data: jsonRecord(row.raw_data),
    normalized_data: jsonRecord(row.normalized_data),
    error: String(row.error || ""),
    created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : "",
  };
}

async function leadImportTablesReady(): Promise<boolean> {
  return (await tableColumns("lead_import_batches")).has("segment_counts")
    && (await tableColumns("lead_import_items")).has("normalized_data");
}

export async function createLeadImportBatchInDatabase(input: {
  id: string;
  sourceType: string;
  sourceName?: string;
  sourceProvider?: string;
  status?: string;
  filename?: string;
  totalRows?: number;
  metadata?: Record<string, unknown>;
}): Promise<LeadImportBatchRecord | null> {
  if (!await leadImportTablesReady()) return null;
  await ensureClientInDatabase();
  const result = await getPool().query(
    `insert into lead_import_batches (
        id, client_id, source_type, source_name, source_provider, status,
        filename, total_rows, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      returning *`,
    [
      input.id,
      clientId(),
      input.sourceType,
      input.sourceName || "",
      input.sourceProvider || "",
      input.status || "uploaded",
      input.filename || "",
      input.totalRows || 0,
      JSON.stringify(input.metadata || {}),
    ],
  );
  return leadImportBatchFromRow(result.rows[0]);
}

export async function appendLeadImportItemToDatabase(input: LeadImportItemInput): Promise<void> {
  if (!await leadImportTablesReady()) return;
  await getPool().query(
    `insert into lead_import_items (
        batch_id, client_id, row_index, status, dedupe_key, email, phone,
        full_name, source_id, segments, campaign_eligible, lead_memory_key,
        raw_data, normalized_data, error
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)
      on conflict (batch_id, row_index) do update set
        status = excluded.status,
        dedupe_key = excluded.dedupe_key,
        email = excluded.email,
        phone = excluded.phone,
        full_name = excluded.full_name,
        source_id = excluded.source_id,
        segments = excluded.segments,
        campaign_eligible = excluded.campaign_eligible,
        lead_memory_key = excluded.lead_memory_key,
        raw_data = excluded.raw_data,
        normalized_data = excluded.normalized_data,
        error = excluded.error`,
    [
      input.batchId,
      clientId(),
      input.rowIndex,
      input.status,
      input.dedupeKey || "",
      input.email || "",
      input.phone || "",
      input.fullName || "",
      input.sourceId || "",
      input.segments || [],
      Boolean(input.campaignEligible),
      input.leadMemoryKey || "",
      JSON.stringify(input.rawData || {}),
      JSON.stringify(input.normalizedData || {}),
      input.error || "",
    ],
  );
}

export async function updateLeadImportBatchInDatabase(input: {
  id: string;
  status: string;
  importedCount: number;
  mergedCount: number;
  duplicateCount: number;
  invalidCount: number;
  missingContactCount: number;
  campaignEligibleCount: number;
  segmentCounts: Record<string, number>;
  unmappedColumns: string[];
  metadata?: Record<string, unknown>;
}): Promise<LeadImportBatchRecord | null> {
  if (!await leadImportTablesReady()) return null;
  const result = await getPool().query(
    `update lead_import_batches
        set status = $3,
            imported_count = $4,
            merged_count = $5,
            duplicate_count = $6,
            invalid_count = $7,
            missing_contact_count = $8,
            campaign_eligible_count = $9,
            segment_counts = $10::jsonb,
            unmapped_columns = $11,
            metadata = metadata || $12::jsonb,
            updated_at = now()
      where client_id = $1
        and id = $2
      returning *`,
    [
      clientId(),
      input.id,
      input.status,
      input.importedCount,
      input.mergedCount,
      input.duplicateCount,
      input.invalidCount,
      input.missingContactCount,
      input.campaignEligibleCount,
      JSON.stringify(input.segmentCounts),
      input.unmappedColumns,
      JSON.stringify(input.metadata || {}),
    ],
  );
  return result.rows[0] ? leadImportBatchFromRow(result.rows[0]) : null;
}

export async function readLeadImportBatchesFromDatabase(limit = 20): Promise<LeadImportBatchRecord[]> {
  if (!await leadImportTablesReady()) return [];
  const result = await getPool().query(
    `select *
       from lead_import_batches
      where client_id = $1
      order by created_at desc
      limit $2`,
    [clientId(), limit],
  );
  return result.rows.map(leadImportBatchFromRow);
}

export async function readLeadImportItemsFromDatabase(batchId: string, limit = 50): Promise<LeadImportItemRecord[]> {
  if (!batchId || !await leadImportTablesReady()) return [];
  const result = await getPool().query(
    `select *
       from lead_import_items
      where client_id = $1
        and batch_id = $2
      order by row_index asc
      limit $3`,
    [clientId(), batchId, limit],
  );
  return result.rows.map(leadImportItemFromRow);
}

export async function readEmailAccountsFromDatabase(): Promise<EmailAccountRecord[]> {
  if (!await emailAccountsTableReady()) return [];
  const columns = await tableColumns("email_accounts");
  const watchColumns = columns.has("gmail_watch_history_id")
    ? `, gmail_watch_history_id, gmail_watch_expiration, gmail_watch_renewed_at`
    : `, '' as gmail_watch_history_id, null::timestamptz as gmail_watch_expiration, null::timestamptz as gmail_watch_renewed_at`;
  const result = await getPool().query(
    `select id, client_id, provider, email, display_name, token_json_encrypted, scopes,
            is_default, status, connected_by, last_error, last_used_at, created_at, updated_at
            ${watchColumns}
       from email_accounts
      where client_id = $1
      order by is_default desc, updated_at desc`,
    [clientId()],
  );
  return result.rows.map(emailAccountFromRow);
}

export async function readDefaultEmailAccountFromDatabase(): Promise<EmailAccountRecord | null> {
  if (!await emailAccountsTableReady()) return null;
  const columns = await tableColumns("email_accounts");
  const watchColumns = columns.has("gmail_watch_history_id")
    ? `, gmail_watch_history_id, gmail_watch_expiration, gmail_watch_renewed_at`
    : `, '' as gmail_watch_history_id, null::timestamptz as gmail_watch_expiration, null::timestamptz as gmail_watch_renewed_at`;
  const result = await getPool().query(
    `select id, client_id, provider, email, display_name, token_json_encrypted, scopes,
            is_default, status, connected_by, last_error, last_used_at, created_at, updated_at
            ${watchColumns}
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

export async function readConnectedGmailAccountsForWatchRenewal(options: {
  renewWithinHours?: number;
  limit?: number;
  force?: boolean;
} = {}): Promise<EmailAccountRecord[]> {
  if (!await emailAccountsTableReady()) return [];
  const columns = await tableColumns("email_accounts");
  const hasWatchColumns = columns.has("gmail_watch_history_id");
  const renewWithinHours = Math.max(1, Math.min(options.renewWithinHours || 48, 24 * 6));
  const limit = Math.max(1, Math.min(options.limit || 100, 500));
  const watchColumns = hasWatchColumns
    ? `gmail_watch_history_id, gmail_watch_expiration, gmail_watch_renewed_at`
    : `'' as gmail_watch_history_id, null::timestamptz as gmail_watch_expiration, null::timestamptz as gmail_watch_renewed_at`;
  const dueClause = !hasWatchColumns || options.force
    ? ""
    : `and (
         gmail_watch_expiration is null
         or gmail_watch_expiration < now() + ($1::int || ' hours')::interval
       )`;
  const orderBy = hasWatchColumns
    ? "coalesce(gmail_watch_expiration, 'epoch'::timestamptz) asc, updated_at desc"
    : "updated_at desc";
  const params = hasWatchColumns && !options.force ? [renewWithinHours, limit] : [limit];
  const result = await getPool().query(
    `select id, client_id, provider, email, display_name, token_json_encrypted, scopes,
            is_default, status, connected_by, last_error, last_used_at, created_at, updated_at,
            ${watchColumns}
       from email_accounts
      where provider = 'gmail'
        and status = 'connected'
        and is_default = true
        ${dueClause}
      order by ${orderBy}
      limit $${params.length}`,
    params,
  );
  return result.rows.map(emailAccountFromRow);
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

export async function updateEmailAccountTokenForClientInDatabase(clientIdValue: string, email: string, tokenJsonEncrypted: string): Promise<void> {
  if (!clientIdValue.trim() || !email.trim()) return;
  await getPool().query(
    `update email_accounts
        set token_json_encrypted = $3,
            status = 'connected',
            last_error = '',
            last_used_at = now(),
            updated_at = now()
      where client_id = $1
        and provider = 'gmail'
        and email = $2`,
    [clientIdValue, email.trim().toLowerCase(), tokenJsonEncrypted],
  );
}

export async function updateEmailAccountGmailWatchInDatabase(input: {
  clientId: string;
  email: string;
  historyId: string;
  expiration: string;
}): Promise<void> {
  if (!input.clientId.trim() || !input.email.trim() || !await emailAccountsTableReady()) return;
  const columns = await tableColumns("email_accounts");
  if (!columns.has("gmail_watch_history_id")) return;
  await getPool().query(
    `update email_accounts
        set gmail_watch_history_id = $3,
            gmail_watch_expiration = $4::timestamptz,
            gmail_watch_renewed_at = now(),
            status = 'connected',
            last_error = '',
            updated_at = now()
      where client_id = $1
        and provider = 'gmail'
        and email = $2`,
    [input.clientId, input.email.trim().toLowerCase(), input.historyId, input.expiration],
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

export async function markEmailAccountErrorForClientInDatabase(clientIdValue: string, email: string, error: string): Promise<void> {
  if (!clientIdValue.trim() || !email.trim() || !await emailAccountsTableReady()) return;
  await getPool().query(
    `update email_accounts
        set status = 'error',
            last_error = $3,
            updated_at = now()
      where client_id = $1
        and provider = 'gmail'
        and email = $2`,
    [clientIdValue, email.trim().toLowerCase(), error.slice(0, 500)],
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
    gmail_draft_id: String(row.gmail_draft_id || ""),
    gmail_message_id: String(row.gmail_message_id || ""),
    gmail_thread_id: String(row.gmail_thread_id || ""),
    gmail_mailbox_email: String(row.gmail_mailbox_email || ""),
    gmail_draft_synced_at: row.gmail_draft_synced_at ? new Date(String(row.gmail_draft_synced_at)).toISOString() : "",
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : "",
  };
}

function threadReadStateFromRow(row: Record<string, unknown>): ThreadReadState {
  return {
    channel: String(row.channel || ""),
    threadRef: String(row.thread_ref || ""),
    seenAt: row.seen_at ? new Date(String(row.seen_at)).toISOString() : "",
    seenEventAt: row.seen_event_at ? new Date(String(row.seen_event_at)).toISOString() : "",
    seenBy: String(row.seen_by || ""),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : "",
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

export async function updateInboxCategoryGmailLabelInDatabase(input: {
  slug: string;
  gmailLabelId: string;
  gmailLabelName: string;
}): Promise<void> {
  if (!await tableReady("inbox_categories")) return;
  await ensureInboxDefaultsInDatabase();
  await getPool().query(
    `update inbox_categories
        set gmail_label_id = $3,
            gmail_label_name = $4,
            updated_at = now()
      where client_id = $1
        and slug = $2`,
    [clientId(), input.slug, input.gmailLabelId, input.gmailLabelName],
  );
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
            safe_to_auto_send, needs_human, model, status, fingerprint,
            gmail_draft_id, gmail_message_id, gmail_thread_id, gmail_mailbox_email,
            gmail_draft_synced_at, updated_at
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
            safe_to_auto_send, needs_human, model, status, fingerprint,
            gmail_draft_id, gmail_message_id, gmail_thread_id, gmail_mailbox_email,
            gmail_draft_synced_at, updated_at
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
        next_action, safe_to_auto_send, needs_human, model, status, fingerprint,
        gmail_draft_id, gmail_message_id, gmail_thread_id, gmail_mailbox_email,
        gmail_draft_synced_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
        gmail_draft_id = excluded.gmail_draft_id,
        gmail_message_id = excluded.gmail_message_id,
        gmail_thread_id = excluded.gmail_thread_id,
        gmail_mailbox_email = excluded.gmail_mailbox_email,
        gmail_draft_synced_at = excluded.gmail_draft_synced_at,
        updated_at = now()
      returning thread_ref, channel, body, category_slug, confidence, reason, next_action,
                safe_to_auto_send, needs_human, model, status, fingerprint,
                gmail_draft_id, gmail_message_id, gmail_thread_id, gmail_mailbox_email,
                gmail_draft_synced_at, updated_at`,
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
      input.gmail_draft_id || "",
      input.gmail_message_id || "",
      input.gmail_thread_id || "",
      input.gmail_mailbox_email || "",
      input.gmail_draft_synced_at || null,
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

export async function readThreadReadStatesFromDatabase(): Promise<Record<string, ThreadReadState>> {
  if (!await tableReady("thread_read_states")) return {};
  const result = await getPool().query(
    `select thread_ref, channel, seen_at, seen_event_at, seen_by, updated_at
       from thread_read_states
      where client_id = $1
      order by updated_at desc`,
    [clientId()],
  );
  const states: Record<string, ThreadReadState> = {};
  for (const row of result.rows) {
    const state = threadReadStateFromRow(row);
    states[`${state.channel}:${state.threadRef}`] = state;
  }
  return states;
}

export async function markThreadSeenInDatabase(input: {
  threadRef: string;
  channel: string;
  seenBy?: string;
  seenEventAt?: string;
}): Promise<ThreadReadState> {
  if (!await tableReady("thread_read_states")) {
    const now = new Date().toISOString();
    return {
      channel: input.channel,
      threadRef: input.threadRef,
      seenAt: now,
      seenEventAt: input.seenEventAt || "",
      seenBy: input.seenBy || "owner",
      updatedAt: now,
    };
  }
  await ensureClientInDatabase();
  const result = await getPool().query(
    `insert into thread_read_states (
        client_id, thread_ref, channel, seen_at, seen_event_at, seen_by, updated_at
      ) values ($1, $2, $3, now(), nullif($4, '')::timestamptz, $5, now())
      on conflict (client_id, thread_ref, channel) do update set
        seen_at = now(),
        seen_event_at = coalesce(nullif(excluded.seen_event_at::text, '')::timestamptz, thread_read_states.seen_event_at),
        seen_by = excluded.seen_by,
        updated_at = now()
      returning thread_ref, channel, seen_at, seen_event_at, seen_by, updated_at`,
    [clientId(), input.threadRef, input.channel, input.seenEventAt || "", input.seenBy || "owner"],
  );
  return threadReadStateFromRow(result.rows[0]);
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
      order by coalesce(
          nullif(event_at, '')::timestamptz,
          created_at
        ) desc,
        id desc
      limit $3`,
    [clientId(), threadRef, limit],
  );
  return result.rows.reverse().map((row) => rowToStrings(CONVERSATION_EVENTS_HEADERS, row));
}

export async function readEventsForThreadOrContactFromDatabase(input: {
  threadRef: string;
  channel: string;
  limit?: number;
}): Promise<SheetRow[]> {
  const columns = await selectHeaders("conversation_events", CONVERSATION_EVENTS_HEADERS);
  const prefix = `${input.channel}:`;
  const contactRef = input.threadRef.startsWith(prefix) ? input.threadRef.slice(prefix.length) : input.threadRef;
  const prefixedThreadRef = input.threadRef.startsWith(prefix) ? input.threadRef : `${prefix}${input.threadRef}`;
  const result = await getPool().query(
    `select ${columns}
       from conversation_events
      where client_id = $1
        and (
          thread_ref = $2
          or thread_ref = $5
          or thread_ref = $6
          or (
            channel = $3
            and (
              phone = $2
              or phone = $5
              or email = $2
              or email = $5
            )
          )
        )
      order by coalesce(
          nullif(event_at, '')::timestamptz,
          created_at
        ) desc,
        id desc
      limit $4`,
    [clientId(), input.threadRef, input.channel, input.limit || 12, contactRef, prefixedThreadRef],
  );
  return result.rows.reverse().map((row) => rowToStrings(CONVERSATION_EVENTS_HEADERS, row));
}

export async function findSocialBrowserThreadByUsernameFromDatabase(input: {
  channel: string;
  username: string;
}): Promise<{ threadRef: string; contactRef: string; displayName: string } | null> {
  const username = input.username.trim().replace(/^@+/, "").toLowerCase();
  if (!username || !await tableReady("conversation_events")) return null;
  const result = await getPool().query(
    `select
        thread_ref,
        max(coalesce(nullif(event_at, '')::timestamptz, created_at)) as latest_at,
        max(nullif(phone, '')) as contact_ref,
        max(nullif(full_name, '')) as display_name,
        count(*) as touch_count
       from conversation_events
      where client_id = $1
        and channel = $2
        and coalesce(thread_ref, '') <> ''
        and (
          source ilike '%browser_backfill%'
          or coalesce(provider_metadata->>'source', '') ilike '%browser_backfill%'
        )
        and (
          lower(trim(leading '@' from coalesce(provider_metadata->>'senderUsername', ''))) = $3
          or lower(trim(leading '@' from coalesce(provider_metadata->>'sender_username', ''))) = $3
          or lower(trim(leading '@' from coalesce(provider_metadata->>'username', ''))) = $3
          or lower(trim(leading '@' from coalesce(full_name, ''))) = $3
        )
      group by thread_ref
      order by touch_count desc, latest_at desc nulls last
      limit 1`,
    [clientId(), input.channel, username],
  );
  const row = result.rows[0];
  if (!row?.thread_ref) return null;
  return {
    threadRef: String(row.thread_ref || ""),
    contactRef: String(row.contact_ref || ""),
    displayName: String(row.display_name || ""),
  };
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
      order by coalesce(
          nullif(event_at, '')::timestamptz,
          created_at
        ) desc,
        id desc
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

export async function conversationEventExistsByGmailMessageId(gmailMessageId: string): Promise<boolean> {
  const id = gmailMessageId.trim();
  if (!id || !await tableReady("conversation_events")) return false;
  const result = await getPool().query(
    `select exists (
       select 1
         from conversation_events
        where client_id = $1
          and gmail_message_id = $2
        limit 1
     ) as exists`,
    [clientId(), id],
  );
  return Boolean(result.rows[0]?.exists);
}

export async function readConversationEventByGmailMessageId(gmailMessageId: string): Promise<SheetRow | null> {
  const id = gmailMessageId.trim();
  if (!id || !await tableReady("conversation_events")) return null;
  const columns = await selectHeaders("conversation_events", CONVERSATION_EVENTS_HEADERS);
  const result = await getPool().query(
    `select ${columns}
       from conversation_events
      where client_id = $1
        and gmail_message_id = $2
      order by created_at desc, id desc
      limit 1`,
    [clientId(), id],
  );
  return result.rows[0] ? rowToStrings(CONVERSATION_EVENTS_HEADERS, result.rows[0]) : null;
}

export async function conversationEventMessageIdExists(messageId: string): Promise<boolean> {
  const id = messageId.trim();
  if (!id || !await tableReady("conversation_events")) return false;
  const result = await getPool().query(
    `select exists (
       select 1
         from conversation_events
        where client_id = $1
          and gmail_message_id = $2
        limit 1
     ) as exists`,
    [clientId(), id],
  );
  return Boolean(result.rows[0]?.exists);
}

export async function hasOutboundEmailReplyAfterEventInDatabase(input: {
  threadRef: string;
  eventAt: string;
}): Promise<boolean> {
  if (!input.threadRef || !input.eventAt || !await tableReady("conversation_events")) return false;
  const result = await getPool().query(
    `select exists (
       select 1
         from conversation_events
        where client_id = $1
          and channel = 'email'
          and direction = 'outbound'
          and thread_ref = $2
          and event_type = 'email_ai_reply'
          and coalesce(nullif(event_at, '')::timestamptz, created_at) > $3::timestamptz
        limit 1
     ) as exists`,
    [clientId(), input.threadRef, input.eventAt],
  );
  return Boolean(result.rows[0]?.exists);
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

export type EventDedupeInput = {
  dedupeKey: string;
  channel: string;
  provider?: string;
  providerMessageId?: string;
  threadRef?: string;
  metadata?: Record<string, unknown>;
};

export async function claimEventDedupeInDatabase(input: EventDedupeInput): Promise<{ inserted: boolean; dedupeKey: string }> {
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey || !await tableReady("event_dedupe")) return { inserted: true, dedupeKey };
  await ensureClientInDatabase();
  const metadata = JSON.stringify(input.metadata || {});
  const inserted = await getPool().query(
    `insert into event_dedupe (
        client_id, dedupe_key, channel, provider, provider_message_id, thread_ref, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (client_id, dedupe_key) do nothing
      returning id`,
    [
      clientId(),
      dedupeKey,
      input.channel || "",
      input.provider || "",
      input.providerMessageId || "",
      input.threadRef || "",
      metadata,
    ],
  );
  const didInsert = (inserted.rowCount || 0) > 0;
  if (!didInsert) {
    await getPool().query(
      `update event_dedupe
          set last_seen_at = now(),
              status = 'duplicate',
              metadata = event_dedupe.metadata || $3::jsonb
        where client_id = $1
          and dedupe_key = $2`,
      [clientId(), dedupeKey, metadata],
    );
  }
  return { inserted: didInsert, dedupeKey };
}

export type ReplyJobInput = {
  dedupeKey: string;
  channel: string;
  provider?: string;
  threadRef: string;
  contactRef?: string;
  status?: string;
  modelClassify?: string;
  modelReply?: string;
  replyText?: string;
  mediaJson?: unknown[];
  error?: string;
  nextAction?: string;
  metadata?: Record<string, unknown>;
};

export type ReplyJobRecord = ReplyJobInput & {
  id: string;
  attempts: number;
  sentAt: string;
  createdAt: string;
  updatedAt: string;
};

function mapReplyJob(row: Record<string, unknown>): ReplyJobRecord {
  return {
    id: String(row.id || ""),
    dedupeKey: String(row.dedupe_key || ""),
    channel: String(row.channel || ""),
    provider: String(row.provider || ""),
    threadRef: String(row.thread_ref || ""),
    contactRef: String(row.contact_ref || ""),
    status: String(row.status || ""),
    attempts: intDbValue(row.attempts),
    modelClassify: String(row.model_classify || ""),
    modelReply: String(row.model_reply || ""),
    replyText: String(row.reply_text || ""),
    mediaJson: Array.isArray(row.media_json) ? row.media_json : [],
    error: String(row.error || ""),
    nextAction: String(row.next_action || ""),
    metadata: jsonRecordFromDb(row.metadata),
    sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : "",
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : "",
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : "",
  };
}

function jsonRecordFromDb(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function upsertReplyJobInDatabase(input: ReplyJobInput): Promise<ReplyJobRecord | null> {
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey || !await tableReady("reply_jobs")) return null;
  await ensureClientInDatabase();
  const status = input.status || "received";
  const result = await getPool().query(
    `insert into reply_jobs (
        client_id, dedupe_key, channel, provider, thread_ref, contact_ref, status,
        model_classify, model_reply, reply_text, media_json, error, next_action, metadata,
        sent_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb,
        case when $7 = 'sent' then now() else null end
      )
      on conflict (client_id, dedupe_key) do update set
        channel = excluded.channel,
        provider = coalesce(nullif(excluded.provider, ''), reply_jobs.provider),
        thread_ref = coalesce(nullif(excluded.thread_ref, ''), reply_jobs.thread_ref),
        contact_ref = coalesce(nullif(excluded.contact_ref, ''), reply_jobs.contact_ref),
        status = case when reply_jobs.status = 'sent' then reply_jobs.status else excluded.status end,
        model_classify = coalesce(nullif(excluded.model_classify, ''), reply_jobs.model_classify),
        model_reply = coalesce(nullif(excluded.model_reply, ''), reply_jobs.model_reply),
        reply_text = coalesce(nullif(excluded.reply_text, ''), reply_jobs.reply_text),
        media_json = case when excluded.media_json = '[]'::jsonb then reply_jobs.media_json else excluded.media_json end,
        error = coalesce(nullif(excluded.error, ''), reply_jobs.error),
        next_action = coalesce(nullif(excluded.next_action, ''), reply_jobs.next_action),
        metadata = reply_jobs.metadata || excluded.metadata,
        sent_at = case when reply_jobs.sent_at is not null then reply_jobs.sent_at when excluded.status = 'sent' then now() else null end,
        updated_at = now()
      returning *`,
    [
      clientId(),
      dedupeKey,
      input.channel || "",
      input.provider || "",
      input.threadRef || "",
      input.contactRef || "",
      status,
      input.modelClassify || "",
      input.modelReply || "",
      input.replyText || "",
      JSON.stringify(input.mediaJson || []),
      input.error || "",
      input.nextAction || "",
      JSON.stringify(input.metadata || {}),
    ],
  );
  return result.rows[0] ? mapReplyJob(result.rows[0]) : null;
}

export async function readReplyJobByDedupeKeyFromDatabase(dedupeKey: string): Promise<ReplyJobRecord | null> {
  const key = dedupeKey.trim();
  if (!key || !await tableReady("reply_jobs")) return null;
  const result = await getPool().query(
    `select *
       from reply_jobs
      where client_id = $1
        and dedupe_key = $2
      limit 1`,
    [clientId(), key],
  );
  return result.rows[0] ? mapReplyJob(result.rows[0]) : null;
}

export async function upsertThreadSummaryInDatabase(input: {
  threadRef: string;
  channel?: string;
  summary: string;
  lastMessageAt?: string;
  messageCount?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.threadRef.trim() || !await tableReady("thread_summaries")) return;
  await ensureClientInDatabase();
  await getPool().query(
    `insert into thread_summaries (
        client_id, thread_ref, channel, summary, last_message_at, message_count, model, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      on conflict (client_id, thread_ref) do update set
        channel = coalesce(nullif(excluded.channel, ''), thread_summaries.channel),
        summary = excluded.summary,
        last_message_at = excluded.last_message_at,
        message_count = excluded.message_count,
        model = coalesce(nullif(excluded.model, ''), thread_summaries.model),
        metadata = thread_summaries.metadata || excluded.metadata,
        updated_at = now()`,
    [
      clientId(),
      input.threadRef,
      input.channel || "",
      input.summary,
      input.lastMessageAt || null,
      input.messageCount || 0,
      input.model || "",
      JSON.stringify(input.metadata || {}),
    ],
  );
}

export async function readToolResultCacheFromDatabase(cacheKey: string): Promise<Record<string, unknown> | null> {
  const key = cacheKey.trim();
  if (!key || !await tableReady("tool_result_cache")) return null;
  const result = await getPool().query(
    `select result_json
       from tool_result_cache
      where client_id = $1
        and cache_key = $2
        and (expires_at is null or expires_at > now())
      limit 1`,
    [clientId(), key],
  );
  return result.rows[0] ? jsonRecordFromDb(result.rows[0].result_json) : null;
}

export async function upsertToolResultCacheInDatabase(input: {
  cacheKey: string;
  toolName?: string;
  result: Record<string, unknown>;
  expiresAt?: string;
}): Promise<void> {
  if (!input.cacheKey.trim() || !await tableReady("tool_result_cache")) return;
  await ensureClientInDatabase();
  await getPool().query(
    `insert into tool_result_cache (client_id, cache_key, tool_name, result_json, expires_at)
     values ($1, $2, $3, $4::jsonb, $5)
     on conflict (client_id, cache_key) do update set
       tool_name = coalesce(nullif(excluded.tool_name, ''), tool_result_cache.tool_name),
       result_json = excluded.result_json,
       expires_at = excluded.expires_at,
       updated_at = now()`,
    [clientId(), input.cacheKey, input.toolName || "", JSON.stringify(input.result), input.expiresAt || null],
  );
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
