import assert from "node:assert/strict";
import { test } from "node:test";

import { generateIrisTextReply } from "@/lib/irisTextAgent";

test("shared Iris text brain handles every text reply channel", async () => {
  const prior = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    for (const source of ["sms", "whatsapp", "instagram", "messenger"] as const) {
      const result = await generateIrisTextReply({ message: "Hi, I need a home in Austin", source });
      assert.equal(result.shouldSend, true, source);
      assert.ok(result.reply, source);
      assert.notEqual(result.status, "needs_human", source);
    }
  } finally {
    if (prior == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prior;
  }
});
