import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

// GET /api/auth/tiktok/connect?client_id=<id>
// Redirects the advertiser to TikTok Marketing API OAuth to grant ad-account access.
// After they approve, TikTok calls /api/auth/tiktok/callback with an auth_code.
export async function GET(request: NextRequest) {
  const appId = cleanText(process.env.TIKTOK_APP_ID);
  const publicBaseUrl = cleanText(process.env.PUBLIC_BASE_URL || process.env.AUTH_URL).replace(/\/$/, "");

  if (!appId) {
    return NextResponse.json({ ok: false, error: "TIKTOK_APP_ID is not configured" }, { status: 503 });
  }
  if (!publicBaseUrl) {
    return NextResponse.json({ ok: false, error: "PUBLIC_BASE_URL is not configured" }, { status: 503 });
  }

  const requestedClientId = cleanText(request.nextUrl.searchParams.get("client_id"));
  const statePayload = requestedClientId ? { clientId: requestedClientId } : {};
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  const redirectUri = `${publicBaseUrl}/api/auth/tiktok/callback`;

  // TikTok Marketing API authorization endpoint.
  const authUrl = new URL("https://business-api.tiktok.com/portal/auth");
  authUrl.searchParams.set("app_id", appId);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(authUrl.toString());
}
