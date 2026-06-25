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

  const useDashboardConfig = cleanText(process.env.META_USE_BUSINESS_LOGIN_CONFIG).toLowerCase();
  if (["0", "false", "no"].includes(useDashboardConfig)) return "";

  const channelConfigId = channel === "instagram"
    ? cleanText(process.env.META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID)
    : cleanText(process.env.META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID);
  if (channelConfigId) return channelConfigId;

  if (channel === "messenger") return "";

  const sharedConfigId = cleanText(process.env.META_BUSINESS_LOGIN_CONFIG_ID);
  if (sharedConfigId) return sharedConfigId;

  return "";
}

function metaGraphVersion(): string {
  return (process.env.META_GRAPH_VERSION || "v20.0").trim().replace(/^\/+/, "");
}

function sdkConnectPage(input: {
  appId: string;
  channel: "messenger" | "instagram";
  redirectUri: string;
  state: string;
  scope: string;
  configId: string;
}) {
  const fallbackUrl = new URL(`https://www.facebook.com/${metaGraphVersion()}/dialog/oauth`);
  fallbackUrl.searchParams.set("client_id", input.appId);
  fallbackUrl.searchParams.set("redirect_uri", input.redirectUri);
  if (input.configId) {
    fallbackUrl.searchParams.set("config_id", input.configId);
    fallbackUrl.searchParams.set("override_default_response_type", "true");
    fallbackUrl.searchParams.set("scope", "openid");
  } else {
    fallbackUrl.searchParams.set("scope", input.scope);
  }
  fallbackUrl.searchParams.set("auth_type", "rerequest");
  fallbackUrl.searchParams.set("response_type", "code");
  fallbackUrl.searchParams.set("state", input.state);
  const title = input.channel === "instagram" ? "Connect Instagram" : "Connect Messenger";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0f12; color: #f7f7f2; }
    main { width: min(420px, calc(100vw - 32px)); border: 1px solid #293137; border-radius: 8px; background: #11171b; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,.42); }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.15; }
    p { margin: 0 0 18px; color: #aeb8bd; font-size: 14px; line-height: 1.45; }
    button, a { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-height: 42px; border-radius: 6px; font-weight: 800; font-size: 14px; text-decoration: none; }
    button { width: 100%; border: 0; background: #7c5cff; color: white; cursor: pointer; }
    a { width: 100%; margin-top: 10px; color: #c8d0d4; border: 1px solid #313b42; }
    #status { min-height: 20px; margin-top: 14px; color: #f6c177; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>Grant Lumenosis access to the selected ${input.channel === "instagram" ? "Instagram business account" : "Facebook Page"} so Iris can receive and send messages through Meta.</p>
    <a href="${fallbackUrl.toString()}">Continue with Meta</a>
    <div id="status"></div>
  </main>
</body>
</html>`;
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
    ? "openid,pages_show_list,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages"
    : "openid,pages_show_list,pages_messaging,pages_manage_metadata";
  const configId = metaBusinessLoginConfigId(request, channel);
  const useSdk = ["1", "true", "yes"].includes(cleanText(request.nextUrl.searchParams.get("use_sdk")).toLowerCase());

  if (useSdk) {
    return new NextResponse(sdkConnectPage({ appId, channel, redirectUri, state, scope, configId }), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const oauthUrl = new URL(`https://www.facebook.com/${metaGraphVersion()}/dialog/oauth`);
  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  if (configId) oauthUrl.searchParams.set("config_id", configId);
  // Facebook Login for Business configs already own the permission set.
  // Plain OAuth must still send scopes directly.
  oauthUrl.searchParams.set("scope", configId ? "openid" : scope);
  if (configId) oauthUrl.searchParams.set("override_default_response_type", "true");
  oauthUrl.searchParams.set("auth_type", "rerequest");
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("state", state);

  return NextResponse.redirect(oauthUrl.toString());
}
