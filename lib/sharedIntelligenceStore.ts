import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import { clientId } from "@/lib/database";
import type { Channel } from "@/lib/inboxData";
import {
  emptyConversationState,
  reduceConversationState,
  type ConversationTurn,
  type SharedConversationState,
} from "@/lib/sharedIntelligence";

let poolInstance: Pool | null = null;

function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return poolInstance;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function conversationSubjectKey(input: {
  email?: string;
  phone?: string;
  fullName?: string;
  threadRef?: string;
}, tenantId = clientId()): string {
  const identity = clean(input.email) || clean(input.phone).replace(/\D/g, "") || clean(input.fullName) || clean(input.threadRef) || "anonymous";
  return createHash("sha256").update(`${tenantId}:${identity}`).digest("hex");
}

function normalizeState(value: unknown, tenantId: string, subjectKey: string): SharedConversationState {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<SharedConversationState>
    : {};
  const empty = emptyConversationState(tenantId, subjectKey);
  return {
    ...empty,
    ...record,
    tenantId,
    subjectKey,
    schemaVersion: 1,
    activeJourneys: Array.isArray(record.activeJourneys) ? record.activeJourneys : [],
    channels: Array.isArray(record.channels) ? record.channels : [],
    threadRefs: Array.isArray(record.threadRefs) ? record.threadRefs : [],
    properties: Array.isArray(record.properties) ? record.properties : [],
    requirements: record.requirements && typeof record.requirements === "object" ? record.requirements : {},
    consent: record.consent && typeof record.consent === "object" ? record.consent : { doNotContact: false },
    safetyFlags: Array.isArray(record.safetyFlags) ? record.safetyFlags : [],
  } as SharedConversationState;
}

async function readState(connection: PoolClient, tenantId: string, subjectKey: string): Promise<SharedConversationState | null> {
  const result = await connection.query(
    `select state_json
       from conversation_states
      where client_id = $1 and subject_key = $2`,
    [tenantId, subjectKey],
  );
  return result.rows[0] ? normalizeState(result.rows[0].state_json, tenantId, subjectKey) : null;
}

export async function loadConversationState(subjectKey: string): Promise<SharedConversationState | null> {
  if (!process.env.DATABASE_URL || !subjectKey) return null;
  const tenantId = clientId();
  const result = await pool().query(
    `select state_json
       from conversation_states
      where client_id = $1 and subject_key = $2`,
    [tenantId, subjectKey],
  );
  return result.rows[0] ? normalizeState(result.rows[0].state_json, tenantId, subjectKey) : null;
}

export async function rememberConversationTurn(input: {
  channel: Channel | string;
  threadRef: string;
  message: string;
  email?: string;
  phone?: string;
  fullName?: string;
  propertyInterest?: string;
  intent?: string;
  leadRole?: string;
  doNotContact?: boolean;
}): Promise<SharedConversationState | null> {
  if (!process.env.DATABASE_URL) return null;
  const tenantId = clientId();
  const subjectKey = conversationSubjectKey(input, tenantId);
  const connection = await pool().connect();
  try {
    await connection.query("begin");
    await connection.query("select pg_advisory_xact_lock(hashtext($1))", [`conversation:${tenantId}:${subjectKey}`]);
    const current = await readState(connection, tenantId, subjectKey);
    const turn: ConversationTurn = {
      tenantId,
      subjectKey,
      channel: input.channel,
      threadRef: input.threadRef,
      message: input.message,
      propertyInterest: input.propertyInterest,
      intent: input.intent,
      leadRole: input.leadRole,
      doNotContact: input.doNotContact,
    };
    const next = reduceConversationState(current, turn);
    await connection.query(
      `insert into conversation_states
         (client_id, subject_key, version, active_journeys, state_json, updated_at)
       values ($1, $2, $3, $4::text[], $5::jsonb, now())
       on conflict (client_id, subject_key) do update set
         version = excluded.version,
         active_journeys = excluded.active_journeys,
         state_json = excluded.state_json,
         updated_at = now()`,
      [tenantId, subjectKey, next.version, next.activeJourneys, JSON.stringify(next)],
    );
    await connection.query("commit");
    return next;
  } catch (error) {
    await connection.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
