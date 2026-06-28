import { randomUUID } from "node:crypto";

import { Pool } from "pg";

let pool: Pool | null = null;

function databaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function clientId(): string {
  return process.env.CLIENT_ID || "default";
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for request audit writes");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

const SECRET_KEY_RE = /(token|secret|password|authorization|cookie|key|signature|access_token|refresh_token|bearer|credential|session)/i;
const URL_KEY_RE = /(url|uri|href|link|media)/i;

export type RequestAuditInput = {
  requestId?: string;
  route: string;
  method?: string;
  channel?: string;
  provider?: string;
  threadRef?: string;
  contactRef?: string;
  providerMessageId?: string;
  stage: string;
  outcome: string;
  statusCode?: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export type RequestAuditRecord = Required<Omit<RequestAuditInput, "metadata" | "statusCode" | "durationMs">> & {
  id: string;
  statusCode: number | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type RequestAuditQuery = {
  channel?: string;
  threadRef?: string;
  outcome?: string;
  errorsOnly?: boolean;
  requestId?: string;
  since?: string;
  limit?: number;
};

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return truncate(url.toString(), 300);
  } catch {
    return truncate(value, 300);
  }
}

export function redactAuditMetadata(input: unknown, keyPath = ""): unknown {
  if (input == null) return input;
  if (input instanceof Date) return input.toISOString();
  if (typeof input === "string") {
    if (SECRET_KEY_RE.test(keyPath)) return "[redacted]";
    if (URL_KEY_RE.test(keyPath) && /^https?:\/\//i.test(input)) return sanitizeUrl(input);
    return truncate(input);
  }
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (Array.isArray(input)) {
    return input.slice(0, 20).map((item, index) => redactAuditMetadata(item, `${keyPath}.${index}`));
  }
  if (typeof input === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 80)) {
      const path = keyPath ? `${keyPath}.${key}` : key;
      output[key] = SECRET_KEY_RE.test(key) ? "[redacted]" : redactAuditMetadata(value, path);
    }
    return output;
  }
  return String(input);
}

function safeMetadata(input?: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactAuditMetadata(input || {});
  return redacted && typeof redacted === "object" && !Array.isArray(redacted)
    ? redacted as Record<string, unknown>
    : {};
}

export function requestIdFromHeaders(headers?: Headers | null): string {
  return (
    headers?.get("x-vercel-id") ||
    headers?.get("x-request-id") ||
    headers?.get("x-lumenosis-request-id") ||
    randomUUID()
  );
}

export async function writeRequestAuditEvent(input: RequestAuditInput): Promise<void> {
  const row = {
    requestId: input.requestId || randomUUID(),
    route: input.route,
    method: input.method || "",
    channel: input.channel || "",
    provider: input.provider || "",
    threadRef: input.threadRef || "",
    contactRef: input.contactRef || "",
    providerMessageId: input.providerMessageId || "",
    stage: input.stage,
    outcome: input.outcome,
    statusCode: input.statusCode ?? null,
    durationMs: input.durationMs ?? null,
    errorCode: input.errorCode || "",
    errorMessage: truncate(input.errorMessage || "", 500),
    metadata: safeMetadata(input.metadata),
  };

  if (!databaseEnabled()) {
    console.info("[request-audit]", row);
    return;
  }

  try {
    await getPool().query(
      `insert into request_audit_events (
          client_id, request_id, route, method, channel, provider, thread_ref,
          contact_ref, provider_message_id, stage, outcome, status_code,
          duration_ms, error_code, error_message, metadata
        ) values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15, $16::jsonb
        )`,
      [
        clientId(),
        row.requestId,
        row.route,
        row.method,
        row.channel,
        row.provider,
        row.threadRef,
        row.contactRef,
        row.providerMessageId,
        row.stage,
        row.outcome,
        row.statusCode,
        row.durationMs,
        row.errorCode,
        row.errorMessage,
        JSON.stringify(row.metadata),
      ],
    );
  } catch (error) {
    console.warn("[request-audit] write failed", error instanceof Error ? error.message : error);
  }
}

export function createRequestAudit(input: Omit<RequestAuditInput, "stage" | "outcome" | "durationMs"> & { headers?: Headers | null }) {
  const startedAt = Date.now();
  const requestId = input.requestId || requestIdFromHeaders(input.headers);
  const base = {
    requestId,
    route: input.route,
    method: input.method || "",
    channel: input.channel || "",
    provider: input.provider || "",
    threadRef: input.threadRef || "",
    contactRef: input.contactRef || "",
    providerMessageId: input.providerMessageId || "",
  };
  return {
    requestId,
    write(stage: string, outcome: string, details: Partial<RequestAuditInput> = {}) {
      return writeRequestAuditEvent({
        ...base,
        ...details,
        requestId,
        stage,
        outcome,
        durationMs: Date.now() - startedAt,
      });
    },
  };
}

function auditRecordFromRow(row: Record<string, unknown>): RequestAuditRecord {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  return {
    id: String(row.id || ""),
    requestId: String(row.request_id || ""),
    route: String(row.route || ""),
    method: String(row.method || ""),
    channel: String(row.channel || ""),
    provider: String(row.provider || ""),
    threadRef: String(row.thread_ref || ""),
    contactRef: String(row.contact_ref || ""),
    providerMessageId: String(row.provider_message_id || ""),
    stage: String(row.stage || ""),
    outcome: String(row.outcome || ""),
    statusCode: row.status_code == null ? null : Number(row.status_code),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    errorCode: String(row.error_code || ""),
    errorMessage: String(row.error_message || ""),
    metadata,
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : "",
  };
}

export async function readRequestAuditEvents(input: RequestAuditQuery = {}): Promise<RequestAuditRecord[]> {
  if (!databaseEnabled()) return [];
  const where = ["client_id = $1"];
  const values: unknown[] = [clientId()];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  };
  if (input.channel) add("channel = ?", input.channel);
  if (input.threadRef) add("thread_ref = ?", input.threadRef);
  if (input.outcome) add("outcome = ?", input.outcome);
  if (input.requestId) add("request_id = ?", input.requestId);
  if (input.since) add("created_at >= ?::timestamptz", input.since);
  if (input.errorsOnly) where.push("(outcome = 'failed' or status_code >= 400 or error_message <> '')");
  const limit = Math.max(1, Math.min(Number(input.limit || 100) || 100, 500));
  try {
    const result = await getPool().query(
      `select id, request_id, route, method, channel, provider, thread_ref,
              contact_ref, provider_message_id, stage, outcome, status_code,
              duration_ms, error_code, error_message, metadata, created_at
         from request_audit_events
        where ${where.join(" and ")}
        order by created_at desc
        limit ${limit}`,
      values,
    );
    return result.rows.map(auditRecordFromRow);
  } catch (error) {
    console.warn("[request-audit] read failed", error instanceof Error ? error.message : error);
    return [];
  }
}
