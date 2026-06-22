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
  connection?: ChannelConnectionRecord;
};

const composioManagedChannels = new Set<ChannelId>(["instagram", "messenger", "whatsapp"]);

function selectedAssetLabel(connection?: ChannelConnectionRecord) {
  return [
    connection?.selected_asset_name,
    typeof connection?.metadata?.display_name === "string" ? connection.metadata.display_name : "",
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

function byNewest(a: ChannelConnectionRecord, b: ChannelConnectionRecord) {
  return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
}

function composioConnection(connection: ChannelConnectionRecord) {
  return connection.provider.startsWith("composio_");
}

export function displayForChannelConnection(
  status: ConnectionStatus | null,
  channel: ChannelId,
  fallbackValue: string,
  fallbackStatus: string,
): ChannelConnectionDisplay {
  if (!composioManagedChannels.has(channel)) {
    return { ready: ["READY", "SYNCED"].includes(fallbackStatus), value: fallbackValue, status: fallbackStatus };
  }

  const connections = (status?.channels?.[channel]?.connections || []).filter(composioConnection);
  const connected = [...connections]
    .filter((connection) => connection.status === "connected")
    .sort(byNewest)
    [0];
  const configured = connections.find((connection) => connection.metadata?.composio_auth_configured);
  const connection = connected || configured || connections[0];
  const label = connectionLabel(connected);

  if (connected && label) {
    const ready = outboundReady(connected);
    return {
      ready,
      value: label,
      status: ready ? "READY" : "SETUP NEEDED",
      connection: connected,
    };
  }

  if (configured) {
    return {
      ready: false,
      value: "No account connected",
      status: "SETUP NEEDED",
      connection: configured,
    };
  }

  return {
    ready: false,
    value: "Not connected",
    status: "SETUP NEEDED",
    connection,
  };
}

export function useChannelConnectionStatus(enabled = true) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    const res = await fetch("/api/settings/channel-connections");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `connection status failed (${res.status})`);
    setStatus(data);
    return data as ConnectionStatus;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError("");
    void fetch("/api/settings/channel-connections")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `connection status failed (${res.status})`);
        if (!cancelled) setStatus(data);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load connection status.");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(() => ({ status, error, refresh }), [status, error, refresh]);
}
