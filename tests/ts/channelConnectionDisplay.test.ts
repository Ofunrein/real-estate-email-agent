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

test("social connection display prefers direct Meta Instagram over Composio fallback", () => {
  const status: ConnectionStatus = {
    channels: {
      instagram: {
        connected: true,
        needs_config: false,
        connections: [
          {
            id: "ig-composio",
            channel: "instagram",
            provider: "composio_instagram",
            selected_asset_name: "Composio Instagram",
            selected_asset_id: "ca_ig",
            connected_account_id: "ca_ig",
            status: "connected",
            metadata: { composio_auth_configured: true },
            updated_at: "2026-06-25T04:00:00.000Z",
          },
          {
            id: "ig-meta",
            channel: "instagram",
            provider: "meta_direct",
            selected_asset_name: "Lumenosis Instagram",
            selected_asset_id: "17841400000000000",
            status: "connected",
            metadata: { page_id: "123", profile_url: "https://www.instagram.com/martn.ai/" },
            updated_at: "2026-06-25T03:00:00.000Z",
          },
        ],
      },
    },
  };

  const display = displayForChannelConnection(status, "instagram", "", "");

  assert.equal(display.ready, true);
  assert.equal(display.value, "Lumenosis Instagram");
  assert.equal(display.status, "READY");
  assert.equal(display.connection?.id, "ig-meta");
});

test("social connection display prefers direct Meta Messenger over Composio fallback", () => {
  const status: ConnectionStatus = {
    channels: {
      messenger: {
        connected: true,
        needs_config: false,
        connections: [
          {
            id: "fb-composio",
            channel: "messenger",
            provider: "composio_facebook",
            selected_asset_name: "Composio Page",
            selected_asset_id: "ca_fb",
            connected_account_id: "ca_fb",
            status: "connected",
            metadata: { composio_auth_configured: true },
            updated_at: "2026-06-25T04:00:00.000Z",
          },
          {
            id: "fb-meta",
            channel: "messenger",
            provider: "meta_direct",
            selected_asset_name: "Lumenosis Messaging",
            selected_asset_id: "123456789",
            status: "connected",
            metadata: { page_id: "123456789", page_category: "Real Estate" },
            updated_at: "2026-06-25T03:00:00.000Z",
          },
        ],
      },
    },
  };

  const display = displayForChannelConnection(status, "messenger", "", "");

  assert.equal(display.ready, true);
  assert.equal(display.value, "Lumenosis Messaging");
  assert.equal(display.status, "READY");
  assert.equal(display.connection?.id, "fb-meta");
});

test("social connection display exposes avatar and subtitle metadata", () => {
  const status: ConnectionStatus = {
    channels: {
      instagram: {
        connected: true,
        needs_config: false,
        connections: [
          {
            id: "ig-live",
            channel: "instagram",
            provider: "composio_instagram",
            selected_asset_name: "@martn.o",
            selected_asset_id: "17841400000000000",
            connected_account_id: "ca_live",
            status: "connected",
            metadata: {
              composio_auth_configured: true,
              profile_image_url: "https://cdn.example.com/martn-o.jpg",
              profile_url: "https://www.instagram.com/martn.o/",
            },
            updated_at: "2026-06-22T04:00:00.000Z",
          },
        ],
      },
    },
  };

  const display = displayForChannelConnection(status, "instagram", "@austin.realty", "READY");

  assert.equal(display.value, "@martn.o");
  assert.equal(display.avatarUrl, "https://cdn.example.com/martn-o.jpg");
  assert.equal(display.subtitle, "https://www.instagram.com/martn.o/");
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
