import crypto from "node:crypto";

export type InstagramBrowserSendInput = {
  threadId: string;
  body: string;
  mediaUrls?: string[];
};

export type InstagramBrowserSendResult = {
  ok: boolean;
  messageId?: string;
  deliveredBody?: string;
  error?: string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function cookieHeader(): string {
  const direct = clean(process.env.INSTAGRAM_BROWSER_COOKIE || process.env.IG_BROWSER_COOKIE);
  if (direct) return direct;
  const sessionid = clean(process.env.INSTAGRAM_SESSIONID || process.env.IG_SESSIONID);
  const csrftoken = clean(process.env.INSTAGRAM_CSRFTOKEN || process.env.IG_CSRFTOKEN);
  const dsUserId = clean(process.env.INSTAGRAM_DS_USER_ID || process.env.IG_DS_USER_ID);
  return [
    sessionid ? `sessionid=${sessionid}` : "",
    csrftoken ? `csrftoken=${csrftoken}` : "",
    dsUserId ? `ds_user_id=${dsUserId}` : "",
  ].filter(Boolean).join("; ");
}

function csrfToken(cookies: string): string {
  return clean(process.env.INSTAGRAM_CSRFTOKEN || process.env.IG_CSRFTOKEN)
    || cookies.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1]
    || "";
}

export function instagramBrowserBridgeEnabled(): boolean {
  return Boolean(cookieHeader() && csrfToken(cookieHeader()));
}

function deliveredBody(input: InstagramBrowserSendInput): string {
  const body = input.body.trim();
  const media = (input.mediaUrls || []).map((url) => clean(url)).filter(Boolean);
  if (!media.length) return body;
  return [body, "Attachments:", ...media].filter(Boolean).join("\n");
}

export async function sendInstagramBrowserThreadMessage(input: InstagramBrowserSendInput): Promise<InstagramBrowserSendResult> {
  const threadId = clean(input.threadId).replace(/^browser_thread:/, "");
  if (!threadId) return { ok: false, error: "Missing Instagram browser thread id" };
  const cookies = cookieHeader();
  const csrf = csrfToken(cookies);
  if (!cookies || !csrf) {
    return { ok: false, error: "Instagram browser bridge is not configured. Set INSTAGRAM_BROWSER_COOKIE or IG_SESSIONID + IG_CSRFTOKEN." };
  }
  const text = deliveredBody(input);
  if (!text) return { ok: false, error: "Message body required for Instagram browser bridge" };
  const clientContext = crypto.randomUUID().replace(/-/g, "");
  const body = new URLSearchParams({
    action: "send_item",
    thread_ids: JSON.stringify([threadId]),
    text,
    client_context: clientContext,
    mutation_token: clientContext,
  });
  const response = await fetch("https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cookie": cookies,
      "x-csrftoken": csrf,
      "x-ig-app-id": clean(process.env.INSTAGRAM_WEB_APP_ID || "936619743392459"),
      "x-asbd-id": "129477",
      "x-requested-with": "XMLHttpRequest",
      "referer": "https://www.instagram.com/direct/inbox/",
      "user-agent": clean(process.env.INSTAGRAM_BROWSER_USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    },
    body,
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") })) as Record<string, unknown>;
  if (!response.ok || clean(payload.status).toLowerCase() === "fail") {
    const message = clean(payload.message || payload.error || payload.raw) || `Instagram browser send failed (${response.status})`;
    return { ok: false, error: message.slice(0, 500) };
  }
  const item = payload.payload && typeof payload.payload === "object" ? payload.payload as Record<string, unknown> : payload;
  return {
    ok: true,
    messageId: clean(item.item_id || item.message_id || clientContext),
    deliveredBody: text,
  };
}
