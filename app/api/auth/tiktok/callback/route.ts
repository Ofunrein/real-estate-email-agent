import { NextRequest, NextResponse } from "next/server";

import { upsertChannelConnection } from "@/lib/channelConnections";
import {
  exchangeTikTokAuthCode,
  fetchTikTokAdvertisers,
} from "@/lib/tiktokMarketing";

export const dynamic = "force-dynamic";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

// GET /api/auth/tiktok/callback?auth_code=<code>&state=<state>
// TikTok redirects here after the advertiser authorizes the app.
// Exchanges auth_code -> long-lived access_token, lists granted advertiser
// accounts, and stores each as a tiktok_ads channel connection.
export async function GET(request: NextRequest) {
  const publicBaseUrl = cleanText(process.env.PUBLIC_BASE_URL || process.env.AUTH_URL).replace(/\/$/, "");
  const appBaseUrl = publicBaseUrl || request.nextUrl.origin;

  // TikTok sends the code as auth_code (some flows send code); accept both.
  const authCode = cleanText(
    request.nextUrl.searchParams.get("auth_code") || request.nextUrl.searchParams.get("code"),
  );
  const errorParam = cleanText(request.nextUrl.searchParams.get("error"));
  const stateRaw = cleanText(request.nextUrl.searchParams.get("state"));

  if (errorParam) {
    const nextUrl = new URL(appBaseUrl);
    nextUrl.searchParams.set("tiktokConnectError", errorParam);
    return NextResponse.redirect(nextUrl);
  }
  if (!authCode) {
    const nextUrl = new URL(appBaseUrl);
    nextUrl.searchParams.set("tiktokConnectError", "missing_auth_code");
    return NextResponse.redirect(nextUrl);
  }

  let clientId = cleanText(process.env.CLIENT_ID);
  try {
    const state = JSON.parse(Buffer.from(stateRaw, "base64url").toString()) as { clientId?: string };
    if (state.clientId) clientId = state.clientId;
  } catch {
    // state decode failure is non-fatal; fall back to CLIENT_ID
  }

  const { accessToken, scope, error: tokenError } = await exchangeTikTokAuthCode(authCode);
  if (tokenError || !accessToken) {
    return NextResponse.json({ ok: false, error: tokenError || "Token exchange failed" }, { status: 502 });
  }

  const { advertisers, error: advError } = await fetchTikTokAdvertisers(accessToken);
  if (advError) {
    return NextResponse.json({ ok: false, error: advError }, { status: 502 });
  }
  if (!advertisers.length) {
    return NextResponse.json({ ok: false, error: "No TikTok advertiser accounts authorized" }, { status: 400 });
  }

  const saved: Array<{ advertiser_id: string; name: string }> = [];
  for (const adv of advertisers) {
    await upsertChannelConnection({
      channel: "tiktok_ads",
      provider: "tiktok",
      connected_account_id: adv.advertiser_id,
      selected_asset_id: adv.advertiser_id,
      selected_asset_name: adv.advertiser_name || adv.advertiser_id,
      selected_asset_type: "advertiser",
      status: "connected",
      page_access_token: accessToken,
      metadata: {
        scope,
        advertiser_id: adv.advertiser_id,
        advertiser_name: adv.advertiser_name,
        connected_at: new Date().toISOString(),
      },
    }, { clientId });
    saved.push({ advertiser_id: adv.advertiser_id, name: adv.advertiser_name || adv.advertiser_id });
  }

  const nextUrl = new URL(appBaseUrl);
  nextUrl.searchParams.set("tiktokConnected", "1");
  nextUrl.searchParams.set("connectedAdvertisers", String(saved.length));
  return NextResponse.redirect(nextUrl);
}
