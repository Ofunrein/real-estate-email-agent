import assert from "node:assert/strict";
import test from "node:test";
import { coalesceIrisEmailThreadFollowUps, classifyIrisEmailText, generateIrisEmailReply, finalizeIrisReplyForMessage, buildHtmlEmailReply } from "../../lib/irisEmail";

test("MIME wrapping and changed valuation consent preserve the current showing request", () => {
  const body = "We also need to change the possible tour to Sunday, September 20 at 2 PM\r\ninstead of Saturday. Keep that tentative, not booked. And I have changed my\r\nmind about the free home valuation: yes, please send me the link.";
  const message = { subject: "Tour enquiry for 9605 Corbe Dr", body: body + "\n\nThread context for classification only:\nWe own our current home and need to sell before buying within two to three months. We are not ready to request a valuation yet. Saturday, September 19 at 11 AM." };
  const c = classifyIrisEmailText(message);
  assert.notEqual(c.intent, "property_search");
  assert.ok(c.opportunity_tags.includes("valuation_consented"));
  assert.ok(!c.opportunity_tags.includes("valuation_declined"));
  const reply = finalizeIrisReplyForMessage(message, c, [], generateIrisEmailReply(message as any, c) || "");
  assert.match(reply, /Sunday, September 20 at 2 PM/);
  assert.doesNotMatch(reply, /Saturday, September 19 at 11 AM/);
});

test("property cards omit empty and literal null fields", () => {
  const result = buildHtmlEmailReply("Here are the details.\n\nBest,\nIris", [{address: "123 Main St", price: "500000", beds: "3", baths: "2", sqft: "1500", status: "Active", pet_policy: "null", parking: "", year_built: "2005", photo_url: "https://m1.cbhomes.com/p/1113/example/photo.webp"}]);
  assert.match(result.html || "", /<img src="https:\/\/m1\.cbhomes\.com/);
  assert.doesNotMatch(result.html || "", /Not available|<strong>Pet policy:|<strong>Parking:/);
  assert.match(result.text, /Price: \$500,000/);
});

test("coalescing unread older messages cannot override renewed valuation consent", () => {
  const base = {threadId: "test-thread", from: "buyer@example.com", subject: "126 Vailco Ln", to: "agent@example.com"};
  const batch = coalesceIrisEmailThreadFollowUps([
    {...base, id: "older", receivedAt: "2026-09-12T21:00:00Z", body: "We already own our home. Not yet on the valuation. Saturday at 11 AM."},
    {...base, id: "latest", receivedAt: "2026-09-12T21:01:00Z", body: "Yes, we would like the free home valuation now. Please send the form. Change the showing to Sunday at 2 PM."},
  ]);
  const c = classifyIrisEmailText(batch.messages[0]);
  assert.ok(c.opportunity_tags.includes("valuation_consented"));
  assert.ok(!c.opportunity_tags.includes("valuation_declined"));
});
