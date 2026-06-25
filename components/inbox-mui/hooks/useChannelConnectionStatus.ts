"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ChannelId } from "../data/inboxData";

export type ChannelConnectionRecord = {
  id: string;
  channel: string;
  provider: string;
  selected_asset_name?: string;
  selected_asset_id?: string;
  selected_asset_type?: string;
  connected_account_id?: string;
  status: string;
  health_reason?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ConnectionStatus = {
  fallback?: boolean;
  connections?: ChannelConnectionRecord[];
  channels?: Record<string, {
    connected: boolean;
    needs_config: boolean;
    connections: ChannelConnectionRecord[];
  }>;
};

export type ChannelConnectionDisplay = {
  ready: boolean;
  value: string;
  status: string;
  subtitle?: string;
  avatarUrl?: string;
  connection?: ChannelConnectionRecord;
};

const socialManagedChannels = new Set<ChannelId>(["instagram", "messenger", "whatsapp"]);
const CONNECTION_STATUS_CACHE_MS = 60_000;

let cachedStatus: ConnectionStatus | null = null;
let cachedAt = 0;
let inFlightStatus: Promise<ConnectionStatus> | null = null;

function selectedAssetLabel(connection?: ChannelConnectionRecord) {
  return [
    connection?.selected_asset_name,
    typeof connection?.metadata?.display_name === "string" ? connection.metadata.display_name : "",
    typeof connection?.metadata?.handle === "string" ? connection.metadata.handle : "",
    typeof connection?.metadata?.username === "string" ? `@${String(connection.metadata.username).replace(/^@/, "")}` : "",
    typeof connection?.metadata?.page_name === "string" ? connection.metadata.page_name : "",
    typeof connection?.metadata?.verified_name === "string" ? connection.metadata.verified_name : "",
    typeof connection?.metadata?.display_phone_number === "string" ? connection.metadata.display_phone_number : "",
    typeof connection?.metadata?.word_id === "string" ? connection.metadata.word_id : "",
  ].map((value) => String(value || "").trim()).find(Boolean) || "";
}

function connectionLabel(connection?: ChannelConnectionRecord) {
  return selectedAssetLabel(connection) || (connection ? "Connected account" : "");
}

function outboundReady(connection?: ChannelConnectionRecord) {
  if (!connection) return false;
  if (connection.metadata?.outbound_ready === false) return false;
  return true;
}

function metadataString(connection: ChannelConnectionRecord | undefined, keys: string[]) {
  if (!connection?.metadata) return "";
  return keys
    .map((key) => connection.metadata?.[key])
    .map((value) => typeof value === "string" ? value.trim() : "")
    .find(Boolean) || "";
}

function connectionAvatarUrl(connection?: ChannelConnectionRecord) {
  return metadataString(connection, ["profile_image_url", "page_picture_url", "avatar_url", "picture_url"]);
}

function connectionSubtitle(connection?: ChannelConnectionRecord) {
  if (!connection) return "";
  if (connection.channel === "instagram") {
    return metadataString(connection, ["profile_url", "account_type"]) || "Instagram Business";
  }
  if (connection.channel === "messenger") {
    return metadataString(connection, ["page_category", "profile_url"]) || "Facebook Page";
  }
  if (connection.channel === "whatsapp") {
    return metadataString(connection, ["verified_name", "display_phone_number"]) || "WhatsApp Business";
  }
  return "";
}

function byNewest(a: ChannelConnectionRecord, b: ChannelConnectionRecord) {
  return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
}

function composioConnection(connection: ChannelConnectionRecord) {
  return connection.provider.startsWith("composio_");
}

function directMetaConnection(connection: ChannelConnectionRecord) {
  return connection.provider === "meta_direct";
}

function connectionEligibleForChannel(channel: ChannelId, connection: ChannelConnectionRecord) {
  if (channel === "instagram" || channel === "messenger") {
    return directMetaConnection(connection) || composioConnection(connection);
  }
  if (channel === "whatsapp") return composioConnection(connection);
  return true;
}

function providerRank(channel: ChannelId, connection: ChannelConnectionRecord) {
  if ((channel === "instagram" || channel === "messenger") && directMetaConnection(connection)) return 0;
  if (composioConnection(connection)) return 1;
  return 10;
}

function byProviderPreference(channel: ChannelId) {
  return (a: ChannelConnectionRecord, b: ChannelConnectionRecord) =>
    providerRank(channel, a) - providerRank(channel, b) || byNewest(a, b);
}

export function displayForChannelConnection(
  status: ConnectionStatus | null,
  channel: ChannelId,
  fallbackValue: string,
  fallbackStatus: string,
): ChannelConnectionDisplay {
  if (!socialManagedChannels.has(channel)) {
    return { ready: ["READY", "SYNCED"].includes(fallbackStatus), value: fallbackValue, status: fallbackStatus };
  }

  const connections = (status?.channels?.[channel]?.connections || []).filter((connection) =>
    connectionEligibleForChannel(channel, connection)
  );
  const connected = [...connections]
    .filter((connection) => connection.status === "connected")
    .sort(byProviderPreference(channel))
    [0];
  const configured = [...connections]
    .filter((connection) => connection.metadata?.composio_auth_configured)
    .sort(byProviderPreference(channel))
    [0];
  const connection = connected || configured || connections[0];
  const label = connectionLabel(connected);

  if (connected && label) {
    const ready = outboundReady(connected);
    return {
      ready,
      value: label,
      status: ready ? "READY" : "SETUP NEEDED",
      subtitle: connectionSubtitle(connected),
      avatarUrl: connectionAvatarUrl(connected),
      connection: connected,
    };
  }

  if (configured) {
    return {
      ready: false,
      value: "No account connected",
      status: "SETUP NEEDED",
      subtitle: connectionSubtitle(configured),
      avatarUrl: connectionAvatarUrl(configured),
      connection: configured,
    };
  }

  return {
    ready: false,
    value: "Not connected",
    status: "SETUP NEEDED",
    subtitle: connectionSubtitle(connection),
    avatarUrl: connectionAvatarUrl(connection),
    connection,
  };
}

export function useChannelConnectionStatus(enabled = true) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async (options?: { sync?: boolean; force?: boolean }) => {
    setError("");
    const now = Date.now();
    if (!options?.force && !options?.sync && cachedStatus && now - cachedAt < CONNECTION_STATUS_CACHE_MS) {
      setStatus(cachedStatus);
      return cachedStatus;
    }
    if (!inFlightStatus || options?.force || options?.sync) {
      const path = options?.sync ? "/api/settings/channel-connections?sync=1" : "/api/settings/channel-connections";
      inFlightStatus = fetch(path)
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `connection status failed (${res.status})`);
          cachedStatus = data as ConnectionStatus;
          cachedAt = Date.now();
          return cachedStatus;
        })
        .finally(() => {
          inFlightStatus = null;
        });
    }
    const data = await inFlightStatus;
    setStatus(data);
    return data;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError("");
    void refresh()
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load connection status.");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, refresh]);

  return useMemo(() => ({ status, error, refresh }), [status, error, refresh]);
}
