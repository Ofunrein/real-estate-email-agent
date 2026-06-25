import type { ChannelConnectionInput } from "@/lib/channelConnections";

export type FacebookPageForMetaDirect = {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
  instagram_business_account?: {
    id?: string;
    username?: string;
    profile_picture_url?: string;
  };
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function metaDirectConnectionInputForPage(
  page: FacebookPageForMetaDirect,
  channel: "messenger" | "instagram",
): ChannelConnectionInput | null {
  if (!page.access_token || !page.id) return null;

  if (channel === "instagram") {
    const instagramAccount = page.instagram_business_account;
    const instagramUserId = cleanText(instagramAccount?.id);
    if (!instagramUserId) return null;

    const username = cleanText(instagramAccount?.username);
    return {
      channel,
      provider: "meta_direct",
      selected_asset_id: instagramUserId,
      selected_asset_name: username || page.name || instagramUserId,
      selected_asset_type: "instagram_business_account",
      status: "connected",
      health_reason: "Connected via Facebook OAuth.",
      page_access_token: page.access_token,
      metadata: {
        page_id: page.id,
        page_name: page.name,
        page_access_token: page.access_token,
        instagram_user_id: instagramUserId,
        instagram_username: username,
        instagram_profile_picture_url: cleanText(instagramAccount?.profile_picture_url),
        category: page.category || "",
        connected_at: new Date().toISOString(),
      },
    };
  }

  return {
    channel,
    provider: "meta_direct",
    selected_asset_id: page.id,
    selected_asset_name: page.name || page.id,
    selected_asset_type: "page",
    status: "connected",
    health_reason: "Connected via Facebook OAuth.",
    page_access_token: page.access_token,
    metadata: {
      page_id: page.id,
      page_name: page.name,
      page_access_token: page.access_token,
      category: page.category || "",
      connected_at: new Date().toISOString(),
    },
  };
}
