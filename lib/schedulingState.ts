import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";

import { clientId } from "@/lib/database";

export type SchedulingStatus = "requested" | "availability_checked" | "slot_selected" | "confirmation_pending" | "confirmed" | "declined" | "expired";
export type SchedulingEvent = "availability_found" | "slot_selected" | "submitted" | "provider_verified" | "provider_declined" | "expire";

export type ProviderReceipt = {
  provider: string;
  eventId: string;
  start: string;
  end: string;
  readBackVerified: boolean;
  readBackAt: string;
  etag?: string;
};

export type SchedulingRequest = {
  id: string;
  clientId: string;
  idempotencyKey: string;
  channel: string;
  threadRef: string;
  status: SchedulingStatus;
  requestedStart: string;
  requestedEnd: string;
  timezone: string;
  propertyAddress: string;
  appointmentType: string;
  contactHash: string;
  provider: string;
  providerEventId: string;
  receiptVerifiedAt: string;
  providerReceipt: ProviderReceipt | null;
  errorCode: string;
};

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
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function schedulingRequestKey(input: {
  tenantId: string;
  channel: string;
  requestedStart: string;
  requestedEnd: string;
  contact: string;
  propertyAddress?: string;
  appointmentType?: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    tenantId: clean(input.tenantId),
    channel: clean(input.channel),
    requestedStart: clean(input.requestedStart),
    requestedEnd: clean(input.requestedEnd),
    contact: clean(input.contact).toLowerCase(),
    propertyAddress: clean(input.propertyAddress).toLowerCase(),
    appointmentType: clean(input.appointmentType),
  })).digest("hex");
}

export function transitionSchedulingState(status: SchedulingStatus, event: SchedulingEvent, receipt?: ProviderReceipt): SchedulingStatus {
  if (status === "confirmed" || status === "declined" || status === "expired") return status;
  if (event === "expire") return "expired";
  if (event === "provider_declined") return "declined";
  if (event === "availability_found" && status === "requested") return "availability_checked";
  if (event === "slot_selected" && ["requested", "availability_checked"].includes(status)) return "slot_selected";
  if (event === "submitted" && ["requested", "availability_checked", "slot_selected"].includes(status)) return "confirmation_pending";
  if (event === "provider_verified") {
    if (status !== "confirmation_pending") throw new Error("scheduling_provider_receipt_out_of_order");
    if (!receipt?.eventId || !receipt.readBackVerified || !receipt.readBackAt) throw new Error("scheduling_provider_receipt_unverified");
    if (!Number.isFinite(Date.parse(receipt.start)) || !Number.isFinite(Date.parse(receipt.end))) throw new Error("scheduling_provider_receipt_invalid_time");
    return "confirmed";
  }
  throw new Error(`invalid_scheduling_transition:${status}:${event}`);
}

function contactHash(value: string, tenantId: string): string {
  return createHash("sha256").update(`${tenantId}:${clean(value).toLowerCase()}`).digest("hex");
}

function rowToRequest(row: Record<string, unknown>): SchedulingRequest {
  return {
    id: clean(row.id),
    clientId: clean(row.client_id),
    idempotencyKey: clean(row.idempotency_key),
    channel: clean(row.channel),
    threadRef: clean(row.thread_ref),
    status: clean(row.status) as SchedulingStatus,
    requestedStart: new Date(String(row.requested_start)).toISOString(),
    requestedEnd: new Date(String(row.requested_end)).toISOString(),
    timezone: clean(row.timezone),
    propertyAddress: clean(row.property_address),
    appointmentType: clean(row.appointment_type),
    contactHash: clean(row.contact_hash),
    provider: clean(row.provider),
    providerEventId: clean(row.provider_event_id),
    receiptVerifiedAt: row.receipt_verified_at ? new Date(String(row.receipt_verified_at)).toISOString() : "",
    providerReceipt: row.provider_receipt && typeof row.provider_receipt === "object" ? row.provider_receipt as ProviderReceipt : null,
    errorCode: clean(row.error_code),
  };
}

export async function beginSchedulingRequest(input: {
  channel: string;
  threadRef: string;
  requestedStart: string;
  requestedEnd: string;
  timezone: string;
  contact: string;
  propertyAddress?: string;
  appointmentType?: string;
}): Promise<{ created: boolean; request: SchedulingRequest }> {
  const tenantId = clientId();
  const idempotencyKey = schedulingRequestKey({
    tenantId,
    channel: input.channel,
    requestedStart: input.requestedStart,
    requestedEnd: input.requestedEnd,
    contact: input.contact,
    propertyAddress: input.propertyAddress,
    appointmentType: input.appointmentType,
  });
  const fallback: SchedulingRequest = {
    id: randomUUID(),
    clientId: tenantId,
    idempotencyKey,
    channel: input.channel,
    threadRef: input.threadRef,
    status: "requested",
    requestedStart: input.requestedStart,
    requestedEnd: input.requestedEnd,
    timezone: input.timezone,
    propertyAddress: clean(input.propertyAddress),
    appointmentType: clean(input.appointmentType) || "showing",
    contactHash: contactHash(input.contact, tenantId),
    provider: "",
    providerEventId: "",
    receiptVerifiedAt: "",
    providerReceipt: null,
    errorCode: "",
  };
  if (!process.env.DATABASE_URL) return { created: true, request: fallback };
  const result = await pool().query(
    `insert into scheduling_requests (
       id, client_id, idempotency_key, channel, thread_ref, status,
       requested_start, requested_end, timezone, property_address,
       appointment_type, contact_hash
     ) values ($1,$2,$3,$4,$5,'requested',$6,$7,$8,$9,$10,$11)
     on conflict (client_id, idempotency_key) do nothing
     returning *`,
    [
      fallback.id,
      tenantId,
      idempotencyKey,
      input.channel,
      input.threadRef,
      input.requestedStart,
      input.requestedEnd,
      input.timezone,
      fallback.propertyAddress,
      fallback.appointmentType,
      fallback.contactHash,
    ],
  );
  if (result.rows[0]) return { created: true, request: rowToRequest(result.rows[0]) };
  const existing = await pool().query(
    `select * from scheduling_requests where client_id = $1 and idempotency_key = $2`,
    [tenantId, idempotencyKey],
  );
  if (!existing.rows[0]) throw new Error("scheduling_idempotency_read_failed");
  return { created: false, request: rowToRequest(existing.rows[0]) };
}

export async function advanceSchedulingRequest(
  request: SchedulingRequest,
  event: SchedulingEvent,
  input: { provider?: string; receipt?: ProviderReceipt; errorCode?: string } = {},
): Promise<SchedulingRequest> {
  const status = transitionSchedulingState(request.status, event, input.receipt);
  const next: SchedulingRequest = {
    ...request,
    status,
    provider: clean(input.provider) || request.provider,
    providerEventId: clean(input.receipt?.eventId) || request.providerEventId,
    receiptVerifiedAt: input.receipt?.readBackVerified ? input.receipt.readBackAt : request.receiptVerifiedAt,
    providerReceipt: input.receipt || request.providerReceipt,
    errorCode: clean(input.errorCode),
  };
  if (!process.env.DATABASE_URL) return next;
  const result = await pool().query(
    `update scheduling_requests
        set status = $3,
            provider = $4,
            provider_event_id = $5,
            provider_receipt = $6::jsonb,
            receipt_verified_at = $7,
            error_code = $8,
            updated_at = now()
      where id = $1 and client_id = $2
      returning *`,
    [
      request.id,
      clientId(),
      status,
      next.provider,
      next.providerEventId,
      JSON.stringify(next.providerReceipt || {}),
      next.receiptVerifiedAt || null,
      next.errorCode,
    ],
  );
  if (!result.rows[0]) throw new Error("scheduling_request_scope_mismatch");
  return rowToRequest(result.rows[0]);
}

export async function markSchedulingPending(request: SchedulingRequest, provider: string, errorCode = ""): Promise<SchedulingRequest> {
  if (request.status === "confirmation_pending") {
    if (!process.env.DATABASE_URL) return { ...request, provider, errorCode };
    const result = await pool().query(
      `update scheduling_requests
          set provider = $3, error_code = $4, updated_at = now()
        where id = $1 and client_id = $2
        returning *`,
      [request.id, clientId(), provider, errorCode],
    );
    if (!result.rows[0]) throw new Error("scheduling_request_scope_mismatch");
    return rowToRequest(result.rows[0]);
  }
  return advanceSchedulingRequest(request, "submitted", { provider, errorCode });
}

export async function verifiedSchedulingReceiptForEvent(providerEventId: string): Promise<ProviderReceipt | null> {
  const eventId = clean(providerEventId);
  if (!process.env.DATABASE_URL || !eventId) return null;
  const result = await pool().query(
    `select provider_receipt
       from scheduling_requests
      where client_id = $1
        and provider_event_id = $2
        and status = 'confirmed'
        and receipt_verified_at is not null
      order by receipt_verified_at desc
      limit 1`,
    [clientId(), eventId],
  );
  const receipt = result.rows[0]?.provider_receipt;
  return receipt && typeof receipt === "object" && receipt.readBackVerified === true
    ? receipt as ProviderReceipt
    : null;
}
