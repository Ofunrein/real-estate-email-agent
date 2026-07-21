import { test } from "node:test";
import assert from "node:assert/strict";

import { emailConnectPath } from "@/lib/emailConnect";

test("email OAuth buttons use provider-specific routes", () => {
  assert.equal(emailConnectPath("gmail"), "/api/settings/email-account/connect");
  assert.equal(emailConnectPath("outlook"), "/api/settings/email-account/outlook-connect");
});
