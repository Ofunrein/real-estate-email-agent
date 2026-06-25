import {
  clientId as defaultClientId,
  databaseEnabled,
  deleteChannelConnectionFromDatabase,
  getChannelConnectionFromDatabase,
  listChannelConnectionsFromDatabase,
  upsertChannelConnectionInDatabase,
} from "@/lib/database";

export type ChannelConnectionRecord = {
  id: string;
  client_id: string;
  channel: string;
  provider: string;
  external_user_id: string;
  auth_config_id: string;
  connected_account_id: string;
  selected_asset_id: string;
  selected_asset_name: string;
  selected_asset_type: string;
  status: string;
  health_reason: string;
  webhook_status: string;
  page_access_token: string;
  token_expires_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ChannelConnectionInput = Partial<Omit<ChannelConnectionRecord, "client_id" | "created_at" | "updated_at">> & {
  channel: string;
  provider?: string;
  metadata?: Record<string, unknown>;
};

export type ChannelConnectionStore = {
  list(clientId: string): Promise<ChannelConnectionRecord[]>;
  get(clientId: string, id: string): Promise<ChannelConnectionRecord | null>;
  upsert(clientId: string, input: ChannelConnectionInput): Promise<ChannelConnectionRecord>;
  delete(clientId: string, id: string): Promise<boolean>;
};

type Options = {
  clientId?: string;
  store?: ChannelConnectionStore;
  env?: Record<string, string | undefined>;
};

const REQUIRED_FIELDS = ["channel"] as const;

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanSlug(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function envFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(cleanText(value).toLowerCase());
}

function isoNow(): string {
  return new Date().toISOString();
}

function generatedId(input: ChannelConnectionInput, clientId: string): string {
  const selected = cleanText(input.selected_asset_id);
  const base = [clientId, cleanSlug(input.channel), cleanSlug(input.provider || "manual"), selected || "default"].join(":");
  return `mem_${Buffer.from(base).toString("base64url").slice(0, 28)}`;
}

export function normalizeChannelConnectionInput(
  input: ChannelConnectionInput,
  clientId: string,
  existing?: ChannelConnectionRecord | null,
): ChannelConnectionRecord {
  for (const field of REQUIRED_FIELDS) {
    if (!cleanText(input[field])) throw new Error(`${field} is required`);
  }

  const channel = cleanSlug(input.channel);
  const provider = cleanSlug(input.provider || existing?.provider || "manual");
  const selectedAssetId = cleanText(input.selected_asset_id ?? existing?.selected_asset_id);
  const connectedAccountId = cleanText(input.connected_account_id ?? existing?.connected_account_id);
  const hasSelectedAsset = Boolean(selectedAssetId || connectedAccountId);
  const now = isoNow();

  return {
    id: cleanText(input.id) || existing?.id || generatedId(input, clientId),
    client_id: clientId,
    channel,
    provider,
    external_user_id: cleanText(input.external_user_id ?? existing?.external_user_id),
    auth_config_id: cleanText(input.auth_config_id ?? existing?.auth_config_id),
    connected_account_id: connectedAccountId,
    selected_asset_id: selectedAssetId,
    selected_asset_name: cleanText(input.selected_asset_name ?? existing?.selected_asset_name),
    selected_asset_type: cleanText(input.selected_asset_type ?? existing?.selected_asset_type),
    status: cleanSlug(input.status || existing?.status || (hasSelectedAsset ? "connected" : "needs_config")),
    health_reason: cleanText(input.health_reason ?? existing?.health_reason),
    webhook_status: cleanSlug(input.webhook_status || existing?.webhook_status || ""),
    page_access_token: cleanText(input.page_access_token ?? existing?.page_access_token),
    token_expires_at: cleanText(input.token_expires_at ?? existing?.token_expires_at),
    metadata: {
      ...jsonRecord(existing?.metadata),
      ...jsonRecord(input.metadata),
    },
    created_at: existing?.created_at || now,
    updated_at: now,
  };
}

function configured(value: string | undefined): boolean {
  return Boolean(cleanText(value));
}

function fallbackRecord(input: {
  clientId: string;
  channel: string;
  provider: string;
  selectedAssetId?: string;
  selectedAssetName?: string;
  selectedAssetType?: string;
  connected: boolean;
  healthReason: string;
  webhookStatus?: string;
  metadata?: Record<string, unknown>;
}): ChannelConnectionRecord {
  const now = isoNow();
  const record = normalizeChannelConnectionInput({
    id: `env_${input.channel}_${input.provider}`,
    channel: input.channel,
    provider: input.provider,
    selected_asset_id: input.selectedAssetId || "",
    selected_asset_name: input.selectedAssetName || "",
    selected_asset_type: input.selectedAssetType || "",
    status: input.connected ? "connected" : "needs_config",
    health_reason: input.healthReason,
    webhook_status: input.webhookStatus || "",
    metadata: {
      source: "env_fallback",
      ...(input.metadata || {}),
    },
  }, input.clientId);
  return { ...record, created_at: now, updated_at: now };
}

export function envFallbackChannelConnections(
  env: Record<string, string | undefined> = process.env,
  clientId = defaultClientId(),
): ChannelConnectionRecord[] {
  const publicBaseUrl = cleanText(env.PUBLIC_BASE_URL || env.AUTH_URL);
  const gmailLegacyConfigured = configured(env.GMAIL_TOKEN_JSON)
    || configured(env.GMAIL_TOKEN_PATH)
    || configured(env.GMAIL_CREDENTIALS_JSON);
  const composioConfigured = configured(env.COMPOSIO_API_KEY);
  const smsConnected = configured(env.TWILIO_ACCOUNT_SID) && configured(env.TWILIO_AUTH_TOKEN) && configured(env.TWILIO_FROM);
  const voicePhoneId = cleanText(env.VAPI_PHONE_NUMBER_ID || env.ARIA_PHONE_NUMBER_ID);
  const voiceConnected = configured(env.VAPI_API_KEY)
    && configured(env.VAPI_ASSISTANT_ID || env.ARIA_ASSISTANT_ID)
    && configured(voicePhoneId);
  const whatsappConnected = envFlag(env.ENABLE_WHATSAPP_AGENT)
    && configured(env.WHATSAPP_PHONE_NUMBER_ID)
    && configured(env.WHATSAPP_ACCESS_TOKEN);
  const crmProvider = cleanSlug(env.CRM_PROVIDER || "ghl");
  const crmConnected = crmProvider === "ghl"
    ? configured(env.GHL_PRIVATE_INTEGRATION_TOKEN || env.GHL_LOCATION_PIT) && configured(env.GHL_LOCATION_ID)
    : configured(env.COMPOSIO_IMPORT_CONNECTED_ACCOUNT_ID);
  const manychatConfigured = configured(env.MANYCHAT_API_KEY);
  const slackConnected = configured(env.SLACK_BOT_TOKEN)
    && (configured(env.SLACK_HOTLEAD_CHANNEL) || configured(env.SLACK_HANDOFF_CHANNEL));

  return [
    fallbackRecord({
      clientId,
      channel: "email",
      provider: configured(env.COMPOSIO_GMAIL_AUTH_CONFIG_ID) ? "composio_gmail" : "gmail",
      connected: gmailLegacyConfigured,
      healthReason: gmailLegacyConfigured ? "Gmail credentials are configured from environment." : "Connect Gmail or provide hosted Gmail credentials.",
      metadata: {
        legacy_configured: gmailLegacyConfigured,
        composio_auth_configured: configured(env.COMPOSIO_GMAIL_AUTH_CONFIG_ID),
      },
    }),
    fallbackRecord({
      clientId,
      channel: "sms",
      provider: "twilio",
      selectedAssetId: cleanText(env.TWILIO_FROM),
      selectedAssetName: cleanText(env.TWILIO_FROM),
      selectedAssetType: "phone_number",
      connected: smsConnected,
      healthReason: smsConnected ? "Twilio SMS sender is configured from environment." : "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM.",
      webhookStatus: publicBaseUrl ? "configured" : "",
      metadata: { messaging_service_configured: configured(env.TWILIO_MESSAGING_SERVICE_SID) },
    }),
    fallbackRecord({
      clientId,
      channel: "voice",
      provider: "vapi",
      selectedAssetId: voicePhoneId,
      selectedAssetName: voicePhoneId,
      selectedAssetType: "phone_number",
      connected: voiceConnected,
      healthReason: voiceConnected ? "Vapi voice number and assistant are configured from environment." : "Set VAPI_API_KEY, VAPI_ASSISTANT_ID, and VAPI_PHONE_NUMBER_ID.",
      webhookStatus: publicBaseUrl ? "configured" : "",
    }),
    fallbackRecord({
      clientId,
      channel: "whatsapp",
      provider: "meta_cloud",
      selectedAssetId: cleanText(env.WHATSAPP_PHONE_NUMBER_ID),
      selectedAssetName: cleanText(env.WHATSAPP_PHONE_NUMBER_ID),
      selectedAssetType: "phone_number",
      connected: whatsappConnected,
      healthReason: whatsappConnected ? "Meta WhatsApp Cloud API is configured from environment." : "Set ENABLE_WHATSAPP_AGENT, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_ACCESS_TOKEN.",
      webhookStatus: configured(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) && publicBaseUrl ? "configured" : "",
      metadata: { composio_auth_configured: composioConfigured && configured(env.COMPOSIO_WHATSAPP_AUTH_CONFIG_ID) },
    }),
    fallbackRecord({
      clientId,
      channel: "whatsapp",
      provider: "composio_whatsapp",
      connected: false,
      healthReason: "Connect and select a WhatsApp Business account through Composio.",
      metadata: { composio_auth_configured: composioConfigured && configured(env.COMPOSIO_WHATSAPP_AUTH_CONFIG_ID) },
    }),
    fallbackRecord({
      clientId,
      channel: "instagram",
      provider: manychatConfigured ? "manychat" : "composio_instagram",
      connected: false,
      healthReason: manychatConfigured ? "ManyChat API is configured; select the active Instagram asset before direct sends." : "Connect and select an Instagram Business account.",
      metadata: { manychat_configured: manychatConfigured, composio_auth_configured: composioConfigured && configured(env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID) },
    }),
    fallbackRecord({
      clientId,
      channel: "messenger",
      provider: manychatConfigured ? "manychat" : "composio_facebook",
      connected: false,
      healthReason: manychatConfigured ? "ManyChat API is configured; select the active Facebook Page before direct sends." : "Connect and select a Facebook Page.",
      metadata: { manychat_configured: manychatConfigured, composio_auth_configured: composioConfigured && configured(env.COMPOSIO_FACEBOOK_AUTH_CONFIG_ID) },
    }),
    fallbackRecord({
      clientId,
      channel: "crm",
      provider: crmProvider,
      selectedAssetId: cleanText(env.GHL_LOCATION_ID || env.COMPOSIO_IMPORT_CONNECTED_ACCOUNT_ID),
      selectedAssetName: cleanText(env.GHL_LOCATION_ID || env.COMPOSIO_IMPORT_TOOLKIT),
      selectedAssetType: "crm_account",
      connected: crmConnected,
      healthReason: crmConnected ? "CRM connection is configured from environment." : "Configure the CRM adapter or connected Composio import account.",
      metadata: { import_toolkit: cleanText(env.COMPOSIO_IMPORT_TOOLKIT), import_tool_configured: configured(env.COMPOSIO_IMPORT_TOOL_SLUG) },
    }),
    fallbackRecord({
      clientId,
      channel: "slack",
      provider: "slack",
      selectedAssetId: cleanText(env.SLACK_HOTLEAD_CHANNEL || env.SLACK_HANDOFF_CHANNEL),
      selectedAssetName: cleanText(env.SLACK_HOTLEAD_CHANNEL || env.SLACK_HANDOFF_CHANNEL),
      selectedAssetType: "channel",
      connected: slackConnected,
      healthReason: slackConnected ? "Slack alert channels are configured from environment." : "Set SLACK_BOT_TOKEN and at least one alert channel.",
    }),
  ];
}

const databaseStore: ChannelConnectionStore = {
  list: listChannelConnectionsFromDatabase,
  get: getChannelConnectionFromDatabase,
  upsert: upsertChannelConnectionInDatabase,
  delete: deleteChannelConnectionFromDatabase,
};

function selectedStore(options?: Options): ChannelConnectionStore | null {
  if (options?.store) return options.store;
  return databaseEnabled() ? databaseStore : null;
}

function mergeConnectionStatus(
  saved: ChannelConnectionRecord[],
  fallback: ChannelConnectionRecord[],
): ChannelConnectionRecord[] {
  const savedKeys = new Set(saved.map((connection) => `${connection.channel}:${connection.provider}`));
  return [
    ...saved,
    ...fallback.filter((connection) => !savedKeys.has(`${connection.channel}:${connection.provider}`)),
  ];
}

export async function listChannelConnections(options: Options = {}): Promise<{
  connections: ChannelConnectionRecord[];
  database_enabled: boolean;
  fallback: boolean;
  error?: string;
}> {
  const cid = options.clientId || defaultClientId();
  const store = selectedStore(options);
  if (!store) {
    return {
      connections: envFallbackChannelConnections(options.env, cid),
      database_enabled: false,
      fallback: true,
    };
  }
  try {
    const saved = await store.list(cid);
    return {
      connections: mergeConnectionStatus(saved, envFallbackChannelConnections(options.env, cid)),
      database_enabled: !options.store && databaseEnabled(),
      fallback: false,
    };
  } catch (error) {
    return {
      connections: envFallbackChannelConnections(options.env, cid),
      database_enabled: !options.store && databaseEnabled(),
      fallback: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getChannelConnection(id: string, options: Options = {}): Promise<ChannelConnectionRecord | null> {
  const store = selectedStore(options);
  if (!store) return null;
  return store.get(options.clientId || defaultClientId(), id);
}

export async function upsertChannelConnection(input: ChannelConnectionInput, options: Options = {}): Promise<ChannelConnectionRecord> {
  const store = selectedStore(options);
  if (!store) throw new Error("DATABASE_URL is required to save channel connections");
  return store.upsert(options.clientId || defaultClientId(), input);
}

export async function deleteChannelConnection(id: string, options: Options = {}): Promise<boolean> {
  const store = selectedStore(options);
  if (!store) throw new Error("DATABASE_URL is required to delete channel connections");
  return store.delete(options.clientId || defaultClientId(), id);
}

export async function dashboardChannelConnectionStatus(options: Options = {}) {
  const cid = options.clientId || defaultClientId();
  const result = await listChannelConnections({ ...options, clientId: cid });
  const byChannel = result.connections.reduce<Record<string, ChannelConnectionRecord[]>>((acc, connection) => {
    (acc[connection.channel] ||= []).push(connection);
    return acc;
  }, {});
  return {
    client_id: cid,
    database_enabled: result.database_enabled,
    fallback: result.fallback,
    error: result.error,
    connections: result.connections,
    channels: Object.fromEntries(
      Object.entries(byChannel).map(([channel, connections]) => [
        channel,
        {
          connected: connections.some((connection) => connection.status === "connected"),
          needs_review: connections.some((connection) => connection.status === "needs_review"),
          needs_config: connections.every((connection) => connection.status === "needs_config"),
          providers: connections.map((connection) => connection.provider),
          connections,
        },
      ]),
    ),
  };
}

export function createInMemoryChannelConnectionStore(initial: ChannelConnectionRecord[] = []): ChannelConnectionStore {
  const records = new Map<string, ChannelConnectionRecord>();
  for (const record of initial) records.set(record.id, record);

  return {
    async list(clientId) {
      return Array.from(records.values())
        .filter((record) => record.client_id === clientId)
        .sort((a, b) => `${a.channel}:${a.provider}`.localeCompare(`${b.channel}:${b.provider}`));
    },
    async get(clientId, id) {
      const record = records.get(id);
      return record?.client_id === clientId ? record : null;
    },
    async upsert(clientId, input) {
      const existingById = input.id ? records.get(input.id) : null;
      const probe = normalizeChannelConnectionInput(input, clientId, existingById);
      const existing = existingById || Array.from(records.values()).find((record) =>
        record.client_id === clientId
        && record.channel === probe.channel
        && record.provider === probe.provider
        && record.selected_asset_id === probe.selected_asset_id
      ) || null;
      const normalized = normalizeChannelConnectionInput(input, clientId, existing);
      records.set(normalized.id, normalized);
      return normalized;
    },
    async delete(clientId, id) {
      const record = records.get(id);
      if (!record || record.client_id !== clientId) return false;
      records.delete(id);
      return true;
    },
  };
}
