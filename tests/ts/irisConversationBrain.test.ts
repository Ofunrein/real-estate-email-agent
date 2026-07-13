import assert from "node:assert/strict";
import { test } from "node:test";

import { runIrisConversationBrain } from "@/lib/irisConversationBrain";

const base = {
  channel: "sms" as const,
  threadRef: "t1",
  events: [] as any[],
  properties: [{ address: "123 Oak St", price: "450000", beds: "3", baths: "2" }] as any[],
  categories: [] as any[],
};

test("disqualifies keyboard-mash junk before drafting, no auto-send", () => {
  const out = runIrisConversationBrain({ ...base, latestMessage: "asdf" });
  assert.equal(out.category, "disqualified");
  assert.equal(out.next_action, "skip_no_reply");
  assert.equal(out.draft, "");
  assert.equal(out.safe_to_auto_send, false);
  assert.equal(out.memory_patch.disqualified, "true");
});

test("disqualifies gibberish with no vowels", () => {
  const out = runIrisConversationBrain({ ...base, latestMessage: "zxcvbnm" });
  assert.equal(out.category, "disqualified");
});

test("disqualifies fake phone number", () => {
  const out = runIrisConversationBrain({ ...base, latestMessage: "interested in a home", lead: { phone: "0000000000" } });
  assert.equal(out.category, "disqualified");
  assert.match(out.reason, /phone/);
});

test("disqualifies out-of-area metro", () => {
  const out = runIrisConversationBrain({ ...base, latestMessage: "looking for a condo in Miami" });
  assert.equal(out.category, "disqualified");
  assert.match(out.reason, /out-of-area/);
});

test("does NOT disqualify a normal in-area inquiry", () => {
  const out = runIrisConversationBrain({ ...base, latestMessage: "is 123 Oak St still available in Round Rock?" });
  assert.notEqual(out.category, "disqualified");
});

test("first touch is short: ack + time ask, no property essay", () => {
  const out = runIrisConversationBrain({ ...base, latestMessage: "is this still available?" });
  assert.notEqual(out.category, "disqualified");
  assert.match(out.draft, /got your inquiry/);
  assert.match(out.draft, /what time works/);
  // short = no price/bed/bath dump on first touch
  assert.doesNotMatch(out.draft, /450000|3 bed/);
});

test("later touch (prior outbound exists) can use detailed property context", () => {
  const out = runIrisConversationBrain({
    ...base,
    events: [{ direction: "outbound", message_text: "got your inquiry, what time works?" }] as any[],
    latestMessage: "can you send photos of 123 Oak St?",
  });
  assert.doesNotMatch(out.draft, /got your inquiry/);
  assert.match(out.draft, /photos|123 Oak St/);
});
