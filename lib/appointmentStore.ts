import { Pool } from "pg";

import { clientId } from "@/lib/database";

export type AppointmentType = "showing" | "consultation" | "listing_appt" | "follow_up" | "callback";
export type AppointmentStatus = "confirmed" | "cancelled" | "rescheduled" | "completed" | "no_show";

export type AppointmentRecord = {
  id: string;
  client_id: string;
  caller_phone: string;
  caller_name: string;
  caller_email: string;
  appointment_type: AppointmentType;
  property_address: string;
  scheduled_at: string;
  scheduled_at_local: string;
  duration_minutes: number;
  status: AppointmentStatus;
  ghl_event_id: string;
  google_event_id: string;
  booked_via_channel: string;
  call_id: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type CreateAppointmentInput = {
  caller_phone: string;
  caller_name?: string;
  caller_email?: string;
  appointment_type?: AppointmentType | string;
  property_address?: string;
  scheduled_at: string;
  scheduled_at_local?: string;
  duration_minutes?: number;
  ghl_event_id?: string;
  google_event_id?: string;
  booked_via_channel: string;
  call_id?: string;
  notes?: string;
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

function normalizePhoneForLike(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function normalizeAppointmentType(value?: string): AppointmentType {
  if (value === "consultation" || value === "listing_appt" || value === "follow_up" || value === "callback") return value;
  return "showing";
}

export async function createAppointment(input: CreateAppointmentInput): Promise<AppointmentRecord> {
  const result = await pool().query(
    `insert into appointments (
       client_id, caller_phone, caller_name, caller_email,
       appointment_type, property_address, scheduled_at, scheduled_at_local,
       duration_minutes, status, ghl_event_id, google_event_id,
       booked_via_channel, call_id, notes
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13,$14)
     returning *`,
    [
      clientId(),
      input.caller_phone,
      input.caller_name || "",
      input.caller_email || "",
      normalizeAppointmentType(input.appointment_type),
      input.property_address || "",
      input.scheduled_at,
      input.scheduled_at_local || input.scheduled_at,
      input.duration_minutes || 30,
      input.ghl_event_id || "",
      input.google_event_id || "",
      input.booked_via_channel,
      input.call_id || "",
      input.notes || "",
    ],
  );
  return result.rows[0] as AppointmentRecord;
}

export async function findUpcomingAppointmentByPhone(phone: string): Promise<AppointmentRecord | null> {
  const normalized = normalizePhoneForLike(phone);
  if (!normalized) return null;
  const result = await pool().query(
    `select *
       from appointments
      where client_id = $1
        and regexp_replace(caller_phone, '\\D', '', 'g') like '%' || $2
        and status = 'confirmed'
        and scheduled_at > now()
      order by scheduled_at asc
      limit 1`,
    [clientId(), normalized],
  );
  return (result.rows[0] as AppointmentRecord) || null;
}

export async function findAppointmentsByPhone(phone: string, limit = 5): Promise<AppointmentRecord[]> {
  const normalized = normalizePhoneForLike(phone);
  if (!normalized) return [];
  const result = await pool().query(
    `select *
       from appointments
      where client_id = $1
        and regexp_replace(caller_phone, '\\D', '', 'g') like '%' || $2
      order by scheduled_at desc
      limit $3`,
    [clientId(), normalized, Math.max(1, limit)],
  );
  return result.rows as AppointmentRecord[];
}

export async function findAppointmentById(id: string): Promise<AppointmentRecord | null> {
  if (!id) return null;
  const result = await pool().query(
    `select * from appointments where id = $1 and client_id = $2`,
    [id, clientId()],
  );
  return (result.rows[0] as AppointmentRecord) || null;
}

export async function cancelAppointmentById(id: string): Promise<boolean> {
  if (!id) return false;
  const result = await pool().query(
    `update appointments
        set status = 'cancelled', updated_at = now()
      where id = $1 and client_id = $2`,
    [id, clientId()],
  );
  return (result.rowCount || 0) > 0;
}

export async function rescheduleAppointmentById(
  id: string,
  newScheduledAt: string,
  newScheduledAtLocal: string,
  newGhlEventId?: string,
): Promise<AppointmentRecord | null> {
  if (!id) return null;
  const result = await pool().query(
    `update appointments
        set status = 'rescheduled',
            scheduled_at = $3,
            scheduled_at_local = $4,
            ghl_event_id = coalesce(nullif($5, ''), ghl_event_id),
            updated_at = now()
      where id = $1 and client_id = $2
      returning *`,
    [id, clientId(), newScheduledAt, newScheduledAtLocal, newGhlEventId || ""],
  );
  return (result.rows[0] as AppointmentRecord) || null;
}

export function formatAppointmentForAgent(appt: AppointmentRecord): string {
  const when = appt.scheduled_at_local || appt.scheduled_at;
  const what = appt.appointment_type === "showing" ? "Showing"
    : appt.appointment_type === "callback" ? "Callback"
    : "Appointment";
  const where = appt.property_address ? ` at ${appt.property_address}` : "";
  const via = appt.booked_via_channel ? ` (booked via ${appt.booked_via_channel})` : "";
  return `${what}${where} - ${when}${via} [${appt.status}]`;
}
