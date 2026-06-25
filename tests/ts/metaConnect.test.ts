import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET as connectMetaChannel } from "@/app/api/channels/meta/connect/route";

function withMetaConnectEnv<T>(env: NodeJS.ProcessEnv, run: () => T): T {
  const prior = {
    META_APP_ID: process.env.META_APP_ID,
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    AUTH_URL: process.env.AUTH_URL,
    META_BUSINESS_LOGIN_CONFIG_ID: process.env.META_BUSINESS_LOGIN_CONFIG_ID,
    META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID: process.env.META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID,
    META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID: process.env.META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID,
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

test("Meta connect uses Lumenosis Facebook Login for Business config for production app", async () => {
  await withMetaConnectEnv({
    META_APP_ID: "2482694768826545",
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
    META_BUSINESS_LOGIN_CONFIG_ID: "",
    META_INSTAGRAM_BUSINESS_LOGIN_CONFIG_ID: "",
    META_MESSENGER_BUSINESS_LOGIN_CONFIG_ID: "",
  }, async () => {
    const response = await connectMetaChannel(new NextRequest("https://app.lumenosis.com/api/channels/meta/connect?client_id=ryse-realty&channel=instagram"));
    const location = response.headers.get("location");
    assert.ok(location);

    const oauthUrl = new URL(location);
    assert.equal(oauthUrl.origin, "https://www.facebook.com");
    assert.equal(oauthUrl.searchParams.get("config_id"), "884521007425365");
    assert.equal(oauthUrl.searchParams.get("scope"), null);
    assert.equal(oauthUrl.searchParams.get("redirect_uri"), "https://app.lumenosis.com/api/channels/meta/callback");
  });
});

test("Meta connect allows explicit config_id override", async () => {
  await withMetaConnectEnv({
    META_APP_ID: "2482694768826545",
    PUBLIC_BASE_URL: "https://app.lumenosis.com",
  }, async () => {
    const response = await connectMetaChannel(new NextRequest("https://app.lumenosis.com/api/channels/meta/connect?client_id=ryse-realty&channel=messenger&config_id=override_123"));
    const location = response.headers.get("location");
    assert.ok(location);

    const oauthUrl = new URL(location);
    assert.equal(oauthUrl.searchParams.get("config_id"), "override_123");
    assert.equal(oauthUrl.searchParams.get("scope"), null);
  });
});
