import { Pool } from "pg";

import { clientId } from "@/lib/database";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadIdentity";

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

export type ContactStatus = "new" | "hot" | "nurture" | "showing" | "seller" | "closed" | "do_not_contact";

export type ContactInput = {
  id?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  emails?: string[];
  phones?: string[];
  company?: string;
  source?: string;
  leadSource?: string;
  leadStatus?: string;
  assignedUserId?: string;
  propertyInterest?: string;
  buyerSellerRenter?: string;
  budget?: string;
  timeline?: string;
  doNotContact?: boolean;
  customFields?: Record<string, unknown>;
  rawProviderPayload?: Record<string, unknown>;
};

export type ContactRecord = {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  company: string;
  lead_status: string;
  source: string;
  lead_source: string;
  assigned_user_id: string;
  property_interest: string;
  buyer_seller_renter: string;
  budget: string;
  timeline: string;
  do_not_contact: boolean;
  last_activity_at: string;
  deleted_at: string;
  created_at: string;
  updated_at: string;
  emails: string[];
  phones: string[];
  tags: string[];
};

export type ContactTimelineEvent = {
  id: string;
  contact_id: string;
  event_type: string;
  event_at: string;
  title: string;
  body: string;
  source: string;
  source_id: string;
};

export function contactDedupeKeys(input: ContactInput): string[] {
  const keys = new Set<string>();
  for (const email of input.emails || []) {
    const normalized = normalizeEmail(email);
    if (normalized) keys.add(`email:${normalized}`);
  }
  for (const phone of input.phones || []) {
    const normalized = normalizePhone(phone);
    if (normalized) keys.add(`phone:${normalized}`);
  }
  if (!keys.size) {
    const name = normalizeName(input.fullName || [input.firstName, input.lastName].filter(Boolean).join(" "));
    const company = normalizeName(input.company);
    if (name) keys.add(`name:${name}${company ? `@${company}` : ""}`);
  }
  return [...keys];
}

export function normalizeContactInput(input: ContactInput): Required<Pick<ContactInput,
  "fullName" | "firstName" | "lastName" | "company" | "source" | "leadSource" | "leadStatus" | "assignedUserId" | "propertyInterest" | "buyerSellerRenter" | "budget" | "timeline"
>> & Pick<ContactInput, "doNotContact" | "customFields" | "rawProviderPayload"> & { emails: string[]; phones: string[] } {
  const fullName = (input.fullName || [input.firstName, input.lastName].filter(Boolean).join(" ")).trim().replace(/\s+/g, " ");
  const [firstFallback, ...lastParts] = fullName.split(/\s+/).filter(Boolean);
  return {
    fullName,
    firstName: (input.firstName || firstFallback || "").trim(),
    lastName: (input.lastName || lastParts.join(" ")).trim(),
    emails: [...new Set((input.emails || []).map(normalizeEmail).filter(Boolean))],
    phones: [...new Set((input.phones || []).map(normalizePhone).filter(Boolean))],
    company: (input.company || "").trim(),
    source: (input.source || "").trim(),
    leadSource: (input.leadSource || "").trim(),
    leadStatus: (input.leadStatus || (input.doNotContact ? "do_not_contact" : "new")).trim(),
    assignedUserId: (input.assignedUserId || "").trim(),
    propertyInterest: (input.propertyInterest || "").trim(),
    buyerSellerRenter: (input.buyerSellerRenter || "").trim(),
    budget: (input.budget || "").trim(),
    timeline: (input.timeline || "").trim(),
    doNotContact: Boolean(input.doNotContact),
    customFields: input.customFields || {},
    rawProviderPayload: input.rawProviderPayload || {},
  };
}

export function mergeContactInputs(primary: ContactInput, secondary: ContactInput): ContactInput {
  return {
    ...secondary,
    ...primary,
    emails: [...new Set([...(primary.emails || []), ...(secondary.emails || [])].map(normalizeEmail).filter(Boolean))],
    phones: [...new Set([...(primary.phones || []), ...(secondary.phones || [])].map(normalizePhone).filter(Boolean))],
    customFields: { ...(secondary.customFields || {}), ...(primary.customFields || {}) },
    rawProviderPayload: { ...(secondary.rawProviderPayload || {}), ...(primary.rawProviderPayload || {}) },
    doNotContact: Boolean(primary.doNotContact || secondary.doNotContact),
  };
}

async function findExistingContactId(input: ContactInput): Promise<string | null> {
  const keys = contactDedupeKeys(input);
  if (!keys.length) return null;
  const result = await pool().query(
    `select contact_id
       from contact_identities
      where client_id = $1
        and identity_type || ':' || identity_value = any($2::text[])
      order by confidence desc
      limit 1`,
    [clientId(), keys],
  );
  return result.rows[0]?.contact_id || null;
}

async function upsertContactIdentities(contactId: string, input: ContactInput): Promise<void> {
  for (const key of contactDedupeKeys(input)) {
    const [identityType, ...rest] = key.split(":");
    const identityValue = rest.join(":");
    await pool().query(
      `insert into contact_identities (client_id, contact_id, identity_type, identity_value, confidence, source)
       values ($1,$2,$3,$4,1,$5)
       on conflict (client_id, identity_type, identity_value) do update set
         contact_id = excluded.contact_id,
         confidence = greatest(contact_identities.confidence, excluded.confidence)`,
      [clientId(), contactId, identityType, identityValue, input.source || ""],
    );
  }
}

async function upsertContactChannels(contactId: string, input: ContactInput): Promise<void> {
  const normalized = normalizeContactInput(input);
  for (const email of normalized.emails) {
    await pool().query(
      `insert into contact_emails (client_id, contact_id, email, is_primary)
       values ($1,$2,$3,$4)
       on conflict (client_id, lower(email)) do update set contact_id = excluded.contact_id`,
      [clientId(), contactId, email, true],
    );
  }
  for (const phone of normalized.phones) {
    await pool().query(
      `insert into contact_phones (client_id, contact_id, phone, normalized_phone, is_primary)
       values ($1,$2,$3,$4,$5)
       on conflict (client_id, normalized_phone) do update set contact_id = excluded.contact_id`,
      [clientId(), contactId, phone, phone, true],
    );
  }
}

export async function upsertContact(input: ContactInput): Promise<ContactRecord> {
  const normalized = normalizeContactInput(input);
  const existingId = input.id || await findExistingContactId(input);
  const result = existingId
    ? await pool().query(
      `update contacts
          set full_name = coalesce(nullif($3,''), full_name),
              first_name = coalesce(nullif($4,''), first_name),
              last_name = coalesce(nullif($5,''), last_name),
              company = coalesce(nullif($6,''), company),
              lead_status = coalesce(nullif($7,''), lead_status),
              source = coalesce(nullif($8,''), source),
              lead_source = coalesce(nullif($9,''), lead_source),
              assigned_user_id = coalesce(nullif($10,''), assigned_user_id),
              property_interest = coalesce(nullif($11,''), property_interest),
              buyer_seller_renter = coalesce(nullif($12,''), buyer_seller_renter),
              budget = coalesce(nullif($13,''), budget),
              timeline = coalesce(nullif($14,''), timeline),
              do_not_contact = $15,
              custom_fields = custom_fields || $16::jsonb,
              raw_provider_payload = raw_provider_payload || $17::jsonb,
              updated_at = now()
        where client_id = $1 and id = $2
        returning *`,
      [
        clientId(),
        existingId,
        normalized.fullName,
        normalized.firstName,
        normalized.lastName,
        normalized.company,
        normalized.leadStatus,
        normalized.source,
        normalized.leadSource,
        normalized.assignedUserId,
        normalized.propertyInterest,
        normalized.buyerSellerRenter,
        normalized.budget,
        normalized.timeline,
        normalized.doNotContact,
        JSON.stringify(normalized.customFields),
        JSON.stringify(normalized.rawProviderPayload),
      ],
    )
    : await pool().query(
      `insert into contacts (
         client_id, full_name, first_name, last_name, company, lead_status,
         source, lead_source, assigned_user_id, property_interest, buyer_seller_renter,
         budget, timeline, do_not_contact, custom_fields, raw_provider_payload, last_activity_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,now())
       returning *`,
      [
        clientId(),
        normalized.fullName,
        normalized.firstName,
        normalized.lastName,
        normalized.company,
        normalized.leadStatus,
        normalized.source,
        normalized.leadSource,
        normalized.assignedUserId,
        normalized.propertyInterest,
        normalized.buyerSellerRenter,
        normalized.budget,
        normalized.timeline,
        normalized.doNotContact,
        JSON.stringify(normalized.customFields),
        JSON.stringify(normalized.rawProviderPayload),
      ],
    );
  const contactId = result.rows[0].id as string;
  await upsertContactIdentities(contactId, input);
  await upsertContactChannels(contactId, input);
  await addContactTimelineEvent(contactId, {
    eventType: existingId ? "contact_updated" : "contact_created",
    title: existingId ? "Contact updated" : "Contact created",
    body: normalized.source || normalized.leadSource || "",
    source: normalized.source || "mauro",
  });
  return getContact(contactId) as Promise<ContactRecord>;
}

export async function listContacts(input: {
  search?: string;
  status?: string;
  company?: string;
  includeDeleted?: boolean;
  limit?: number;
} = {}): Promise<ContactRecord[]> {
  const search = `%${(input.search || "").toLowerCase()}%`;
  const result = await pool().query(
    `select c.*,
            coalesce(array_agg(distinct ce.email) filter (where ce.email is not null), '{}') as emails,
            coalesce(array_agg(distinct cp.phone) filter (where cp.phone is not null), '{}') as phones,
            coalesce(array_agg(distinct t.label) filter (where t.label is not null), '{}') as tags
       from contacts c
       left join contact_emails ce on ce.client_id = c.client_id and ce.contact_id = c.id
       left join contact_phones cp on cp.client_id = c.client_id and cp.contact_id = c.id
       left join contact_tags ct on ct.client_id = c.client_id and ct.contact_id = c.id
       left join tags t on t.client_id = c.client_id and t.id = ct.tag_id
      where c.client_id = $1
        and ($2::boolean or c.deleted_at is null)
        and ($3 = '%%' or lower(c.full_name || ' ' || c.company || ' ' || coalesce(ce.email,'') || ' ' || coalesce(cp.phone,'')) like $3)
        and ($4 = '' or c.lead_status = $4)
        and ($5 = '' or lower(c.company) = lower($5))
      group by c.id
      order by coalesce(c.last_activity_at, c.updated_at, c.created_at) desc
      limit $6`,
    [clientId(), Boolean(input.includeDeleted), search, input.status || "", input.company || "", Math.min(Math.max(input.limit || 50, 1), 200)],
  );
  return result.rows as ContactRecord[];
}

export async function getContact(id: string): Promise<ContactRecord | null> {
  const result = await pool().query(
    `select c.*,
            coalesce(array_agg(distinct ce.email) filter (where ce.email is not null), '{}') as emails,
            coalesce(array_agg(distinct cp.phone) filter (where cp.phone is not null), '{}') as phones,
            coalesce(array_agg(distinct t.label) filter (where t.label is not null), '{}') as tags
       from contacts c
       left join contact_emails ce on ce.client_id = c.client_id and ce.contact_id = c.id
       left join contact_phones cp on cp.client_id = c.client_id and cp.contact_id = c.id
       left join contact_tags ct on ct.client_id = c.client_id and ct.contact_id = c.id
       left join tags t on t.client_id = c.client_id and t.id = ct.tag_id
      where c.client_id = $1 and c.id = $2
      group by c.id
      limit 1`,
    [clientId(), id],
  );
  return (result.rows[0] as ContactRecord) || null;
}

export async function softDeleteContact(id: string): Promise<boolean> {
  const result = await pool().query(
    `update contacts set deleted_at = now(), updated_at = now() where client_id = $1 and id = $2 and deleted_at is null`,
    [clientId(), id],
  );
  return (result.rowCount || 0) > 0;
}

export async function restoreContact(id: string): Promise<boolean> {
  const result = await pool().query(
    `update contacts set deleted_at = null, updated_at = now() where client_id = $1 and id = $2`,
    [clientId(), id],
  );
  return (result.rowCount || 0) > 0;
}

export async function addContactNote(contactId: string, body: string, createdBy = "") {
  const result = await pool().query(
    `insert into contact_notes (client_id, contact_id, body, created_by)
     values ($1,$2,$3,$4)
     returning *`,
    [clientId(), contactId, body, createdBy],
  );
  await addContactTimelineEvent(contactId, {
    eventType: "note_added",
    title: "Note added",
    body,
    source: "mauro",
    sourceId: result.rows[0].id,
  });
  return result.rows[0];
}

export async function addContactTimelineEvent(contactId: string, input: {
  eventType: string;
  title: string;
  body?: string;
  source?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<ContactTimelineEvent> {
  const result = await pool().query(
    `insert into contact_timeline_events (client_id, contact_id, event_type, title, body, source, source_id, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     returning *`,
    [clientId(), contactId, input.eventType, input.title, input.body || "", input.source || "", input.sourceId || "", JSON.stringify(input.metadata || {})],
  );
  await pool().query(
    `update contacts set last_activity_at = now(), updated_at = now() where client_id = $1 and id = $2`,
    [clientId(), contactId],
  );
  return result.rows[0] as ContactTimelineEvent;
}

export async function mergeContacts(primaryId: string, duplicateId: string): Promise<boolean> {
  if (!primaryId || !duplicateId || primaryId === duplicateId) return false;
  const db = await pool().connect();
  try {
    const cid = clientId();
    await db.query("begin");
    await db.query(
      `insert into contact_emails (client_id, contact_id, email, label, is_primary)
       select client_id, $3, email, label, is_primary
         from contact_emails
        where client_id = $1 and contact_id = $2
       on conflict (client_id, lower(email)) do update set contact_id = excluded.contact_id`,
      [cid, duplicateId, primaryId],
    );
    await db.query(
      `insert into contact_phones (client_id, contact_id, phone, normalized_phone, label, is_primary, sms_consent, call_consent)
       select client_id, $3, phone, normalized_phone, label, is_primary, sms_consent, call_consent
         from contact_phones
        where client_id = $1 and contact_id = $2
       on conflict (client_id, normalized_phone) do update set contact_id = excluded.contact_id`,
      [cid, duplicateId, primaryId],
    );
    await db.query(`delete from contact_emails where client_id = $1 and contact_id = $2`, [cid, duplicateId]);
    await db.query(`delete from contact_phones where client_id = $1 and contact_id = $2`, [cid, duplicateId]);
    await db.query(`update contact_notes set contact_id = $3 where client_id = $1 and contact_id = $2`, [cid, duplicateId, primaryId]);
    await db.query(`update contact_timeline_events set contact_id = $3 where client_id = $1 and contact_id = $2`, [cid, duplicateId, primaryId]);
    await db.query(
      `insert into appointment_contacts (client_id, appointment_id, contact_id, role)
       select client_id, appointment_id, $3, role
         from appointment_contacts
        where client_id = $1 and contact_id = $2
       on conflict (client_id, appointment_id, contact_id) do nothing`,
      [cid, duplicateId, primaryId],
    );
    await db.query(`delete from appointment_contacts where client_id = $1 and contact_id = $2`, [cid, duplicateId]);
    await db.query(`update appointments set contact_id = $3 where client_id = $1 and contact_id = $2`, [cid, duplicateId, primaryId]);
    await db.query(`update contact_identities set contact_id = $3 where client_id = $1 and contact_id = $2`, [cid, duplicateId, primaryId]);
    await db.query(`update contacts set deleted_at = now(), updated_at = now() where client_id = $1 and id = $2`, [cid, duplicateId]);
    await db.query(
      `insert into contact_timeline_events (client_id, contact_id, event_type, title, body, source, source_id)
       values ($1,$2,'contact_merged','Contact merged',$3,'mauro',$3)`,
      [cid, primaryId, duplicateId],
    );
    await db.query("commit");
    return true;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}
