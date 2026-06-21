// CRM-agnostic adapter contract. GHL is the first live adapter (lib/crm/ghl.ts);
// Follow Up Boss / kvCORE / Lofty drop in behind this same interface later.
// Shapes are intentionally generic (not GHL-specific) so FUB's people/events
// and kvCORE's contacts map cleanly. All methods are async and return plain
// data the voice/SMS/email agents can act on.

export type CrmContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
};

export type CrmContactInput = {
  email?: string;
  phone?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  source?: string;
  tags?: string[];
};

export type CrmAppointment = {
  id: string;
  calendarId?: string;
  contactId: string;
  title?: string;
  startTime: string; // ISO 8601
  endTime?: string; // ISO 8601
  timezone?: string;
  status?: string; // confirmed | cancelled | ...
  address?: string;
  notes?: string;
};

export type CrmAppointmentInput = {
  calendarId?: string;
  contactId: string;
  startTime: string; // ISO 8601
  endTime?: string; // ISO 8601
  timezone?: string;
  title?: string;
  address?: string;
  notes?: string;
};

export type CrmAppointmentUpdate = {
  startTime?: string;
  endTime?: string;
  timezone?: string;
  title?: string;
  address?: string;
  notes?: string;
  status?: string;
};

export type CrmActivity = {
  contactId: string;
  body: string;
  channel?: string; // voice | sms | email | ...
  direction?: string; // inbound | outbound
  type?: string; // note | call | message ...
};

export type CrmLeadImportCursor = {
  limit?: number;
  cursor?: string;
  updatedAfter?: string;
};

export type CrmImportedLead = CrmContact & {
  sourceId?: string;
  stage?: string;
  owner?: string;
  notes?: string;
  raw?: Record<string, unknown>;
  updatedAt?: string;
};

export type CrmLeadImportPage = {
  leads: CrmImportedLead[];
  nextCursor?: string;
};

export interface CrmImportAdapter {
  listImportableLeads(input?: CrmLeadImportCursor): Promise<CrmLeadImportPage>;
}

export interface CrmAdapter {
  readonly provider: string;

  findContactByPhone(phone: string): Promise<CrmContact | null>;
  findContactByEmail(email: string): Promise<CrmContact | null>;
  upsertContact(input: CrmContactInput): Promise<CrmContact>;

  listAppointments(contactId: string): Promise<CrmAppointment[]>;
  createAppointment(input: CrmAppointmentInput): Promise<CrmAppointment>;
  updateAppointment(appointmentId: string, update: CrmAppointmentUpdate): Promise<CrmAppointment>;
  cancelAppointment(appointmentId: string): Promise<void>;

  logActivity(activity: CrmActivity): Promise<void>;
}

export function hasCrmImport(adapter: CrmAdapter | null): adapter is CrmAdapter & CrmImportAdapter {
  return Boolean(adapter && "listImportableLeads" in adapter && typeof (adapter as Partial<CrmImportAdapter>).listImportableLeads === "function");
}
