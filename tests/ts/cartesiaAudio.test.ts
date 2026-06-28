import assert from "node:assert/strict";
import test from "node:test";

import { cloneCartesiaVoice } from "@/lib/cartesiaAudio";

test("cloneCartesiaVoice sends Cartesia clone multipart contract", async () => {
  const previousKey = process.env.CARTESIA_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.CARTESIA_API_KEY = "test-cartesia-key";

  try {
    globalThis.fetch = async (_input, init) => {
      const body = init?.body;
      assert.ok(body instanceof FormData);
      assert.ok(body.get("clip") instanceof File);
      assert.equal(body.get("audio"), null);
      assert.equal(body.get("name"), "Operator voice");
      assert.equal(body.get("language"), "en");
      return new Response(JSON.stringify({ id: "voice_123", name: "Operator voice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const file = new File([Buffer.from("wav")], "voice.wav", { type: "audio/wav" });
    const result = await cloneCartesiaVoice({ title: "Operator voice", files: [file] });

    assert.equal(result.id, "voice_123");
    assert.equal(result.title, "Operator voice");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env.CARTESIA_API_KEY;
    } else {
      process.env.CARTESIA_API_KEY = previousKey;
    }
  }
});
