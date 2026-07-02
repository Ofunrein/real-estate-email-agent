// GoHighLevel CRM adapter — the first concrete CrmAdapter (CRM_PROVIDER=ghl).
// Endpoints verified against GoHighLevel's public OpenAPI (highlevel-api-docs):
//   POST   /contacts/upsert
//   GET    /contacts/search/duplicate?locationId&number&email
//   GET    /contacts/{contactId}/appointments
//   POST   /calendars/events/appointments        (req: calendarId, locationId, contactId, startTime)
//   PUT    /calendars/events/appointments/{eventId}
//   DELETE /calendars/events/{eventId}
//   POST   /conversations/messages
//
// The HTTP layer is injectable (GhlRequest) so the adapter is unit-testable
// without network access.

import type {
  CrmAdapter,
  CrmAppointment,
  CrmAppointmentInput,
  CrmAppointmentUpdate,
  CrmContact,
  CrmContactInput,
  CrmImportedLead,
  CrmImportAdapter,
  CrmLeadImportCursor,
  CrmActivity,
  CrmCustomFieldValue,
} from "@/lib/crm/types";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2023-02-21";

export type GhlConfig = {
  token: string;
  locationId: string;
  apiBase?: string;
  version?: string;
  contactTag?: string;
  messageType?: string;
};

export type GhlRequest = (
  pathname: string,
  method: string,
  body?: unknown,
  query?: Record<string, string | undefined>,
) => Promise<Record<string, unknown>>;

function buildQuery(query?: Record<string, string | undefined>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function realRequest(config: GhlConfig): GhlRequest {
  const base = config.apiBase || GHL_API_BASE;
  const version = config.version || GHL_VERSION;
  return async (pathname, method, body, query) => {
    const response = await fetch(`${base}${pathname}${buildQuery(query)}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Version: version,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GHL ${method} ${pathname} failed: ${response.status} ${text}`);
    }
    return (await response.json().catch(() => ({}))) as Record<string, unknown>;
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function splitName(input: CrmContactInput): { firstName?: string; lastName?: string; name?: string } {
  if (input.firstName || input.lastName) {
    return { firstName: input.firstName, lastName: input.lastName, name: input.fullName };
  }
  const full = (input.fullName || "").trim();
  if (!full) return {};
  const [firstName, ...rest] = full.split(/\s+/);
  return { firstName, lastName: rest.join(" ") || undefined, name: full };
}

function toContact(raw: Record<string, unknown>): CrmContact {
  const contact = asObject(raw.contact || raw);
  return {
    id: String(contact.id || ""),
    firstName: contact.firstName ? String(contact.firstName) : undefined,
    lastName: contact.lastName ? String(contact.lastName) : undefined,
    fullName: contact.contactName ? String(contact.contactName) : contact.name ? String(contact.name) : undefined,
    email: contact.email ? String(contact.email) : undefined,
    phone: contact.phone ? String(contact.phone) : undefined,
    tags: Array.isArray(contact.tags) ? contact.tags.map(String) : undefined,
    source: contact.source ? String(contact.source) : undefined,
  };
}

function toImportedLead(raw: Record<string, unknown>): CrmImportedLead {
  const contact = asObject(raw.contact || raw);
  const firstName = contact.firstName ? String(contact.firstName) : undefined;
  const lastName = contact.lastName ? String(contact.lastName) : undefined;
  return {
    ...toContact(contact),
    sourceId: contact.id ? String(contact.id) : undefined,
    firstName,
    lastName,
    fullName: contact.contactName ? String(contact.contactName) : contact.name ? String(contact.name) : [firstName, lastName].filter(Boolean).join(" ") || undefined,
    stage: contact.pipelineStage ? String(contact.pipelineStage) : contact.status ? String(contact.status) : undefined,
    owner: contact.assignedTo ? String(contact.assignedTo) : contact.owner ? String(contact.owner) : undefined,
    notes: contact.lastNote ? String(contact.lastNote) : undefined,
    updatedAt: contact.dateUpdated ? String(contact.dateUpdated) : contact.updatedAt ? String(contact.updatedAt) : undefined,
    raw: contact,
  };
}


export function buildGhlCustomFieldsPayload(fields: CrmCustomFieldValue[]): { customFields: Array<Record<string, string>> } {
  return {
    customFields: fields
      .filter((field) => (field.id || field.key) && field.fieldValue.trim())
      .map((field) => ({
        ...(field.id ? { id: field.id } : { key: field.key || "" }),
        fieldValue: field.fieldValue,
      })),
  };
}

function toAppointment(raw: Record<string, unknown>): CrmAppointment {
  const event = asObject(raw.event || raw.appointment || raw);
  return {
    id: String(event.id || event.appointmentId || ""),
    calendarId: event.calendarId ? String(event.calendarId) : undefined,
    contactId: String(event.contactId || ""),
    title: event.title ? String(event.title) : undefined,
    startTime: String(event.startTime || ""),
    endTime: event.endTime ? String(event.endTime) : undefined,
    status: event.appointmentStatus ? String(event.appointmentStatus) : undefined,
    address: event.address ? String(event.address) : undefined,
    notes: event.notes ? String(event.notes) : undefined,
  };
}

export function createGhlAdapter(config: GhlConfig, request: GhlRequest = realRequest(config)): CrmAdapter & CrmImportAdapter {
  const locationId = config.locationId;

  async function findDuplicate(params: { number?: string; email?: string }): Promise<CrmContact | null> {
    const raw = await request("/contacts/search/duplicate", "GET", undefined, {
      locationId,
      number: params.number,
      email: params.email,
    });
    const contact = asObject(raw.contact);
    return contact.id ? toContact(raw) : null;
  }

  return {
    provider: "ghl",

    findContactByPhone(phone) {
      return findDuplicate({ number: phone });
    },

    findContactByEmail(email) {
      return findDuplicate({ email });
    },

    async upsertContact(input) {
      const raw = await request("/contacts/upsert", "POST", {
        locationId,
        ...splitName(input),
        email: input.email || undefined,
        phone: input.phone || undefined,
        source: input.source || "lumenosis_agent_os",
        tags: input.tags && input.tags.length ? input.tags : [config.contactTag || "lumenosis-agent-os"],
      });
      return toContact(raw);
    },

    async listImportableLeads(input: CrmLeadImportCursor = {}) {
      const raw = await request("/contacts/", "GET", undefined, {
        locationId,
        limit: String(input.limit || 100),
        startAfterId: input.cursor,
        updatedAfter: input.updatedAfter,
        query: undefined,
      });
      const contacts = Array.isArray(raw.contacts) ? raw.contacts : Array.isArray(raw.items) ? raw.items : [];
      const nextCursor = raw.nextPageUrl
        ? String(raw.nextPageUrl)
        : raw.startAfterId
          ? String(raw.startAfterId)
          : raw.nextCursor
            ? String(raw.nextCursor)
            : undefined;
      return {
        leads: contacts.map((contact) => toImportedLead(asObject(contact))),
        nextCursor,
      };
    },

    async listAppointments(contactId) {
      const raw = await request(`/contacts/${encodeURIComponent(contactId)}/appointments`, "GET");
      const events = Array.isArray(raw.events) ? raw.events : Array.isArray(raw.appointments) ? raw.appointments : [];
      return events.map((event) => toAppointment(asObject(event)));
    },

    async createAppointment(input: CrmAppointmentInput) {
      const raw = await request("/calendars/events/appointments", "POST", {
        calendarId: input.calendarId,
        locationId,
        contactId: input.contactId,
        startTime: input.startTime,
        endTime: input.endTime,
        title: input.title,
        address: input.address,
        meetingLocationType: input.address ? "custom" : undefined,
        appointmentStatus: "confirmed",
      });
      return toAppointment(raw);
    },

    async updateAppointment(appointmentId: string, update: CrmAppointmentUpdate) {
      const raw = await request(`/calendars/events/appointments/${encodeURIComponent(appointmentId)}`, "PUT", {
        startTime: update.startTime,
        endTime: update.endTime,
        title: update.title,
        address: update.address,
        appointmentStatus: update.status,
      });
      return toAppointment(raw);
    },

    async cancelAppointment(appointmentId: string) {
      await request(`/calendars/events/${encodeURIComponent(appointmentId)}`, "DELETE");
    },

    async logActivity(activity: CrmActivity) {
      await request("/conversations/messages", "POST", {
        locationId,
        contactId: activity.contactId,
        type: config.messageType || "InternalComment",
        message: activity.body,
      });
    },

    async updateContactCustomFields(contactId: string, fields: CrmCustomFieldValue[]) {
      const payload = buildGhlCustomFieldsPayload(fields);
      if (!payload.customFields.length) return;
      await request(`/contacts/${encodeURIComponent(contactId)}`, "PUT", payload);
    },
  };
}
