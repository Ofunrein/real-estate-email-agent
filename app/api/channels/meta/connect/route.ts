import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function metaBusinessLoginConfigId(
  request: NextRequest,
  appId: string,
  channel: "messenger" | "instagram",
): string {
  const queryConfigId = cleanText(request.nextUrl.searchParams.get("config_id"));
  if (queryConfigId) return queryConfigId;

  const channelConfigId = channel === "instagram"
    ? cleanText(process.env.META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID)
    : cleanText(process.env.META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID);
  if (channelConfigId) return channelConfigId;

  const sharedConfigId = cleanText(process.env.META_BUSINESS_LOGIN_CONFIG_ID);
  if (sharedConfigId) return sharedConfigId;

  // Public dashboard config ID for the Lumenosis Messaging app. This is not a
  // secret; it tells Meta which Facebook Login for Business config to invoke.
  if (appId === "2482694768826545") return "884521007425365";

  return "";
}

// GET /api/channels/meta/connect?client_id=<id>&channel=messenger|instagram
// Redirects the browser to Facebook OAuth to collect pages_messaging permission.
export async function GET(request: NextRequest) {
  const appId = cleanText(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID);
  const publicBaseUrl = cleanText(process.env.PUBLIC_BASE_URL || process.env.AUTH_URL).replace(/\/$/, "");
  if (!appId) {
    return NextResponse.json({ ok: false, error: "META_APP_ID is not configured" }, { status: 503 });
  }
  if (!publicBaseUrl) {
    return NextResponse.json({ ok: false, error: "PUBLIC_BASE_URL is not configured" }, { status: 503 });
  }

  const clientId = cleanText(request.nextUrl.searchParams.get("client_id") || process.env.CLIENT_ID);
  const channel = cleanText(request.nextUrl.searchParams.get("channel") || "messenger") as "messenger" | "instagram";
  const redirectUri = `${publicBaseUrl}/api/channels/meta/callback`;

  // Encode state so the callback can persist client_id + channel.
  const state = Buffer.from(JSON.stringify({ clientId, channel })).toString("base64url");

  const scope = channel === "instagram"
    ? "pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages"
    : "pages_messaging,pages_manage_metadata";
  const configId = metaBusinessLoginConfigId(request, appId, channel);

  const oauthUrl = new URL("https://www.facebook.com/dialog/oauth");
  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  if (configId) oauthUrl.searchParams.set("config_id", configId);
  else oauthUrl.searchParams.set("scope", scope);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("state", state);

  return NextResponse.redirect(oauthUrl.toString());
}
