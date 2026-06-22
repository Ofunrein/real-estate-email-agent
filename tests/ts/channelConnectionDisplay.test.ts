import { test } from "node:test";
import assert from "node:assert/strict";

import { displayForChannelConnection, type ConnectionStatus } from "@/components/inbox-mui/hooks/useChannelConnectionStatus";

test("social connection display prefers newest connected account over setup fallback", () => {
  const status: ConnectionStatus = {
    channels: {
      instagram: {
        connected: true,
        needs_config: false,
        connections: [
          {
            id: "env_instagram_composio_instagram",
            channel: "instagram",
            provider: "composio_instagram",
            status: "needs_config",
            metadata: { composio_auth_configured: true },
            updated_at: "2026-06-22T01:00:00.000Z",
          },
          {
            id: "ig-old",
            channel: "instagram",
            provider: "composio_instagram",
            selected_asset_name: "Old Instagram",
            selected_asset_id: "ca_old",
            connected_account_id: "ca_old",
            status: "connected",
            metadata: { composio_auth_configured: true },
            updated_at: "2026-06-22T02:00:00.000Z",
          },
          {
            id: "ig-new",
            channel: "instagram",
            provider: "composio_instagram",
            selected_asset_name: "Martin AI",
            selected_asset_id: "ca_new",
            connected_account_id: "ca_new",
            status: "connected",
            metadata: { composio_auth_configured: true },
            updated_at: "2026-06-22T03:00:00.000Z",
          },
        ],
      },
    },
  };

  const display = displayForChannelConnection(status, "instagram", "@austin.realty", "READY");

  assert.equal(display.ready, true);
  assert.equal(display.value, "Martin AI");
  assert.equal(display.status, "READY");
  assert.equal(display.connection?.id, "ig-new");
});

test("social connection display does not use static fallback identity when setup is missing", () => {
  const display = displayForChannelConnection(null, "messenger", "Austin Realty Page", "READY");

  assert.equal(display.ready, false);
  assert.equal(display.value, "Not connected");
  assert.equal(display.status, "SETUP NEEDED");
});

test("social connection display marks connected account setup-needed when outbound send is incomplete", () => {
  const status: ConnectionStatus = {
    channels: {
      messenger: {
        connected: true,
        needs_config: false,
        connections: [
          {
            id: "fb-page",
            channel: "messenger",
            provider: "composio_facebook",
            selected_asset_name: "Martn.ai",
            selected_asset_id: "ca_fb",
            connected_account_id: "ca_fb",
            status: "connected",
            metadata: {
              composio_auth_configured: true,
              outbound_ready: false,
              outbound_missing: ["page_id"],
            },
            updated_at: "2026-06-22T03:00:00.000Z",
          },
        ],
      },
    },
  };

  const display = displayForChannelConnection(status, "messenger", "Austin Realty Page", "READY");

  assert.equal(display.ready, false);
  assert.equal(display.value, "Martn.ai");
  assert.equal(display.status, "SETUP NEEDED");
  assert.equal(display.connection?.id, "fb-page");
});

test("social connection display ignores non-Composio WhatsApp fallback rows", () => {
  const status: ConnectionStatus = {
    channels: {
      whatsapp: {
        connected: true,
        needs_config: false,
        connections: [
          {
            id: "env_whatsapp_meta_cloud",
            channel: "whatsapp",
            provider: "meta_cloud",
            selected_asset_name: "15551234567",
            selected_asset_id: "wa_phone_id",
            status: "connected",
            metadata: { composio_auth_configured: true },
            updated_at: "2026-06-22T04:00:00.000Z",
          },
          {
            id: "env_whatsapp_composio_whatsapp",
            channel: "whatsapp",
            provider: "composio_whatsapp",
            status: "needs_config",
            metadata: { composio_auth_configured: true },
            updated_at: "2026-06-22T03:00:00.000Z",
          },
        ],
      },
    },
  };

  const display = displayForChannelConnection(status, "whatsapp", "15551234567", "READY");

  assert.equal(display.ready, false);
  assert.equal(display.value, "No account connected");
  assert.equal(display.status, "SETUP NEEDED");
  assert.equal(display.connection?.provider, "composio_whatsapp");
});

test("social connection display does not expose opaque Composio account ids", () => {
  const status: ConnectionStatus = {
    channels: {
      instagram: {
        connected: true,
        needs_config: false,
        connections: [
          {
            id: "ig-connected",
            channel: "instagram",
            provider: "composio_instagram",
            selected_asset_id: "17841400000000000",
            connected_account_id: "ca_123456789abcdef",
            status: "connected",
            metadata: { composio_auth_configured: true },
            updated_at: "2026-06-22T03:00:00.000Z",
          },
        ],
      },
    },
  };

  const display = displayForChannelConnection(status, "instagram", "@austin.realty", "READY");

  assert.equal(display.ready, true);
  assert.equal(display.value, "Connected account");
  assert.equal(display.status, "READY");
});
