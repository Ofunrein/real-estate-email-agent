export type ContactsProviderName = "composio_google_contacts" | "composio_outlook_contacts" | "google_contacts" | "outlook_contacts";

export type ContactEmail = {
  value: string;
  label?: string;
};

export type ContactPhone = {
  value: string;
  label?: string;
};

export type ContactPostalAddress = {
  formatted?: string;
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  label?: string;
};

export type ContactRecord = {
  id: string;
  provider: ContactsProviderName | string;
  sourceId: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  emails: ContactEmail[];
  phones: ContactPhone[];
  addresses: ContactPostalAddress[];
  notes?: string;
  tags: string[];
  updatedAt?: string;
  etag?: string;
  raw?: Record<string, unknown>;
};

export type ContactInput = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  emails?: ContactEmail[];
  phones?: ContactPhone[];
  addresses?: ContactPostalAddress[];
  notes?: string;
  tags?: string[];
  idempotencyKey?: string;
};

export type ContactUpdate = Partial<Omit<ContactInput, "idempotencyKey">> & {
  etag?: string;
};

export type ContactSearchInput = {
  query?: string;
  email?: string;
  phone?: string;
  syncToken?: string;
  pageToken?: string;
  limit?: number;
};

export type ContactListPage = {
  contacts: ContactRecord[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export interface ContactsProvider {
  readonly provider: ContactsProviderName | string;

  searchContacts(input?: ContactSearchInput): Promise<ContactListPage>;
  getContact(contactId: string): Promise<ContactRecord | null>;
  upsertContact(input: ContactInput): Promise<ContactRecord>;
  updateContact(contactId: string, update: ContactUpdate): Promise<ContactRecord>;
  deleteContact(contactId: string, input?: { etag?: string }): Promise<void>;
}
