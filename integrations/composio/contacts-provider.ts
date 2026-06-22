import type {
  ContactInput,
  ContactListPage,
  ContactRecord,
  ContactSearchInput,
  ContactsProvider,
  ContactsProviderName,
  ContactUpdate,
} from "../contacts-provider.interface";
import { providerBadRequest } from "../provider-errors";
import { normalizeContact } from "../provider-normalizers";
import { executeComposioTool, resultItems, resultString, type ComposioProviderContext } from "./client";

type ComposioContactsKind = "google" | "outlook";

const PROVIDERS: Record<ComposioContactsKind, ContactsProviderName> = {
  google: "composio_google_contacts",
  outlook: "composio_outlook_contacts",
};

const TOOL_SLUGS: Record<ComposioContactsKind, Record<string, string[]>> = {
  google: {
    search: ["GOOGLECONTACTS_SEARCH_CONTACTS", "GOOGLE_CONTACTS_SEARCH_CONTACTS", "GOOGLECONTACTS_LIST_CONTACTS"],
    get: ["GOOGLECONTACTS_GET_CONTACT", "GOOGLE_CONTACTS_GET_CONTACT"],
    upsert: ["GOOGLECONTACTS_CREATE_CONTACT", "GOOGLE_CONTACTS_CREATE_CONTACT"],
    update: ["GOOGLECONTACTS_UPDATE_CONTACT", "GOOGLE_CONTACTS_UPDATE_CONTACT"],
    delete: ["GOOGLECONTACTS_DELETE_CONTACT", "GOOGLE_CONTACTS_DELETE_CONTACT"],
  },
  outlook: {
    search: ["OUTLOOK_CONTACTS_LIST_CONTACTS", "MICROSOFT_OUTLOOK_CONTACTS_LIST_CONTACTS", "OUTLOOK_LIST_CONTACTS"],
    get: ["OUTLOOK_CONTACTS_GET_CONTACT", "MICROSOFT_OUTLOOK_CONTACTS_GET_CONTACT", "OUTLOOK_GET_CONTACT"],
    upsert: ["OUTLOOK_CONTACTS_CREATE_CONTACT", "MICROSOFT_OUTLOOK_CONTACTS_CREATE_CONTACT", "OUTLOOK_CREATE_CONTACT"],
    update: ["OUTLOOK_CONTACTS_UPDATE_CONTACT", "MICROSOFT_OUTLOOK_CONTACTS_UPDATE_CONTACT", "OUTLOOK_UPDATE_CONTACT"],
    delete: ["OUTLOOK_CONTACTS_DELETE_CONTACT", "MICROSOFT_OUTLOOK_CONTACTS_DELETE_CONTACT", "OUTLOOK_DELETE_CONTACT"],
  },
};

function envName(kind: ComposioContactsKind, action: string): string {
  return `COMPOSIO_${kind.toUpperCase()}_CONTACTS_${action.toUpperCase()}_TOOL_SLUG`;
}

function inputArgs(input: ContactInput | ContactUpdate): Record<string, unknown> {
  return {
    display_name: input.fullName,
    given_name: input.firstName,
    family_name: input.lastName,
    company: input.company,
    job_title: input.title,
    email_addresses: input.emails?.map((email) => ({ value: email.value, type: email.label })),
    phone_numbers: input.phones?.map((phone) => ({ value: phone.value, type: phone.label })),
    addresses: input.addresses,
    notes: input.notes,
    tags: input.tags,
    etag: "etag" in input ? input.etag : undefined,
  };
}

export class ComposioContactsProvider implements ContactsProvider {
  readonly provider: ContactsProviderName;
  private readonly kind: ComposioContactsKind;
  private readonly context: ComposioProviderContext;

  constructor(kind: ComposioContactsKind, input: { userEmail: string; connectedAccountId?: string }) {
    this.kind = kind;
    this.provider = PROVIDERS[kind];
    this.context = { ...input, provider: this.provider };
  }

  async searchContacts(input: ContactSearchInput = {}): Promise<ContactListPage> {
    const result = await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "search")],
      fallbackSlugs: TOOL_SLUGS[this.kind].search,
      args: {
        query: input.query,
        email: input.email,
        phone: input.phone,
        sync_token: input.syncToken,
        page_token: input.pageToken,
        page_size: input.limit,
      },
    });
    return {
      contacts: resultItems(result).map((item) => normalizeContact(this.provider, item)),
      nextPageToken: resultString(result, "nextPageToken", "next_page_token"),
      nextSyncToken: resultString(result, "nextSyncToken", "next_sync_token"),
    };
  }

  async getContact(contactId: string): Promise<ContactRecord | null> {
    if (!contactId.trim()) throw providerBadRequest(this.provider, "contactId is required");
    const result = await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "get")],
      fallbackSlugs: TOOL_SLUGS[this.kind].get,
      args: { contact_id: contactId, resource_name: contactId },
    });
    const raw = result.contact || result.data || result;
    return Object.keys(raw as Record<string, unknown>).length ? normalizeContact(this.provider, raw) : null;
  }

  async upsertContact(input: ContactInput): Promise<ContactRecord> {
    const result = await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "upsert")],
      fallbackSlugs: TOOL_SLUGS[this.kind].upsert,
      args: { ...inputArgs(input), idempotency_key: input.idempotencyKey },
    });
    return normalizeContact(this.provider, result.contact || result.data || result);
  }

  async updateContact(contactId: string, update: ContactUpdate): Promise<ContactRecord> {
    if (!contactId.trim()) throw providerBadRequest(this.provider, "contactId is required");
    const result = await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "update")],
      fallbackSlugs: TOOL_SLUGS[this.kind].update,
      args: { contact_id: contactId, resource_name: contactId, ...inputArgs(update) },
    });
    return normalizeContact(this.provider, result.contact || result.data || result);
  }

  async deleteContact(contactId: string, input: { etag?: string } = {}): Promise<void> {
    if (!contactId.trim()) throw providerBadRequest(this.provider, "contactId is required");
    await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "delete")],
      fallbackSlugs: TOOL_SLUGS[this.kind].delete,
      args: { contact_id: contactId, resource_name: contactId, etag: input.etag },
    });
  }
}

export function createComposioGoogleContactsProvider(input: { userEmail: string; connectedAccountId?: string }): ContactsProvider {
  return new ComposioContactsProvider("google", input);
}

export function createComposioOutlookContactsProvider(input: { userEmail: string; connectedAccountId?: string }): ContactsProvider {
  return new ComposioContactsProvider("outlook", input);
}
