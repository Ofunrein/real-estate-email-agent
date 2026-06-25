import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function metaBusinessLoginConfigId(
  request: NextRequest,
  channel: "messenger" | "instagram",
): string {
  const queryConfigId = cleanText(request.nextUrl.searchParams.get("config_id"));
  if (queryConfigId) return queryConfigId;

  const useDashboardConfig = cleanText(process.env.META_USE_BUSINESS_LOGIN_CONFIG);
  if (!["1", "true", "yes"].includes(useDashboardConfig.toLowerCase())) return "";

  const channelConfigId = channel === "instagram"
    ? cleanText(process.env.META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID)
    : cleanText(process.env.META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID);
  if (channelConfigId) return channelConfigId;

  const sharedConfigId = cleanText(process.env.META_BUSINESS_LOGIN_CONFIG_ID);
  if (sharedConfigId) return sharedConfigId;

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

  const requestedClientId = cleanText(request.nextUrl.searchParams.get("client_id"));
  const channel = cleanText(request.nextUrl.searchParams.get("channel") || "messenger") as "messenger" | "instagram";
  const redirectUri = `${publicBaseUrl}/api/channels/meta/callback`;

  // Keep the default dashboard OAuth URL tenant-neutral; callback falls back to CLIENT_ID.
  const statePayload = requestedClientId ? { clientId: requestedClientId, channel } : { channel };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  const scope = channel === "instagram"
    ? "openid,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages"
    : "openid,pages_messaging,pages_manage_metadata";
  const configId = metaBusinessLoginConfigId(request, channel);

  const oauthUrl = new URL("https://www.facebook.com/dialog/oauth");
  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  if (configId) oauthUrl.searchParams.set("config_id", configId);
  oauthUrl.searchParams.set("scope", scope);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("state", state);

  return NextResponse.redirect(oauthUrl.toString());
}
