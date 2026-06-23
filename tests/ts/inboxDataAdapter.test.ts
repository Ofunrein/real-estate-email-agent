import { test } from "node:test";
import assert from "node:assert/strict";

import { adaptInboxData } from "@/lib/inboxDataAdapter";
import { composeInboxData } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

test("adaptInboxData keeps received email subject and body separate", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "email",
        direction: "inbound",
        email: "lead@example.com",
        thread_ref: "gmail-thread-1",
        message_text: "Can I see the 4309 Fairway Path photos?\n\nI am free tomorrow.",
        summary: [
          "Lead: Buyer <lead@example.com>",
          "Source: gmail / Question about Fairway Path",
          "Intent: showing_request",
        ].join("\n"),
        event_at: "2026-06-19T15:00:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const message = model.emailThreads[0].messages[0];
  assert.equal(message.subject, "Question about Fairway Path");
  assert.match(message.body || "", /Can I see the 4309 Fairway Path photos\?/);
});

test("adaptInboxData renders email HTML through the inbox image proxy", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "email",
        direction: "outbound",
        email: "lead@example.com",
        thread_ref: "gmail-thread-2",
        message_text: '<p>Here is the listing.</p><img src="https://photos.zillowstatic.com/fp/example-p_e.jpg">',
        event_at: "2026-06-19T15:02:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const html = model.emailThreads[0].messages[0].html || "";
  assert.match(html, /\/api\/media\/proxy\?url=/);
  assert.doesNotMatch(html, /<script/i);
});

test("adaptInboxData splits SMS MMS image logs from visible body and preserves spacing", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "sms",
        direction: "outbound",
        phone: "+15128469460",
        thread_ref: "sms:+15128469460",
        message_text: [
          "Here are the photos:",
          "",
          "4309 Fairway Path",
          "  3 beds",
          "MMS image: https://photos.zillowstatic.com/fp/example-p_e.jpg",
        ].join("\n"),
        event_at: "2026-06-19T15:04:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  assert.equal(model.smsThreads[0].preview, "Here are the photos:\n\n4309 Fairway Path\n  3 beds");
  const message = model.smsThreads[0].messages[0];
  assert.equal(message.body, "Here are the photos:\n\n4309 Fairway Path\n  3 beds");
  assert.equal(message.media?.length, 1);
  assert.match(message.media?.[0].url || "", /\/api\/media\/proxy\?url=/);
});

test("adaptInboxData removes duplicated SMS property detail address lines", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "sms",
        direction: "outbound",
        phone: "+15128469460",
        thread_ref: "sms:+15128469460",
        message_text: [
          "Here are the full details on 6828 Walkup Ln, Austin, Texas 78747:",
          "6828 Walkup Ln, Austin, Texas 78747 • $319,500 • 4bd/3ba • 2,068 square feet",
          "https://www.zillow.com/homedetails/6828-Walkup-Ln-Austin-TX-78747/70342397_zpid/",
        ].join("\n"),
        event_at: "2026-06-20T23:28:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const body = model.smsThreads[0].messages[0].body;
  assert.equal(
    body,
    [
      "Here are the full details on 6828 Walkup Ln, Austin, Texas 78747:",
      "$319,500 • 4bd/3ba • 2,068 square feet",
      "https://www.zillow.com/homedetails/6828-Walkup-Ln-Austin-TX-78747/70342397_zpid/",
    ].join("\n"),
  );
});

test("adaptInboxData aligns activity event ids with rendered message ids", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "email",
        direction: "inbound",
        email: "lead@example.com",
        thread_ref: "gmail-thread-3",
        gmail_message_id: "gmail-msg-3",
        message_text: "Can I tour the 4309 Fairway Path home?",
        event_at: "2026-06-19T15:06:00.000Z",
      } as SheetRow,
      {
        channel: "sms",
        direction: "inbound",
        phone: "+15125550123",
        thread_ref: "sms:+15125550123",
        message_text: "Can you text the address?",
        event_at: "2026-06-19T15:07:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const emailActivity = model.activityEvents.find((event) => event.channel === "email");
  const smsActivity = model.activityEvents.find((event) => event.channel === "sms");
  assert.equal(emailActivity?.eventId, model.emailThreads[0].messages[0].eventId);
  assert.equal(smsActivity?.eventId, model.smsThreads[0].messages[0].eventId);
  assert.notEqual(smsActivity?.eventId, "sms:+15125550123");
});

test("adaptInboxData shows Instagram contact name but preserves platform recipient id for replies", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "martn.o",
        phone: "1526516032549624",
        thread_ref: "instagram:thread-abc",
        gmail_message_id: "instagram:message-1",
        message_text: "Thanks bud looking for a home in Austin",
        event_at: "2026-06-22T09:18:36.000Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "outbound",
        full_name: "martn.o",
        phone: "1526516032549624",
        thread_ref: "instagram:thread-abc",
        gmail_message_id: "instagram:message-2",
        message_text: "Send me the area, budget, and bedroom count and I'll narrow it down.",
        event_at: "2026-06-22T10:09:12.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(thread.id, "1526516032549624");
  assert.equal(thread.contact, "martn.o");
  assert.equal(thread.replyTo, "1526516032549624");
  assert.equal(thread.messageCount, 2);
});

test("adaptInboxData keeps social owner replies in the same sender thread", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "martn.o",
        phone: "1526516032549624",
        thread_ref: "instagram:thread-abc",
        gmail_message_id: "instagram:message-1",
        message_text: "Can you send me some 3 beds 3 baths in Austin?",
        event_at: "2026-06-22T12:05:10.000Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "outbound",
        agent_name: "Owner",
        source: "human_takeover",
        phone: "1526516032549624",
        thread_ref: "1526516032549624",
        message_text: "I can help",
        event_at: "2026-06-22T12:06:17.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(model.textThreads.instagram.length, 1);
  assert.equal(thread.id, "1526516032549624");
  assert.equal(thread.messageCount, 2);
  assert.equal(thread.messages[1]?.direction, "owner");
});

test("adaptInboxData renders social media from media_json even when the text body only logs send status", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "messenger",
        direction: "outbound",
        agent_name: "Owner",
        source: "human_takeover",
        full_name: "Martin",
        phone: "messenger-user-1",
        thread_ref: "messenger:thread-1",
        gmail_message_id: "messenger:message-2",
        message_text: "Sent the files you asked for.",
        media_json: JSON.stringify([
          { type: "audio", url: "https://cdn.example.com/voice-note.m4a", transcript: "I can send more options after this." },
          { type: "image", url: "https://cdn.example.com/photo.jpg" },
        ]),
        event_at: "2026-06-22T12:06:17.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.messenger[0];
  const message = thread.messages[0];

  assert.equal(thread.preview, "Sent the files you asked for.");
  assert.equal(message.media?.length, 2);
  assert.equal(message.media?.[0].kind, "audio");
  assert.equal(message.media?.[1].kind, "image");
});

test("adaptInboxData preserves email voice note attachments and transcript previews from media_json", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "email",
        direction: "outbound",
        email: "lead@example.com",
        thread_ref: "gmail-thread-voice",
        gmail_message_id: "gmail-msg-voice",
        message_text: "Attached is the voice note recap for 4309 Fairway Path.",
        media_json: JSON.stringify([
          { type: "audio", url: "https://cdn.example.com/email-voice-note.m4a", transcript: "The seller is open to a same-week showing." },
        ]),
        event_at: "2026-06-22T12:10:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const message = model.emailThreads[0].messages[0];

  assert.equal(message.media?.length, 1);
  assert.equal(message.media?.[0].kind, "audio");
  assert.equal(message.media?.[0].transcript, "The seller is open to a same-week showing.");
  assert.equal(model.emailThreads[0].preview, "Attached is the voice note recap for 4309 Fairway Path.");
});

test("adaptInboxData sorts voice contacts and calls by actual call time", () => {
  const data = composeInboxData(
    [],
    [],
    [],
    [
      {
        call_id: "newer-call-inserted-first",
        phone: "+15125712595",
        started_at: "2026-06-19T12:55:17.418Z",
        ended_at: "2026-06-19T12:55:41.481Z",
        summary: "Latest call",
        transcript: "AI: Hi\nUser: Latest",
        recording_url: "https://storage.vapi.ai/latest.wav",
      } as SheetRow,
      {
        call_id: "older-call-inserted-last",
        phone: "+15125712595",
        started_at: "2026-06-19T10:38:07.905Z",
        ended_at: "2026-06-19T10:41:32.019Z",
        summary: "Older call",
        transcript: "AI: Hi\nUser: Older",
        recording_url: "https://storage.vapi.ai/older.wav",
      } as SheetRow,
      {
        call_id: "other-contact-middle",
        phone: "+15128152032",
        started_at: "2026-06-19T12:58:48.143Z",
        ended_at: "2026-06-19T12:59:45.666Z",
        summary: "Other latest contact",
        transcript: "AI: Hi\nUser: Other",
      } as SheetRow,
    ],
  );

  const model = adaptInboxData(data);
  assert.equal(model.voiceContacts[0].phone, "+15128152032");
  assert.equal(model.voiceContacts[1].phone, "+15125712595");
  assert.equal(model.voiceContacts[1].contact, "Unknown caller");
  assert.equal(model.voiceContacts[1].summary, "Latest call");
  assert.equal(model.voiceContacts[1].calls[0].id, "newer-call-inserted-first");
  assert.equal(model.voiceContacts[1].calls[1].id, "older-call-inserted-last");
});

test("adaptInboxData merges recent voice calls into activity feed", () => {
  const data = composeInboxData(
    [],
    Array.from({ length: 16 }, (_, i) => ({
      channel: "sms",
      direction: "outbound",
      phone: "+15125712595",
      thread_ref: `sms-${i}`,
      message_text: `older sms ${i}`,
      event_at: new Date(Date.UTC(2026, 5, 20, 10, i)).toISOString(),
    } as SheetRow)),
    [],
    [
      {
        call_id: "newest-voice-call",
        thread_ref: "voice:newest-voice-call",
        phone: "+15125712595",
        direction: "inbound",
        started_at: "2026-06-21T08:52:51.050Z",
        ended_at: "2026-06-21T08:54:35.863Z",
        summary: "Latest voice call summary",
        transcript: "AI: Hi\nUser: Need listings",
        ended_reason: "assistant-forwarded-call",
      } as SheetRow,
    ],
  );

  const model = adaptInboxData(data);
  assert.equal(model.activityEvents[0].id, "newest-voice-call");
  assert.equal(model.activityEvents[0].channel, "voice");
  assert.equal(model.activityEvents[0].body, "Latest voice call summary");
  assert.equal(model.activityEvents.length, 17);
});

test("adaptInboxData calculates today's average response time from actual thread replies", () => {
  const base = new Date();
  base.setMilliseconds(0);
  const inboundAt = new Date(base.getTime() - 90_000).toISOString();
  const outboundAt = new Date(base.getTime() - 45_000).toISOString();
  const data = composeInboxData(
    [],
    [
      {
        channel: "sms",
        direction: "inbound",
        phone: "+15125550000",
        thread_ref: "sms:+15125550000",
        message_text: "Can you send options?",
        event_at: inboundAt,
      } as SheetRow,
      {
        channel: "sms",
        direction: "outbound",
        phone: "+15125550000",
        thread_ref: "sms:+15125550000",
        message_text: "Yes, here are options.",
        event_at: outboundAt,
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  assert.equal(model.metrics.avgResponseSeconds, 45);
  assert.equal(model.metrics.avgResponseLabel, "45s");
  assert.equal(model.metrics.avgResponseSamples, 1);
});
