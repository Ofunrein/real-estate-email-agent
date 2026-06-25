import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
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

  const oauthUrl = new URL("https://www.facebook.com/dialog/oauth");
  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("scope", scope);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("state", state);

  return NextResponse.redirect(oauthUrl.toString());
}
