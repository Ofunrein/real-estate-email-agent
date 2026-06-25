import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET as connectMetaChannel } from "@/app/api/channels/meta/connect/route";
import { GET as metaCallback } from "@/app/api/channels/meta/callback/route";

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

test("Meta connect uses direct OAuth scopes by default", async () => {
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
    assert.equal(oauthUrl.searchParams.get("config_id"), null);
    assert.equal(oauthUrl.searchParams.get("scope"), "openid,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages");
    assert.equal(oauthUrl.searchParams.get("redirect_uri"), "https://app.lumenosis.com/api/channels/meta/callback");
    assert.deepEqual(JSON.parse(Buffer.from(oauthUrl.searchParams.get("state") || "", "base64url").toString()), {
      channel: "instagram",
    });
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
    assert.equal(oauthUrl.searchParams.get("config_id"), "override_123");
    assert.equal(oauthUrl.searchParams.get("scope"), "openid,pages_messaging,pages_manage_metadata");
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
