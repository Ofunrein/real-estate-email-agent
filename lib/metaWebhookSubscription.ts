import type { FacebookPageForMetaDirect } from "@/lib/metaDirectConnection";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function metaGraphVersion(): string {
  return (process.env.META_GRAPH_VERSION || "v20.0").trim().replace(/^\/+/, "");
}

export function subscribedMetaPageFields(): string {
  return cleanText(process.env.META_PAGE_SUBSCRIBED_FIELDS)
    || "messages,messaging_postbacks,message_reads,messaging_referrals,message_reactions";
}

export async function subscribeMetaPageToWebhooks(page: FacebookPageForMetaDirect): Promise<{ ok: boolean; fields: string; error: string }> {
  const fields = subscribedMetaPageFields();
  if (!page.id || !page.access_token) return { ok: false, fields, error: "Missing Page ID or Page access token" };

  const url = new URL(`https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(page.id)}/subscribed_apps`);
  url.searchParams.set("access_token", page.access_token);
  url.searchParams.set("subscribed_fields", fields);

  const res = await fetch(url.toString(), { method: "POST" });
  const json = await res.json().catch(() => ({})) as { success?: boolean; error?: { message?: string } };
  if (!res.ok || !json.success) {
    return { ok: false, fields, error: json.error?.message || "Failed to subscribe Page webhooks" };
  }
  return { ok: true, fields, error: "" };
}
