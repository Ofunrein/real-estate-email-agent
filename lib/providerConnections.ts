import { Pool } from "pg";

import { clientId } from "@/lib/database";
import { composioExternalUserId, createComposioClient } from "@/lib/composioConnection";

export type ProviderDomain = "calendar" | "contacts";
export type ExternalProvider = "google" | "outlook";

export type ProviderConnectionRecord = {
  id: string;
  client_id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  composio_connected_account_id: string;
  display_name: string;
  email: string;
  status: string;
  metadata: Record<string, unknown>;
  last_sync_at: string | null;
  last_error: string;
  created_at: string;
  updated_at: string;
};

type ProviderConfig = {
  provider: string;
  authConfigEnv: string;
  toolkitEnv: string;
  defaultToolkit: string;
};

const CONFIG: Record<ProviderDomain, Record<ExternalProvider, ProviderConfig>> = {
  calendar: {
    google: {
      provider: "composio_google_calendar",
      authConfigEnv: "COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID",
      toolkitEnv: "COMPOSIO_GOOGLE_CALENDAR_TOOLKIT",
      defaultToolkit: "googlecalendar",
    },
    outlook: {
      provider: "composio_outlook_calendar",
      authConfigEnv: "COMPOSIO_OUTLOOK_CALENDAR_AUTH_CONFIG_ID",
      toolkitEnv: "COMPOSIO_OUTLOOK_CALENDAR_TOOLKIT",
      defaultToolkit: "outlook",
    },
  },
  contacts: {
    google: {
      provider: "composio_google_contacts",
      authConfigEnv: "COMPOSIO_GOOGLE_CONTACTS_AUTH_CONFIG_ID",
      toolkitEnv: "COMPOSIO_GOOGLE_CONTACTS_TOOLKIT",
      defaultToolkit: "googlecontacts",
    },
    outlook: {
      provider: "composio_outlook_contacts",
      authConfigEnv: "COMPOSIO_OUTLOOK_CONTACTS_AUTH_CONFIG_ID",
      toolkitEnv: "COMPOSIO_OUTLOOK_CONTACTS_TOOLKIT",
      defaultToolkit: "outlook",
    },
  },
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

function configFor(domain: ProviderDomain, provider: ExternalProvider): ProviderConfig {
  return CONFIG[domain][provider];
}

function toolkitFor(config: ProviderConfig): string {
  return process.env[config.toolkitEnv] || config.defaultToolkit;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function linkResponsePayload(request: unknown): { id?: string; redirectUrl?: string } {
  const payload = record(request);
  return {
    id: text(payload.id || payload.nanoid || payload.connectedAccountId),
    redirectUrl: text(payload.redirectUrl || payload.redirect_url || payload.url),
  };
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  const root = record(value);
  for (const key of ["items", "data", "results", "connectedAccounts", "connections"]) {
    if (Array.isArray(root[key])) return collectRecords(root[key]);
  }
  return Object.keys(root).length ? [root] : [];
}

function accountIdFrom(account: Record<string, unknown>): string {
  return text(account.id || account.nanoid || account.connectedAccountId || account.connected_account_id);
}

function accountStatus(account: Record<string, unknown>): string {
  const status = text(account.status || account.state).toLowerCase();
  if (!status) return "connected";
  if (["active", "enabled", "connected", "initiated"].includes(status)) return "connected";
  return status;
}

function accountEmail(account: Record<string, unknown>): string {
  return text(account.email || account.accountEmail || record(account.data).email || record(account.metadata).email);
}

function accountDisplayName(account: Record<string, unknown>): string {
  return text(
    account.name
      || account.displayName
      || account.accountName
      || record(account.data).name
      || record(account.metadata).display_name
      || accountEmail(account),
  );
}

export async function createProviderConnectLink(input: {
  domain: ProviderDomain;
  provider: ExternalProvider;
  userEmail: string;
  callbackUrl: string;
}) {
  const config = configFor(input.domain, input.provider);
  const composio = createComposioClient();
  const userId = composioExternalUserId(input.userEmail);
  const authConfigId = process.env[config.authConfigEnv] || "";
  const toolkit = toolkitFor(config);
  const options = { callbackUrl: input.callbackUrl, allowMultiple: true, alias: `${input.domain}_${input.provider}` };
  const maybeComposio = composio as unknown as {
    create?: (userId: string) => Promise<{
      authorize?: (toolkit: string, options: { callbackUrl: string; alias?: string; authConfigId?: string }) => Promise<unknown>;
    }>;
  };
  const request = authConfigId
    ? await composio.connectedAccounts.link(userId, authConfigId, options)
    : typeof maybeComposio.create === "function"
      ? await (async () => {
        const session = await maybeComposio.create!(userId);
        if (!session.authorize) throw new Error("Composio session authorize is unavailable");
        return session.authorize(toolkit, {
          callbackUrl: input.callbackUrl,
          alias: options.alias,
        });
      })()
      : await composio.toolkits.authorize(userId, toolkit, undefined);
  const link = linkResponsePayload(request);
  if (link.id) {
    await upsertProviderConnection({
      domain: input.domain,
      userEmail: input.userEmail,
      provider: config.provider,
      composioConnectedAccountId: link.id,
      status: "connecting",
      metadata: { auth_config_id: authConfigId, toolkit, connect_request_id: link.id },
    });
  }
  return link;
}

export async function upsertProviderConnection(input: {
  domain: ProviderDomain;
  userEmail: string;
  provider: string;
  providerAccountId?: string;
  composioConnectedAccountId: string;
  displayName?: string;
  email?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}): Promise<ProviderConnectionRecord> {
  const result = await pool().query(
    `insert into calendar_provider_connections (
       client_id, user_id, provider, provider_account_id, composio_connected_account_id,
       display_name, email, status, metadata
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     on conflict (client_id, provider, provider_account_id, composio_connected_account_id)
     do update set
       user_id = excluded.user_id,
       display_name = coalesce(nullif(excluded.display_name,''), calendar_provider_connections.display_name),
       email = coalesce(nullif(excluded.email,''), calendar_provider_connections.email),
       status = excluded.status,
       metadata = calendar_provider_connections.metadata || excluded.metadata,
       updated_at = now()
     returning *`,
    [
      clientId(),
      composioExternalUserId(input.userEmail),
      input.provider,
      input.providerAccountId || "",
      input.composioConnectedAccountId,
      input.displayName || "",
      input.email || "",
      input.status || "connected",
      JSON.stringify({ domain: input.domain, ...(input.metadata || {}) }),
    ],
  );
  return result.rows[0] as ProviderConnectionRecord;
}

export async function listProviderConnections(input: {
  domain: ProviderDomain;
  provider?: string;
  onlyConnected?: boolean;
}): Promise<ProviderConnectionRecord[]> {
  const result = await pool().query(
    `select *
       from calendar_provider_connections
      where client_id = $1
        and metadata->>'domain' = $2
        and ($3 = '' or provider = $3)
        and ($4::boolean = false or status = 'connected')
      order by updated_at desc`,
    [clientId(), input.domain, input.provider || "", Boolean(input.onlyConnected)],
  );
  return result.rows as ProviderConnectionRecord[];
}

export async function reconcileComposioProviderConnections(input: {
  domain: ProviderDomain;
  provider: ExternalProvider;
  userEmail: string;
}): Promise<ProviderConnectionRecord[]> {
  const config = configFor(input.domain, input.provider);
  const toolkit = toolkitFor(config);
  const userId = composioExternalUserId(input.userEmail);
  const composio = createComposioClient();
  const list = composio.connectedAccounts.list as unknown as (query?: Record<string, unknown>) => Promise<unknown>;
  const candidates = [
    { userIds: [userId], toolkitSlugs: [toolkit] },
    { userId, toolkitSlug: toolkit },
    { userIds: [userId] },
    { userId },
  ];
  let accounts: Record<string, unknown>[] = [];
  for (const query of candidates) {
    try {
      accounts = collectRecords(await list.call(composio.connectedAccounts, query));
      if (accounts.length) break;
    } catch {
      continue;
    }
  }

  const saved: ProviderConnectionRecord[] = [];
  for (const account of accounts) {
    const connectedAccountId = accountIdFrom(account);
    if (!connectedAccountId) continue;
    saved.push(await upsertProviderConnection({
      domain: input.domain,
      userEmail: input.userEmail,
      provider: config.provider,
      providerAccountId: text(account.providerAccountId || account.provider_account_id || account.externalId),
      composioConnectedAccountId: connectedAccountId,
      displayName: accountDisplayName(account),
      email: accountEmail(account),
      status: accountStatus(account),
      metadata: { toolkit, raw: account },
    }));
  }

  return saved.length ? saved : listProviderConnections({ domain: input.domain, provider: config.provider });
}

export function providerName(domain: ProviderDomain, provider: ExternalProvider): string {
  return configFor(domain, provider).provider;
}
