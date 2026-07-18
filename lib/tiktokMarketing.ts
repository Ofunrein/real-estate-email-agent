// TikTok Marketing API helpers.
// Docs: https://business-api.tiktok.com/portal/docs
// Sandbox and production share the same endpoints; the access token scopes them.

const TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api";
const TIKTOK_API_VERSION = "v1.3";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function apiUrl(path: string): string {
  const base = (process.env.TIKTOK_API_BASE || TIKTOK_API_BASE).replace(/\/$/, "");
  const version = process.env.TIKTOK_API_VERSION || TIKTOK_API_VERSION;
  return `${base}/${version}/${path.replace(/^\//, "")}`;
}

type TikTokEnvelope<T> = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
};

export type TikTokAdvertiser = {
  advertiser_id: string;
  advertiser_name: string;
};

// Exchange the OAuth auth_code for a long-lived access token.
export async function exchangeTikTokAuthCode(
  authCode: string,
): Promise<{ accessToken: string; scope: string; advertiserIds: string[]; error: string }> {
  const appId = cleanText(process.env.TIKTOK_APP_ID);
  const secret = cleanText(process.env.TIKTOK_APP_SECRET);
  if (!appId || !secret) {
    return { accessToken: "", scope: "", advertiserIds: [], error: "TIKTOK_APP_ID or TIKTOK_APP_SECRET not configured" };
  }

  const res = await fetch(apiUrl("oauth2/access_token/"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
  });

  const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<{
    access_token?: string;
    scope?: string[] | string;
    advertiser_ids?: string[];
  }>;

  if (json.code !== 0 || !json.data?.access_token) {
    return {
      accessToken: "",
      scope: "",
      advertiserIds: [],
      error: json.message || `Token exchange failed (code ${json.code ?? "unknown"})`,
    };
  }

  const scope = Array.isArray(json.data.scope) ? json.data.scope.join(",") : cleanText(json.data.scope);
  return {
    accessToken: json.data.access_token,
    scope,
    advertiserIds: json.data.advertiser_ids || [],
    error: "",
  };
}

// List advertiser accounts this access token can manage.
export async function fetchTikTokAdvertisers(
  accessToken: string,
): Promise<{ advertisers: TikTokAdvertiser[]; error: string }> {
  const appId = cleanText(process.env.TIKTOK_APP_ID);
  const secret = cleanText(process.env.TIKTOK_APP_SECRET);
  if (!appId || !secret) {
    return { advertisers: [], error: "TIKTOK_APP_ID or TIKTOK_APP_SECRET not configured" };
  }

  const url = new URL(apiUrl("oauth2/advertiser/get/"));
  url.searchParams.set("app_id", appId);
  url.searchParams.set("secret", secret);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Access-Token": accessToken },
  });

  const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<{ list?: TikTokAdvertiser[] }>;
  if (json.code !== 0) {
    return { advertisers: [], error: json.message || `Advertiser lookup failed (code ${json.code ?? "unknown"})` };
  }
  return { advertisers: json.data?.list || [], error: "" };
}

// Generic authenticated GET against the Marketing API (reporting, campaigns, etc.).
export async function tiktokGet<T = unknown>(
  path: string,
  accessToken: string,
  params: Record<string, string | number> = {},
): Promise<{ data: T | null; error: string; raw: TikTokEnvelope<T> }> {
  const url = new URL(apiUrl(path));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Access-Token": accessToken },
  });
  const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<T>;
  if (json.code !== 0) {
    return { data: null, error: json.message || `Request failed (code ${json.code ?? "unknown"})`, raw: json };
  }
  return { data: json.data ?? null, error: "", raw: json };
}

// Build the OAuth authorization URL the advertiser visits to grant access.
export function tiktokAuthorizeUrl(redirectUri: string, state = ""): string {
  const appId = cleanText(process.env.TIKTOK_APP_ID);
  const url = new URL("https://business-api.tiktok.com/portal/auth");
  url.searchParams.set("app_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
