import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { loadAgentInboxData } from "@/lib/dataSource";
import {
  databaseEnabled,
  readActiveAiDraftsFromDatabase,
  readDefaultEmailAccountFromDatabase,
  readInboxCategoriesFromDatabase,
  readInboxSettingsFromDatabase,
  readThreadReadStatesFromDatabase,
} from "@/lib/database";
import { emailCapabilitiesForScopes } from "@/lib/gmailConnection";
import { dashboardChannelConnectionStatus, type ChannelConnectionRecord } from "@/lib/channelConnections";
import { composeInboxData } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = Number(process.env.IRIS_DASHBOARD_DATA_CACHE_MS || 5_000);
const LIVE_DASHBOARD_CACHE = {
  headers: {
    "Cache-Control": "private, max-age=5, stale-while-revalidate=10",
  },
};

type CachedDashboardData = {
  body: string;
  expiresAt: number;
};

let dashboardDataCache: CachedDashboardData | null = null;
let dashboardDataInflight: Promise<string> | null = null;

function jsonResponse(body: string, cacheStatus: "HIT" | "MISS" | "WAIT" | "STALE") {
  return new NextResponse(body, {
    headers: {
      ...LIVE_DASHBOARD_CACHE.headers,
      "Content-Type": "application/json; charset=utf-8",
      "X-Iris-Data-Cache": cacheStatus,
    },
  });
}

function selectedConnectionLabel(connection: ChannelConnectionRecord) {
  const metadata = connection.metadata || {};
  return [
    connection.selected_asset_name,
    typeof metadata.display_name === "string" ? metadata.display_name : "",
    typeof metadata.handle === "string" ? metadata.handle : "",
    typeof metadata.username === "string" ? `@${String(metadata.username).replace(/^@/, "")}` : "",
    typeof metadata.page_name === "string" ? metadata.page_name : "",
    typeof metadata.verified_name === "string" ? metadata.verified_name : "",
    connection.selected_asset_id,
    connection.connected_account_id,
  ].map((value) => String(value || "").trim()).find(Boolean) || "Connected account";
}

function channelAccountOverrides(status: Awaited<ReturnType<typeof dashboardChannelConnectionStatus>>) {
  const labels: Record<string, string> = {
    instagram: "Instagram",
    messenger: "Messenger",
    whatsapp: "WhatsApp",
  };
  const directMeta = new Set(["instagram", "messenger"]);
  return Object.fromEntries(
    Object.entries(labels).flatMap(([channel, label]) => {
      const connected = status.channels[channel]?.connections
        .filter((connection) => connection.status === "connected")
        .sort((a, b) => {
          const aRank = directMeta.has(channel) && a.provider === "meta_direct" ? 0 : 1;
          const bRank = directMeta.has(channel) && b.provider === "meta_direct" ? 0 : 1;
          return aRank - bRank || Date.parse(b.updated_at || "") - Date.parse(a.updated_at || "");
        })[0];
      if (!connected) return [];
      const ready = directMeta.has(channel)
        ? connected.provider === "meta_direct" && Boolean(connected.page_access_token || connected.metadata?.page_access_token)
        : true;
      return [[channel, {
        label,
        value: selectedConnectionLabel(connected),
        status: ready ? "READY" : "SETUP NEEDED",
      }]];
    }),
  );
}

async function loadDashboardDataBody() {
  const { leads, events, properties, voiceCalls } = await loadAgentInboxData();
  if (!databaseEnabled()) {
    return JSON.stringify(composeInboxData(leads, events, properties, voiceCalls));
  }
  const [inboxCategories, inboxSettings, drafts, defaultEmailAccount, threadReadStates, connectionStatus] = await Promise.all([
    readInboxCategoriesFromDatabase(),
    readInboxSettingsFromDatabase(),
    readActiveAiDraftsFromDatabase(),
    readDefaultEmailAccountFromDatabase(),
    readThreadReadStatesFromDatabase(),
    dashboardChannelConnectionStatus(),
  ]);
  return JSON.stringify(composeInboxData(leads, events, properties, voiceCalls, {
    inboxCategories,
    inboxSettings,
    drafts,
    emailCapabilities: emailCapabilitiesForScopes(defaultEmailAccount?.scopes || []),
    threadReadStates,
    channelAccounts: channelAccountOverrides(connectionStatus),
  }));
}

async function cachedDashboardDataBody() {
  const now = Date.now();
  if (dashboardDataCache && dashboardDataCache.expiresAt > now) {
    return { body: dashboardDataCache.body, status: "HIT" as const };
  }
  if (dashboardDataInflight) {
    const body = await dashboardDataInflight;
    return { body, status: "WAIT" as const };
  }
  dashboardDataInflight = loadDashboardDataBody()
    .then((body) => {
      dashboardDataCache = { body, expiresAt: Date.now() + CACHE_TTL_MS };
      return body;
    })
    .finally(() => {
      dashboardDataInflight = null;
    });
  const body = await dashboardDataInflight;
  return { body, status: "MISS" as const };
}

export async function GET() {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  try {
    const result = await cachedDashboardDataBody();
    return jsonResponse(result.body, result.status);
  } catch (error) {
    if (dashboardDataCache) return jsonResponse(dashboardDataCache.body, "STALE");
    const message = error instanceof Error ? error.message : "Unable load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
