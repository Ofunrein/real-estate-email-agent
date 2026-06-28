import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryChannelConnectionStore,
  dashboardChannelConnectionStatus,
  envFallbackChannelConnections,
  listChannelConnections,
  normalizeChannelConnectionInput,
  upsertChannelConnection,
} from "@/lib/channelConnections";

test("normalizeChannelConnectionInput matches registry defaults", () => {
  const normalized = normalizeChannelConnectionInput({
    channel: "Instagram DMs",
    provider: "Composio",
    connected_account_id: "acct_123",
    selected_asset_id: "ig_456",
    selected_asset_name: "Austin Homes",
    selected_asset_type: "instagram_business_account",
    metadata: { toolkit: "instagram", scopes: ["messages"] },
  }, "ryse");

  assert.equal(normalized.client_id, "ryse");
  assert.equal(normalized.channel, "instagram_dms");
  assert.equal(normalized.provider, "composio");
  assert.equal(normalized.status, "connected");
  assert.deepEqual(normalized.metadata.scopes, ["messages"]);
});

test("in-memory store upserts by client/channel/provider/selected asset and scopes clients", async () => {
  const store = createInMemoryChannelConnectionStore();

  const first = await upsertChannelConnection({
    channel: "instagram",
    provider: "composio",
    selected_asset_id: "ig_1",
    selected_asset_name: "Old name",
  }, { clientId: "client-a", store });
  const second = await upsertChannelConnection({
    channel: "instagram",
    provider: "composio",
    selected_asset_id: "ig_1",
    selected_asset_name: "New name",
    metadata: { webhook_subscription_id: "sub_1" },
  }, { clientId: "client-a", store });
  await upsertChannelConnection({
    channel: "instagram",
    provider: "composio",
    selected_asset_id: "ig_1",
    selected_asset_name: "Other client",
  }, { clientId: "client-b", store });

  assert.equal(second.id, first.id);
  assert.equal(second.selected_asset_name, "New name");
  assert.equal(second.metadata.webhook_subscription_id, "sub_1");

  const listed = await listChannelConnections({ clientId: "client-a", store });
  assert.equal(listed.fallback, false);
  const instagram = listed.connections.find((connection) => connection.channel === "instagram");
  assert.equal(instagram?.selected_asset_name, "New name");
  assert.ok(listed.connections.some((connection) => connection.channel === "sms"));
});

test("env fallback reports configured direct channels without exposing secrets", () => {
  const fallback = envFallbackChannelConnections({
    CLIENT_ID: "env-client",
    GMAIL_OAUTH_CLIENT_ID: "client-id",
    GMAIL_OAUTH_CLIENT_SECRET: "secret",
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "secret",
    TWILIO_FROM: "+15125550123",
    VAPI_API_KEY: "secret",
    VAPI_ASSISTANT_ID: "asst_1",
    VAPI_PHONE_NUMBER_ID: "pn_1",
    ENABLE_WHATSAPP_AGENT: "true",
    WHATSAPP_PHONE_NUMBER_ID: "wa_1",
    WHATSAPP_ACCESS_TOKEN: "secret",
    GHL_PRIVATE_INTEGRATION_TOKEN: "secret",
    GHL_LOCATION_ID: "loc_1",
    SLACK_BOT_TOKEN: "xoxb-secret",
    SLACK_HOTLEAD_CHANNEL: "#hot-leads",
  }, "env-client");

  const byChannel = Object.fromEntries(fallback.map((connection) => [connection.channel, connection]));
  const whatsappMeta = fallback.find((connection) => connection.channel === "whatsapp" && connection.provider === "meta_cloud");
  assert.equal(byChannel.email.status, "needs_config");
  assert.equal(byChannel.email.metadata.oauth_configured, true);
  assert.equal(byChannel.sms.selected_asset_name, "+15125550123");
  assert.equal(byChannel.voice.status, "connected");
  assert.equal(whatsappMeta?.status, "connected");
  assert.equal(byChannel.crm.status, "connected");
  assert.equal(byChannel.slack.status, "connected");
  assert.doesNotMatch(JSON.stringify(fallback), /xoxb-secret|refresh_token|TWILIO_AUTH_TOKEN|WHATSAPP_ACCESS_TOKEN/);
});

test("dashboard status falls back when database is unavailable", async () => {
  const priorDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const status = await dashboardChannelConnectionStatus({
      clientId: "local",
      env: {
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: "secret",
        TWILIO_FROM: "+15125550123",
      },
    });
    assert.equal(status.database_enabled, false);
    assert.equal(status.fallback, true);
    assert.equal(status.channels.sms.connected, true);
  } finally {
    if (priorDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
  }
});

test("saved connection status still includes env auth-ready channels", async () => {
  const store = createInMemoryChannelConnectionStore();
  await upsertChannelConnection({
    channel: "instagram",
    provider: "composio_instagram",
    selected_asset_id: "ig_1",
    selected_asset_name: "Austin Realty",
  }, { clientId: "client-a", store });

  const status = await dashboardChannelConnectionStatus({
    clientId: "client-a",
    store,
    env: {
      COMPOSIO_API_KEY: "project-key",
      COMPOSIO_FACEBOOK_AUTH_CONFIG_ID: "ac_facebook",
      COMPOSIO_WHATSAPP_AUTH_CONFIG_ID: "ac_whatsapp",
    },
  });

  assert.equal(status.channels.instagram.connected, true);
  assert.equal(status.channels.messenger.needs_config, true);
  assert.equal(status.channels.messenger.connections[0].metadata.composio_auth_configured, true);
  assert.equal(status.channels.whatsapp.connections[0].metadata.composio_auth_configured, true);
});
