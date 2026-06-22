import { listChannelConnections, upsertChannelConnection } from "@/lib/channelConnections";
import {
  composioAuthConfigId,
  composioEnabled,
  composioExternalUserId,
  createComposioClient,
  type ComposioConnectChannel,
} from "@/lib/composioConnection";
import { composioSocialSendHealth } from "@/lib/composioSocial";

type SocialConnectChannel = Exclude<ComposioConnectChannel, "gmail">;

type SyncResult = {
  checked: boolean;
  synced: number;
  stale: number;
  errors: string[];
};

const SOCIAL_CHANNELS: SocialConnectChannel[] = ["instagram", "facebook", "whatsapp"];

function dashboardChannel(channel: SocialConnectChannel) {
  return channel === "facebook" ? "messenger" : channel;
}

function providerFor(channel: SocialConnectChannel) {
  return channel === "facebook" ? "composio_facebook" : `composio_${channel}`;
}

function selectedAssetType(channel: SocialConnectChannel) {
  if (channel === "facebook") return "facebook_page";
  if (channel === "instagram") return "instagram_business_account";
  return "whatsapp_business_account";
}

function shortAccountId(account: Record<string, unknown>) {
  const id = String(account.id || "").trim();
  return id ? `${id.slice(0, 6)}...${id.slice(-4)}` : "";
}

function nestedString(value: unknown, path: string[]): string {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return "";
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" ? cursor.trim() : "";
}

function pictureUrl(value: unknown): string {
  return [
    nestedString(value, ["picture", "data", "url"]),
    nestedString(value, ["picture", "url"]),
    nestedString(value, ["profile_picture_url"]),
    nestedString(value, ["profilePictureUrl"]),
    nestedString(value, ["avatar_url"]),
  ].find(Boolean) || "";
}

function displayName(channel: SocialConnectChannel, account: Record<string, unknown>) {
  const data = account.data;
  return [
    account.alias,
    account.name,
    account.displayName,
    account.username,
    nestedString(data, ["name"]),
    nestedString(data, ["username"]),
    nestedString(data, ["account", "name"]),
    nestedString(data, ["account", "username"]),
    `${channel === "facebook" ? "Facebook" : channel === "instagram" ? "Instagram" : "WhatsApp"} account ${shortAccountId(account)}`,
  ].map((value) => String(value || "").trim()).find(Boolean) || "Connected account";
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstArray(value: unknown, path: string[]): Record<string, unknown>[] {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return [];
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return Array.isArray(cursor)
    ? cursor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

async function executeComposioTool(
  composio: ReturnType<typeof createComposioClient>,
  toolSlug: string,
  userId: string,
  connectedAccountId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await composio.tools.execute(toolSlug, {
    userId,
    connectedAccountId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
  return jsonRecord(result);
}

async function enrichConnectedAccount(input: {
  channel: SocialConnectChannel;
  composio: ReturnType<typeof createComposioClient>;
  userId: string;
  connectedAccountId: string;
  account: Record<string, unknown>;
}): Promise<{
  selectedAssetId: string;
  selectedAssetName: string;
  sourceDetail: Record<string, unknown>;
  defaultSendArguments: Record<string, unknown>;
}> {
  const fallbackName = displayName(input.channel, input.account);
  if (input.channel === "instagram") {
    try {
      const info = await executeComposioTool(
        input.composio,
        "INSTAGRAM_GET_USER_INFO",
        input.userId,
        input.connectedAccountId,
        { ig_user_id: "me", fields: "id,username,name,account_type,profile_picture_url" },
      );
      const data = jsonRecord(info.data);
      const username = String(data.username || "").trim();
      const id = String(data.id || "").trim();
      const name = String(data.name || "").trim();
      const profileImageUrl = pictureUrl(data);
      return {
        selectedAssetId: id || input.connectedAccountId,
        selectedAssetName: username ? `@${username.replace(/^@/, "")}` : name || fallbackName,
        sourceDetail: {
          instagram_user_id: id,
          username,
          handle: username ? `@${username.replace(/^@/, "")}` : "",
          display_name: name || (username ? `@${username.replace(/^@/, "")}` : fallbackName),
          account_type: String(data.account_type || ""),
          profile_image_url: profileImageUrl,
          profile_url: username ? `https://www.instagram.com/${username.replace(/^@/, "")}/` : "",
        },
        defaultSendArguments: {},
      };
    } catch (error) {
      return {
        selectedAssetId: input.connectedAccountId,
        selectedAssetName: fallbackName,
        sourceDetail: { enrich_error: error instanceof Error ? error.message : String(error) },
        defaultSendArguments: {},
      };
    }
  }

  if (input.channel === "facebook") {
    try {
      const pagesResult = await executeComposioTool(
        input.composio,
        "FACEBOOK_LIST_MANAGED_PAGES",
        input.userId,
        input.connectedAccountId,
        { limit: 25, fields: "id,name,category,tasks,link,picture" },
      );
      const pages = firstArray(pagesResult, ["data", "data"]);
      const configuredPageId = process.env.COMPOSIO_FACEBOOK_PAGE_ID || "";
      const page = pages.find((item) => String(item.id || "") === configuredPageId) || pages[0] || {};
      const pageId = String(page.id || "").trim();
      const pageName = String(page.name || "").trim();
      const pagePictureUrl = pictureUrl(page);
      return {
        selectedAssetId: pageId || input.connectedAccountId,
        selectedAssetName: pageName || fallbackName,
        sourceDetail: {
          page_id: pageId,
          page_name: pageName,
          page_category: String(page.category || ""),
          page_count: pages.length,
          profile_image_url: pagePictureUrl,
          page_picture_url: pagePictureUrl,
          profile_url: String(page.link || ""),
        },
        defaultSendArguments: pageId ? { page_id: pageId } : {},
      };
    } catch (error) {
      return {
        selectedAssetId: input.connectedAccountId,
        selectedAssetName: fallbackName,
        sourceDetail: { enrich_error: error instanceof Error ? error.message : String(error) },
        defaultSendArguments: {},
      };
    }
  }

  if (input.channel === "whatsapp") {
    try {
      const phoneResult = await executeComposioTool(
        input.composio,
        "WHATSAPP_GET_PHONE_NUMBERS",
        input.userId,
        input.connectedAccountId,
        { limit: 25 },
      );
      const phones = [
        ...firstArray(phoneResult, ["data", "data"]),
        ...firstArray(phoneResult, ["data", "phone_numbers"]),
        ...firstArray(phoneResult, ["data"]),
      ];
      const phone = phones[0] || {};
      const phoneNumberId = String(phone.id || phone.phone_number_id || "").trim();
      const displayPhone = String(phone.display_phone_number || phone.verified_name || phone.name || "").trim();
      const verifiedName = String(phone.verified_name || phone.name || "").trim();
      return {
        selectedAssetId: phoneNumberId || input.connectedAccountId,
        selectedAssetName: displayPhone || fallbackName,
        sourceDetail: {
          phone_number_id: phoneNumberId,
          display_phone_number: displayPhone,
          verified_name: verifiedName,
          display_name: verifiedName || displayPhone,
          phone_count: phones.length,
        },
        defaultSendArguments: phoneNumberId ? { phone_number_id: phoneNumberId } : {},
      };
    } catch (error) {
      return {
        selectedAssetId: input.connectedAccountId,
        selectedAssetName: fallbackName,
        sourceDetail: { enrich_error: error instanceof Error ? error.message : String(error) },
        defaultSendArguments: {},
      };
    }
  }

  return {
    selectedAssetId: input.connectedAccountId,
    selectedAssetName: fallbackName,
    sourceDetail: {},
    defaultSendArguments: {},
  };
}

export async function syncComposioSocialConnections(input: {
  userEmail: string;
  clientId?: string;
}): Promise<SyncResult> {
  const result: SyncResult = { checked: false, synced: 0, stale: 0, errors: [] };
  if (!composioEnabled()) return result;

  const composio = createComposioClient();
  const userId = composioExternalUserId(input.userEmail);
  result.checked = true;

  for (const channel of SOCIAL_CHANNELS) {
    const authConfigId = composioAuthConfigId(channel);
    if (!authConfigId) continue;

    try {
      const response = await composio.connectedAccounts.list({
        userIds: [userId],
        authConfigIds: [authConfigId],
        statuses: ["ACTIVE"],
        orderBy: "updated_at",
      });
      const activeAccountIds = new Set(
        (response.items || [])
          .map((account) => String((account as unknown as Record<string, unknown>).id || "").trim())
          .filter(Boolean),
      );
      const activeSelectedAssetIdsByAccountId = new Map<string, string>();
      for (const account of response.items || []) {
        const record = account as unknown as Record<string, unknown>;
        const accountId = String(record.id || "").trim();
        if (!accountId) continue;
        const enriched = await enrichConnectedAccount({
          channel,
          composio,
          userId,
          connectedAccountId: accountId,
          account: record,
        });
        activeSelectedAssetIdsByAccountId.set(accountId, enriched.selectedAssetId);
        const socialChannel = dashboardChannel(channel) as "instagram" | "messenger" | "whatsapp";
        const health = composioSocialSendHealth(socialChannel, {
          metadata: {
            default_send_arguments: enriched.defaultSendArguments,
          },
        });
        const outboundReady = health.outboundReady;

        await upsertChannelConnection({
          channel: dashboardChannel(channel),
          provider: providerFor(channel),
          external_user_id: userId,
          auth_config_id: authConfigId,
          connected_account_id: accountId,
          selected_asset_id: enriched.selectedAssetId,
          selected_asset_name: enriched.selectedAssetName,
          selected_asset_type: selectedAssetType(channel),
          status: "connected",
          health_reason: outboundReady
            ? "Connected through Composio. Sending is configured."
            : `Connected through Composio. Finish send setup: ${health.missing.join(", ")}.`,
          metadata: {
            composio_auth_configured: true,
            toolkit: channel,
            word_id: typeof record.wordId === "string" ? record.wordId : "",
            display_name: enriched.selectedAssetName,
            account_label_source: "composio",
            synced_from_composio: true,
            outbound_ready: outboundReady,
            outbound_missing: health.missing,
            default_send_arguments: enriched.defaultSendArguments,
            selected_asset_id: enriched.selectedAssetId,
            ...enriched.sourceDetail,
          },
        }, { clientId: input.clientId });
        result.synced += 1;
      }
      const saved = await listChannelConnections({ clientId: input.clientId });
      const staleConnections = saved.connections.filter((connection) => (
        connection.provider === providerFor(channel)
        && connection.status === "connected"
        && connection.external_user_id === userId
        && connection.auth_config_id === authConfigId
        && (
          !connection.connected_account_id
          || (
            Boolean(connection.connected_account_id)
            && !activeAccountIds.has(connection.connected_account_id)
          )
          || (
            Boolean(activeSelectedAssetIdsByAccountId.get(connection.connected_account_id))
            && connection.selected_asset_id !== activeSelectedAssetIdsByAccountId.get(connection.connected_account_id)
          )
        )
      ));
      for (const stale of staleConnections) {
        const expectedAssetId = activeSelectedAssetIdsByAccountId.get(stale.connected_account_id);
        await upsertChannelConnection({
          ...stale,
          status: "needs_config",
          health_reason: expectedAssetId
            ? "Composio selected asset changed. This duplicate row is inactive."
            : "Composio account is no longer active. Reconnect this channel.",
          metadata: {
            ...stale.metadata,
            stale_composio_connection: true,
            outbound_ready: false,
            outbound_missing: ["connected_account"],
          },
        }, { clientId: input.clientId });
        result.stale += 1;
      }
    } catch (error) {
      result.errors.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
