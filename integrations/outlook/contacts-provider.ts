import type { ContactInput, ContactListPage, ContactRecord, ContactSearchInput, ContactsProvider, ContactUpdate } from "../contacts-provider.interface";
import { providerUnavailable } from "../provider-errors";

export class OutlookContactsProvider implements ContactsProvider {
  readonly provider = "outlook_contacts";

  private unavailable(): never {
    throw providerUnavailable(this.provider, "Direct Outlook Contacts provider is not wired yet. Use the Composio contacts provider or add Microsoft Graph credentials/client wiring.");
  }

  searchContacts(_input: ContactSearchInput = {}): Promise<ContactListPage> {
    this.unavailable();
  }

  getContact(_contactId: string): Promise<ContactRecord | null> {
    this.unavailable();
  }

  upsertContact(_input: ContactInput): Promise<ContactRecord> {
    this.unavailable();
  }

  updateContact(_contactId: string, _update: ContactUpdate): Promise<ContactRecord> {
    this.unavailable();
  }

  deleteContact(_contactId: string, _input: { etag?: string } = {}): Promise<void> {
    this.unavailable();
  }
}

export function createOutlookContactsProvider(): ContactsProvider {
  return new OutlookContactsProvider();
}
