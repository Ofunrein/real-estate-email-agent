import { test } from "node:test";
import assert from "node:assert/strict";

import { composeInboxData, parseVoiceTranscript, voiceCallTranscriptSource } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

test("composeInboxData hides reserved SMS smoke-test numbers", () => {
  const data = composeInboxData(
    [
      { phone: "+15551230008" } as SheetRow,
      { phone: "+15128152032" } as SheetRow,
    ],
    [
      { channel: "sms", phone: "+15551230008", thread_ref: "sms:+15551230008", direction: "outbound" } as SheetRow,
      { channel: "sms", phone: "+15128152032", thread_ref: "sms:+15128152032", direction: "outbound" } as SheetRow,
    ],
    [],
  );

  assert.equal(data.leads.length, 1);
  assert.equal(data.leads[0].phone, "+15128152032");
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].phone, "+15128152032");
  assert.equal(data.metrics.event_count, 1);
});

test("composeInboxData hides raw voice tool events and counts voice calls", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "voice",
        phone: "+15128152032",
        thread_ref: "voice:verify_lookupProperty",
        event_type: "voice_property_lookup",
        direction: "inbound",
      } as SheetRow,
      {
        channel: "sms",
        phone: "+15128152032",
        thread_ref: "sms:+15128152032",
        direction: "inbound",
      } as SheetRow,
    ],
    [],
    [{ phone: "+15128152032", thread_ref: "voice:+15128152032" } as SheetRow],
  );

  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].channel, "sms");
  assert.equal(data.metrics.channels.voice, 1);
  assert.equal(data.metrics.channels.sms, 1);
});

test("parseVoiceTranscript: parses Vapi AI/User colon lines", () => {
  const turns = parseVoiceTranscript("AI: Hello there\nUser: 4309 Fairway Path");
  assert.equal(turns.length, 2);
  assert.equal(turns[0].speaker, "Iris");
  assert.equal(turns[0].direction, "outbound");
  assert.equal(turns[0].text, "Hello there");
  assert.equal(turns[1].speaker, "Lead");
  assert.equal(turns[1].text, "4309 Fairway Path");
});

test("parseVoiceTranscript: supports speaker label on its own line", () => {
  const turns = parseVoiceTranscript("AI:\nThanks for calling\nUser:\nLooking at 123 Main");
  assert.equal(turns.length, 2);
  assert.equal(turns[0].text, "Thanks for calling");
  assert.equal(turns[1].text, "Looking at 123 Main");
});

test("parseVoiceTranscript: parses JSON message arrays", () => {
  const turns = parseVoiceTranscript(JSON.stringify([
    { role: "assistant", message: "How can I help?" },
    { role: "user", message: "Tell me about 4309 Fairway Path." },
  ]));
  assert.equal(turns.length, 2);
  assert.equal(turns[0].speaker, "Iris");
  assert.equal(turns[1].speaker, "Lead");
  assert.match(turns[1].text, /Fairway Path/);
});

test("voiceCallTranscriptSource: ignores object stringification junk", () => {
  assert.equal(voiceCallTranscriptSource({ transcript: "[object Object]" } as SheetRow), "");
  assert.equal(voiceCallTranscriptSource({ message_text: "AI: hi" } as SheetRow), "AI: hi");
});
