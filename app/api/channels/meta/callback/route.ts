import { NextRequest, NextResponse } from "next/server";

import { upsertChannelConnection } from "@/lib/channelConnections";

export const dynamic = "force-dynamic";

type FacebookPage = {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function metaGraphVersion(): string {
  return (process.env.META_GRAPH_VERSION || "v20.0").trim().replace(/^\/+/, "");
}

// Exchange a short-lived code for a long-lived user token, then for page tokens.
async function exchangeCodeForLongLivedToken(code: string, redirectUri: string): Promise<{ token: string; error: string }> {
  const appId = cleanText(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID);
  const appSecret = cleanText(process.env.META_APP_SECRET || process.env.META_SOCIAL_APP_SECRET);
  if (!appId || !appSecret) return { token: "", error: "META_APP_ID or META_APP_SECRET not configured" };

  // Step 1: short-lived user token
  const shortLivedUrl = new URL(`https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token`);
  shortLivedUrl.searchParams.set("client_id", appId);
  shortLivedUrl.searchParams.set("client_secret", appSecret);
  shortLivedUrl.searchParams.set("redirect_uri", redirectUri);
  shortLivedUrl.searchParams.set("code", code);

  const shortRes = await fetch(shortLivedUrl.toString());
  const shortJson = await shortRes.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } };
  if (!shortRes.ok || !shortJson.access_token) {
    return { token: "", error: shortJson.error?.message || "Failed to exchange code for token" };
  }

  // Step 2: exchange for long-lived user token (60-day)
  const longLivedUrl = new URL(`https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", appId);
  longLivedUrl.searchParams.set("client_secret", appSecret);
  longLivedUrl.searchParams.set("fb_exchange_token", shortJson.access_token);

  const longRes = await fetch(longLivedUrl.toString());
  const longJson = await longRes.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!longRes.ok || !longJson.access_token) {
    return { token: "", error: longJson.error?.message || "Failed to exchange for long-lived token" };
  }

  return { token: longJson.access_token, error: "" };
}

// Fetch all pages the user manages and return with their never-expiring page tokens.
async function fetchManagedPages(userToken: string): Promise<{ pages: FacebookPage[]; error: string }> {
  const url = new URL(`https://graph.facebook.com/${metaGraphVersion()}/me/accounts`);
  url.searchParams.set("access_token", userToken);
  url.searchParams.set("fields", "id,name,access_token,category,tasks");

  const res = await fetch(url.toString());
  const json = await res.json().catch(() => ({})) as { data?: FacebookPage[]; error?: { message?: string } };
  if (!res.ok) {
    return { pages: [], error: json.error?.message || "Failed to fetch managed pages" };
  }
  return { pages: json.data || [], error: "" };
}

// GET /api/channels/meta/callback?code=<code>&state=<state>
// Called by Facebook after the user grants permission.
// Exchanges code → long-lived token → page tokens, stores each page in channel_connections.
export async function GET(request: NextRequest) {
  const publicBaseUrl = cleanText(process.env.PUBLIC_BASE_URL || process.env.AUTH_URL).replace(/\/$/, "");
  const code = cleanText(request.nextUrl.searchParams.get("code"));
  const error = cleanText(request.nextUrl.searchParams.get("error"));
  const stateRaw = cleanText(request.nextUrl.searchParams.get("state"));

  if (error) {
    return NextResponse.json({ ok: false, error: `Facebook denied access: ${error}` }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ ok: false, error: "Missing authorization code" }, { status: 400 });
  }

  let clientId = cleanText(process.env.CLIENT_ID);
  let channel: "messenger" | "instagram" = "messenger";
  try {
    const state = JSON.parse(Buffer.from(stateRaw, "base64url").toString()) as { clientId?: string; channel?: string };
    if (state.clientId) clientId = state.clientId;
    if (state.channel === "instagram") channel = "instagram";
  } catch {
    // state decode failure is non-fatal; fall back to defaults
  }

  const redirectUri = `${publicBaseUrl}/api/channels/meta/callback`;
  const { token: userToken, error: tokenError } = await exchangeCodeForLongLivedToken(code, redirectUri);
  if (tokenError || !userToken) {
    return NextResponse.json({ ok: false, error: tokenError || "Token exchange failed" }, { status: 502 });
  }

  const { pages, error: pagesError } = await fetchManagedPages(userToken);
  if (pagesError) {
    return NextResponse.json({ ok: false, error: pagesError }, { status: 502 });
  }
  if (!pages.length) {
    return NextResponse.json({ ok: false, error: "No Facebook Pages found for this account" }, { status: 400 });
  }

  // Persist each page as a channel_connections row with its never-expiring page token.
  const saved: Array<{ page_id: string; name: string }> = [];
  for (const page of pages) {
    if (!page.access_token || !page.id) continue;
    await upsertChannelConnection({
      channel,
      provider: "meta_direct",
      selected_asset_id: page.id,
      selected_asset_name: page.name || page.id,
      selected_asset_type: "page",
      status: "connected",
      health_reason: "Connected via Facebook OAuth.",
      page_access_token: page.access_token,
      // Keep a metadata copy for older databases before migration 016 is applied.
      metadata: {
        page_id: page.id,
        page_name: page.name,
        page_access_token: page.access_token,
        category: page.category || "",
        connected_at: new Date().toISOString(),
      },
    }, { clientId });
    saved.push({ page_id: page.id, name: page.name });
  }

  return NextResponse.json({ ok: true, connected_pages: saved, channel });
}
