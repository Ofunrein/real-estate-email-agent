import { test } from "node:test";
import assert from "node:assert/strict";

import { inferCategorySlug } from "@/lib/inboxSettings";
import { threadNeedsHuman } from "@/lib/inboxThreadUtils";
import type { SheetRow } from "@/lib/sheetSchema";

function event(overrides: Partial<SheetRow>): SheetRow {
  return {
    event_at: "2026-06-27T10:00:00.000Z",
    created_at: "2026-06-27T10:00:00.000Z",
    channel: "instagram",
    direction: "inbound",
    status: "needs_human",
    event_type: "instagram_inbound",
    ai_action: "",
    handoff_reason: "needs review",
    summary: "",
    message_text: "I am interested in a property",
    ...overrides,
  } as SheetRow;
}

test("review resolution clears stale needs-human state until a newer inbound arrives", () => {
  const events = [
    event({
      event_at: "2026-06-27T10:00:00.000Z",
      created_at: "2026-06-27T10:00:00.000Z",
    }),
    event({
      event_at: "2026-06-27T10:05:00.000Z",
      created_at: "2026-06-27T10:05:00.000Z",
      direction: "outbound",
      status: "review_resolved",
      event_type: "instagram_review_resolved",
      ai_action: "resume_ai",
      handoff_reason: "",
      summary: "Human cleared review.",
      message_text: "",
    }),
  ];

  assert.equal(threadNeedsHuman(events), false);
  assert.notEqual(inferCategorySlug(events), "needs_human");
});

test("new inbound after review resolution can flag needs-human again", () => {
  const events = [
    event({
      event_at: "2026-06-27T10:00:00.000Z",
      created_at: "2026-06-27T10:00:00.000Z",
    }),
    event({
      event_at: "2026-06-27T10:05:00.000Z",
      created_at: "2026-06-27T10:05:00.000Z",
      direction: "outbound",
      status: "review_resolved",
      event_type: "instagram_review_resolved",
      ai_action: "resume_ai",
      handoff_reason: "",
      summary: "Human cleared review.",
      message_text: "",
    }),
    event({
      event_at: "2026-06-27T10:06:00.000Z",
      created_at: "2026-06-27T10:06:00.000Z",
      message_text: "I want to tour this house",
      handoff_reason: "",
      status: "received",
    }),
  ];

  assert.equal(inferCategorySlug(events), "needs_human");
});

test("outbound AI reply after latest inbound clears stale needs-human category text", () => {
  const events = [
    event({
      event_at: "2026-06-29T06:18:16.000Z",
      created_at: "2026-06-29T06:18:16.000Z",
      channel: "email",
      direction: "inbound",
      status: "processed",
      ai_action: "draft_reply",
      handoff_reason: "",
      summary: "Human review reason — needs_human_review",
      message_text: "How about tomorrow afternoon?",
    }),
    event({
      event_at: "2026-06-29T06:18:17.000Z",
      created_at: "2026-06-29T06:18:17.000Z",
      channel: "email",
      direction: "outbound",
      status: "sent",
      event_type: "email_ai_reply",
      ai_action: "auto_reply_sent",
      handoff_reason: "",
      summary: "Iris replied to the lead.",
      message_text: "Noon works great. Can you confirm the date?",
    }),
  ];

  assert.notEqual(inferCategorySlug(events), "needs_human");
});
