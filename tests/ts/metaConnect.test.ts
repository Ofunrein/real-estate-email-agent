import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET as connectMetaChannel } from "@/app/api/channels/meta/connect/route";
import { GET as metaCallback } from "@/app/api/channels/meta/callback/route";
import { metaDirectConnectionInputForPage } from "@/lib/metaDirectConnection";

function withMetaConnectEnv<T>(env: NodeJS.ProcessEnv, run: () => T): T {
  const prior = {
    META_APP_ID: process.env.META_APP_ID,
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    AUTH_URL: process.env.AUTH_URL,
    CLIENT_ID: process.env.CLIENT_ID,
    META_BUSINESS_LOGIN_CONFIG_ID: process.env.META_BUSINESS_LOGIN_CONFIG_ID,
    META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID: process.env.META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID,
    META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID: process.env.META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID,
    META_USE_BUSINESS_LOGIN_CONFIG: process.env.META_USE_BUSINESS_LOGIN_CONFIG,
  };
  Object.assign(process.env, env);
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Meta connect uses configured Business Login config by default", async () => {
  await withMetaConnectEnv({
    META_APP_ID: "2482694768826545",
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
    META_BUSINESS_LOGIN_CONFIG_ID: "shared_config",
    META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID: "instagram_config",
    META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID: "messenger_config",
    META_USE_BUSINESS_LOGIN_CONFIG: "",
  }, async () => {
    const response = await connectMetaChannel(new NextRequest("https://app.lumenosis.com/api/channels/meta/connect?channel=instagram"));
    const location = response.headers.get("location");
    assert.ok(location);

    const oauthUrl = new URL(location);
    assert.equal(oauthUrl.origin, "https://www.facebook.com");
    assert.equal(oauthUrl.pathname, "/v20.0/dialog/oauth");
    assert.equal(oauthUrl.searchParams.get("config_id"), "instagram_config");
    assert.equal(oauthUrl.searchParams.get("scope"), "openid");
    assert.equal(oauthUrl.searchParams.get("override_default_response_type"), "true");
    assert.equal(oauthUrl.searchParams.get("auth_type"), "rerequest");
    assert.equal(oauthUrl.searchParams.get("redirect_uri"), "https://app.lumenosis.com/api/channels/meta/callback");
    assert.deepEqual(JSON.parse(Buffer.from(oauthUrl.searchParams.get("state") || "", "base64url").toString()), {
      channel: "instagram",
    });
  });
});

test("Meta connect can opt out of Business Login config for direct OAuth scopes", async () => {
  await withMetaConnectEnv({
    META_APP_ID: "2482694768826545",
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
    META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID: "instagram_config",
    META_USE_BUSINESS_LOGIN_CONFIG: "false",
  }, async () => {
    const response = await connectMetaChannel(new NextRequest("https://app.lumenosis.com/api/channels/meta/connect?channel=instagram"));
    const location = response.headers.get("location");
    assert.ok(location);

    const oauthUrl = new URL(location);
    assert.equal(oauthUrl.searchParams.get("config_id"), null);
    assert.equal(oauthUrl.searchParams.get("scope"), "openid,pages_show_list,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages");
  });
});

test("Meta connect does not use shared Business Login config for Messenger", async () => {
  await withMetaConnectEnv({
    META_APP_ID: "2482694768826545",
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
    META_BUSINESS_LOGIN_CONFIG_ID: "instagram_only_config",
  }, async () => {
    const response = await connectMetaChannel(new NextRequest("https://app.lumenosis.com/api/channels/meta/connect?channel=messenger"));
    const location = response.headers.get("location");
    assert.ok(location);

    const oauthUrl = new URL(location);
    assert.equal(oauthUrl.searchParams.get("config_id"), null);
    assert.equal(oauthUrl.searchParams.get("scope"), "openid,pages_show_list,pages_messaging,pages_manage_metadata");
  });
});

test("Meta connect only includes client id in state when explicitly requested", async () => {
  await withMetaConnectEnv({
    META_APP_ID: "2482694768826545",
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
    CLIENT_ID: "ryse-realty",
  }, async () => {
    const response = await connectMetaChannel(new NextRequest("https://app.lumenosis.com/api/channels/meta/connect?channel=instagram&client_id=lumenosis"));
    const location = response.headers.get("location");
    assert.ok(location);

    const oauthUrl = new URL(location);
    assert.deepEqual(JSON.parse(Buffer.from(oauthUrl.searchParams.get("state") || "", "base64url").toString()), {
      clientId: "lumenosis",
      channel: "instagram",
    });
  });
});

test("Meta connect allows explicit config_id override", async () => {
  await withMetaConnectEnv({
    META_APP_ID: "2482694768826545",
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
  }, async () => {
    const response = await connectMetaChannel(new NextRequest("https://app.lumenosis.com/api/channels/meta/connect?channel=messenger&config_id=override_123"));
    const location = response.headers.get("location");
    assert.ok(location);

    const oauthUrl = new URL(location);
    assert.equal(oauthUrl.pathname, "/v20.0/dialog/oauth");
    assert.equal(oauthUrl.searchParams.get("config_id"), "override_123");
    assert.equal(oauthUrl.searchParams.get("scope"), "openid");
    assert.equal(oauthUrl.searchParams.get("override_default_response_type"), "true");
    assert.equal(oauthUrl.searchParams.get("auth_type"), "rerequest");
  });
});

test("Meta connect can render dashboard setup page", async () => {
  await withMetaConnectEnv({
    META_APP_ID: "2482694768826545",
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
  }, async () => {
    const response = await connectMetaChannel(new NextRequest("https://app.lumenosis.com/api/channels/meta/connect?channel=messenger&use_sdk=1"));
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    const html = await response.text();

    assert.match(html, /Continue with Meta/);
    assert.doesNotMatch(html, /FB\.login/);
    assert.match(html, /scope=openid%2Cpages_show_list%2Cpages_messaging%2Cpages_manage_metadata/);
    assert.match(html, /api%2Fchannels%2Fmeta%2Fcallback/);
  });
});

test("Meta callback redirects cancelled auth back to the app", async () => {
  await withMetaConnectEnv({
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
  }, async () => {
    const response = await metaCallback(new NextRequest("https://app.lumenosis.com/api/channels/meta/callback?error=access_denied"));
    const location = response.headers.get("location");
    assert.ok(location);

    const redirectUrl = new URL(location);
    assert.equal(redirectUrl.origin, "https://app.lumenosis.com");
    assert.equal(redirectUrl.searchParams.get("metaConnectError"), "access_denied");
  });
});

test("Meta callback maps Instagram pages to Instagram business account assets", () => {
  const input = metaDirectConnectionInputForPage({
    id: "page_123",
    name: "Martn.ai",
    access_token: "page_token",
    category: "Real Estate",
    instagram_business_account: {
      id: "17841400000000000",
      username: "martn.ai",
      profile_picture_url: "https://cdn.example.com/profile.jpg",
    },
  }, "instagram");

  assert.ok(input);
  assert.equal(input.provider, "meta_direct");
  assert.equal(input.channel, "instagram");
  assert.equal(input.selected_asset_id, "17841400000000000");
  assert.equal(input.selected_asset_name, "martn.ai");
  assert.equal(input.selected_asset_type, "instagram_business_account");
  assert.equal(input.page_access_token, "page_token");
  assert.equal(input.metadata?.page_id, "page_123");
  assert.equal(input.metadata?.instagram_user_id, "17841400000000000");
  assert.equal(input.metadata?.instagram_username, "martn.ai");
});

test("Meta callback skips Instagram pages with no linked business account", () => {
  const input = metaDirectConnectionInputForPage({
    id: "page_123",
    name: "Martn.ai",
    access_token: "page_token",
  }, "instagram");

  assert.equal(input, null);
});

test("Meta callback maps Messenger pages to Page assets", () => {
  const input = metaDirectConnectionInputForPage({
    id: "page_123",
    name: "Martn.ai",
    access_token: "page_token",
    category: "Real Estate",
  }, "messenger");

  assert.ok(input);
  assert.equal(input.provider, "meta_direct");
  assert.equal(input.channel, "messenger");
  assert.equal(input.selected_asset_id, "page_123");
  assert.equal(input.selected_asset_name, "Martn.ai");
  assert.equal(input.selected_asset_type, "page");
  assert.equal(input.page_access_token, "page_token");
  assert.equal(input.metadata?.page_id, "page_123");
});
