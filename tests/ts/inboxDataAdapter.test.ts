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
  assert.match(html, /zillowstatic\.com/);
  assert.doesNotMatch(html, /\/api\/media\/proxy/);
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
  assert.match(message.media?.[0].url || "", /zillowstatic\.com/);
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

  assert.equal(thread.id, "martn.o");
  assert.equal(thread.contact, "martn.o");
  assert.equal(thread.replyTo, "1526516032549624");
  assert.equal(thread.messageCount, 2);
});

test("adaptInboxData hides opaque Instagram ids when no profile name is available", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        phone: "1526516032549624",
        thread_ref: "instagram:1526516032549624",
        gmail_message_id: "instagram:message-opaque",
        message_text: "Can you send more listings?",
        event_at: "2026-06-22T09:18:36.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(thread.id, "1526516032549624");
  assert.equal(thread.contact, "Instagram contact");
  assert.equal(thread.replyTo, "1526516032549624");
  assert.equal(model.channelStats.instagram.lastActivity?.contact, "Instagram contact");
  assert.equal(model.activityEvents[0]?.actor, "Instagram contact");
});

test("adaptInboxData can read social profile identity from provider metadata", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        phone: "1526516032549624",
        thread_ref: "instagram:1526516032549624",
        provider_metadata: JSON.stringify({ senderUsername: "martn.ai" }),
        gmail_message_id: "instagram:message-profile",
        message_text: "Can you send more listings?",
        event_at: "2026-06-22T09:18:36.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(thread.contact, "@martn.ai");
  assert.equal(thread.replyTo, "1526516032549624");
});

test("adaptInboxData does not use browser-imported Instagram ids as Meta reply targets", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        source: "instagram_direct_v2_browser_backfill",
        full_name: "@oje.o",
        phone: "118140786245822",
        thread_ref: "instagram:118140786245822",
        provider_metadata: JSON.stringify({
          senderId: "118140786245822",
          contactId: "118140786245822",
          threadKey: "118140786245822",
          instagramUserId: "2112135625",
          senderUsername: "oje.o",
        }),
        gmail_message_id: "instagram:oje-message-1",
        message_text: "I'm interested in a property",
        event_at: "2026-06-26T21:55:38.014Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(thread.id, "oje.o");
  assert.equal(thread.contact, "@oje.o");
  assert.equal(thread.replyTo, "");
});

test("adaptInboxData marks browser-synced inbound Instagram leads as needs human", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        source: "instagram_direct_v2_browser_backfill",
        full_name: "@oje.o",
        phone: "118140786245822",
        thread_ref: "instagram:118140786245822",
        provider_metadata: JSON.stringify({
          senderUsername: "oje.o",
          source: "instagram_direct_v2_browser_backfill",
        }),
        gmail_message_id: "instagram:oje-message-1",
        message_text: "I’m interested in a property",
        status: "browser_backfill_verified_recipient",
        event_at: "2026-06-26T21:55:38.014Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(thread.contact, "@oje.o");
  assert.equal(thread.replyTo, "");
  assert.equal(thread.category, "needs-human");
});

test("adaptInboxData does not use authenticated browser Instagram ids as Meta reply targets", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        source: "instagram_direct_v2_browser_backfill",
        full_name: "@oje.o",
        phone: "118140786245822",
        thread_ref: "instagram:118140786245822",
        provider_metadata: JSON.stringify({
          source: "instagram_direct_v2_authenticated_browser",
          senderId: "2112135625",
          contactId: "2112135625",
          instagramUserId: "2112135625",
          browserRecipientId: "118140786245822",
          senderUsername: "oje.o",
        }),
        gmail_message_id: "instagram:oje-message-verified",
        provider_thread_id: "340282366841710301244259965533046095313",
        message_text: "I’m interested in a property",
        status: "browser_backfill_verified_recipient",
        event_at: "2026-06-26T21:55:38.014Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(thread.contact, "@oje.o");
  assert.equal(thread.replyTo, "browser_thread:340282366841710301244259965533046095313");
  assert.equal(thread.category, "needs-human");
});

test("adaptInboxData unlocks browser-merged Instagram thread after Meta webhook event", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        source: "instagram_direct_v2_browser_backfill",
        full_name: "@oje.o",
        phone: "118140786245822",
        thread_ref: "instagram:118140786245822",
        provider_metadata: JSON.stringify({
          source: "instagram_direct_v2_authenticated_browser",
          senderId: "2112135625",
          contactId: "2112135625",
          browserRecipientId: "118140786245822",
          senderUsername: "oje.o",
        }),
        gmail_message_id: "instagram:oje-message-browser",
        message_text: "I’m interested in a property",
        status: "browser_backfill_verified_recipient",
        event_at: "2026-06-26T21:55:38.014Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "inbound",
        source: "meta_social",
        full_name: "@oje.o",
        phone: "178998877665544",
        thread_ref: "instagram:118140786245822",
        provider_metadata: JSON.stringify({
          senderId: "178998877665544",
          senderUsername: "oje.o",
          webhookThreadRef: "instagram:178998877665544",
        }),
        gmail_message_id: "instagram:oje-message-webhook",
        message_text: "Hi again",
        event_at: "2026-06-27T18:01:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(thread.id, "oje.o");
  assert.equal(thread.contact, "@oje.o");
  assert.equal(thread.replyTo, "178998877665544");
  assert.equal(thread.messageCount, 2);
});

test("adaptInboxData ignores stale outbound social phone values when resolving reply target", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        source: "meta_social",
        full_name: "@martn.o",
        phone: "116105473108942",
        thread_ref: "instagram:116105473108942",
        provider_metadata: JSON.stringify({
          senderId: "1526516032549624",
          senderUsername: "martn.o",
          webhookThreadRef: "instagram:1526516032549624",
        }),
        gmail_message_id: "instagram:martn-webhook-inbound",
        message_text: "I need photos for the first one",
        event_at: "2026-06-27T07:57:54.286Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "outbound",
        source: "meta_social",
        agent_name: "Iris",
        full_name: "@martn.o",
        phone: "116105473108942",
        thread_ref: "instagram:116105473108942",
        gmail_message_id: "instagram:legacy-outbound",
        message_text: "I found the listing.",
        event_at: "2026-06-27T07:58:01.259Z",
      } as SheetRow,
    ],
    [],
  );

  const thread = adaptInboxData(data).textThreads.instagram[0];

  assert.equal(thread.id, "martn.o");
  assert.equal(thread.contact, "@martn.o");
  assert.equal(thread.replyTo, "1526516032549624");
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
        thread_ref: "instagram:thread-abc",
        message_text: "I can help",
        event_at: "2026-06-22T12:06:17.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(model.textThreads.instagram.length, 1);
  assert.equal(thread.id, "martn.o");
  assert.equal(thread.contact, "martn.o");
  assert.equal(model.channelStats.instagram.lastActivity?.contact, "martn.o");
  assert.equal(thread.messageCount, 2);
  assert.equal(thread.messages[1]?.direction, "owner");
});

test("adaptInboxData merges Meta webhook rows into canonical Instagram browser thread", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        source: "instagram_direct_v2_browser_backfill",
        full_name: "@martn.o",
        phone: "116105473108942",
        thread_ref: "instagram:116105473108942",
        provider_metadata: JSON.stringify({ senderUsername: "martn.o", source: "instagram_direct_v2_browser_backfill" }),
        gmail_message_id: "instagram:old-browser-message",
        message_text: "Hey, I'm interested in looking at a property.",
        event_at: "2026-06-26T21:57:00.000Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "inbound",
        source: "meta_social",
        full_name: "@martn.o",
        phone: "1526516032549624",
        thread_ref: "instagram:116105473108942",
        provider_metadata: JSON.stringify({
          senderId: "1526516032549624",
          senderUsername: "martn.o",
          webhookThreadRef: "instagram:1526516032549624",
        }),
        gmail_message_id: "instagram:new-webhook-message",
        message_text: "Hi there",
        event_at: "2026-06-27T06:39:04.189Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(model.textThreads.instagram.length, 1);
  assert.equal(thread.id, "martn.o");
  assert.equal(thread.contact, "@martn.o");
  assert.equal(thread.replyTo, "1526516032549624");
  assert.equal(thread.messageCount, 2);
  assert.equal(thread.preview, "Hi there");
});

test("adaptInboxData resolves social reply target from earlier thread events", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "oje.o",
        phone: "igsid-oje",
        thread_ref: "instagram:igsid-oje",
        provider_metadata: JSON.stringify({ senderId: "igsid-oje", senderUsername: "oje.o" }),
        gmail_message_id: "instagram:message-1",
        message_text: "I'm interested in a property",
        event_at: "2026-06-26T21:53:00.000Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "outbound",
        agent_name: "Iris",
        source: "meta_social",
        thread_ref: "instagram:igsid-oje",
        gmail_message_id: "instagram:reply-ready-1",
        message_text: "I can help with Austin options.",
        event_at: "2026-06-26T21:54:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const thread = model.textThreads.instagram[0];

  assert.equal(thread.id, "oje.o");
  assert.equal(thread.contact, "@oje.o");
  assert.equal(thread.replyTo, "igsid-oje");
  assert.equal(thread.messageCount, 2);
});

test("adaptInboxData keeps social threads unread until manually marked seen", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "Oje Ofunrein",
        thread_ref: "instagram-browser:118140786245822:oje.o",
        message_text: "Smoking in the house",
        event_at: "2026-06-26T21:53:00.000Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "Oje Ofunrein",
        thread_ref: "instagram-browser:118140786245822:oje.o",
        message_text: "I'm interested in a property",
        event_at: "2026-06-26T21:54:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const unreadThread = adaptInboxData(data).textThreads.instagram[0];
  assert.equal(unreadThread.id, "oje ofunrein");
  assert.equal(unreadThread.unreadCount, 2);
  assert.equal(unreadThread.seen, false);
  assert.equal(unreadThread.replyTo, "");

  const markedData = composeInboxData(data.leads, data.events, data.properties, data.voiceCalls, {
    threadReadStates: {
      "instagram:oje ofunrein": {
        channel: "instagram",
        threadRef: "oje ofunrein",
        seenAt: "2026-06-26T22:00:00.000Z",
        seenEventAt: "",
        seenBy: "owner",
        updatedAt: "2026-06-26T22:00:00.000Z",
      },
    },
  });
  const seenThread = adaptInboxData(markedData).textThreads.instagram[0];
  assert.equal(seenThread.unreadCount, 0);
  assert.equal(seenThread.seen, true);
});

test("adaptInboxData folds social reactions onto the target message", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "@martn.o",
        phone: "igsid-martn",
        thread_ref: "instagram:igsid-martn",
        gmail_message_id: "instagram:mid.inbound.1",
        provider_message_id: "mid.inbound.1",
        message_text: "Hi there",
        event_at: "2026-06-27T06:39:00.000Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "outbound",
        full_name: "@martn.o",
        phone: "igsid-martn",
        thread_ref: "instagram:igsid-martn",
        event_type: "instagram_reaction",
        gmail_message_id: "instagram:reaction:mid.inbound.1:owner:1",
        provider_metadata: JSON.stringify({
          reactionTargetMessageId: "mid.inbound.1",
          reactionEmoji: "love",
          reactionAction: "react",
        }),
        message_text: "Reaction: love",
        event_at: "2026-06-27T06:40:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const thread = adaptInboxData(data).textThreads.instagram[0];
  assert.equal(thread.messageCount, 1);
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].providerMessageId, "mid.inbound.1");
  assert.equal(thread.messages[0].reactions?.[0]?.emoji, "love");
  assert.equal(thread.messages[0].reactions?.[0]?.by, "owner");
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

test("adaptInboxData labels Instagram shared posts from media metadata", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "oje.o",
        phone: "igsid-oje",
        thread_ref: "instagram:igsid-oje",
        gmail_message_id: "instagram:shared-post-1",
        message_text: "Attachment",
        media_json: JSON.stringify([
          {
            type: "file",
            url: "https://www.instagram.com/reel/example/",
            filename: "Shared Instagram post",
            providerMetadata: { title: "Shared Instagram post" },
          },
        ]),
        event_at: "2026-06-26T21:53:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const message = model.textThreads.instagram[0].messages[0];

  assert.equal(message.media?.length, 1);
 assert.equal(message.media?.[0].kind, "image");
 assert.equal(message.media?.[0].linkUrl, "https://www.instagram.com/reel/example/");
  assert.equal(message.media?.[0].alt, "Shared Instagram post");
});



test("adaptInboxData turns Meta URL-only Instagram shares into preview cards", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "outbound",
        source: "meta_social_echo",
        full_name: "@martn.o",
        phone: "1526516032549624",
        thread_ref: "instagram:116105473108942",
        gmail_message_id: "instagram:url-only-share",
        message_text: "Attachment context: design skills",
        media_json: JSON.stringify([
          {
            type: "unknown",
            url: "https://www.instagram.com/reel/DaPc06fSOA7/",
            filename: "Comment DESIGN and I’ll send you all 42 skills",
            providerMetadata: {
              title: "Comment DESIGN and I’ll send you all 42 skills",
              attachment_type: "ig_reel",
              mediaContext: { summary: "Claude design skills reel" },
            },
          },
        ]),
        event_at: "2026-07-01T08:17:25.902Z",
      } as SheetRow,
    ],
    [],
  );
  const message = adaptInboxData(data).textThreads.instagram[0].messages[0];
  assert.equal(message.media?.[0].kind, "image");
  assert.equal(message.media?.[0].linkUrl, "https://www.instagram.com/reel/DaPc06fSOA7/");
  assert.match(message.media?.[0].label || "", /Claude design skills|Comment DESIGN/i);
});

test("adaptInboxData renders Instagram shared reel thumbnails as preview cards", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "buyer.austin",
        phone: "igsid-buyer",
        thread_ref: "instagram:igsid-buyer",
        gmail_message_id: "instagram:shared-reel-thumb-1",
        message_text: "I want something similar to this North Austin listing video",
        media_json: JSON.stringify([
          {
            type: "image",
            url: "https://cdn.example.com/reel-thumb.jpg",
            filename: "Shared Instagram post",
            providerMetadata: {
              title: "Shared Instagram post",
              linkUrl: "https://www.instagram.com/reel/north-austin-listing/",
              mediaContext: {
                summary: "Lead shared a listing video and wants similar homes.",
                confidence: 0.72,
              },
            },
          },
        ]),
        event_at: "2026-06-26T21:53:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const message = model.textThreads.instagram[0].messages[0];

  assert.equal(message.media?.length, 1);
  assert.equal(message.media?.[0].kind, "image");
  assert.equal(message.media?.[0].url, "https://cdn.example.com/reel-thumb.jpg");
  assert.equal(message.media?.[0].linkUrl, "https://www.instagram.com/reel/north-austin-listing/");
  assert.match(message.media?.[0].label || "", /similar homes/i);
});

test("adaptInboxData renders native social videos as videos instead of audio bubbles", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "instagram",
        direction: "inbound",
        full_name: "buyer.austin",
        phone: "igsid-buyer",
        thread_ref: "instagram:igsid-buyer",
        gmail_message_id: "instagram:video-1",
        message_text: "Can you find homes like this?",
        media_json: JSON.stringify([
          {
            type: "video",
            url: "https://cdn.example.com/listing-tour.mp4",
            filename: "Listing tour video",
            providerMetadata: {
              thumbnailUrl: "https://cdn.example.com/listing-tour-thumb.jpg",
              mediaContext: {
                summary: "Lead shared a property walkthrough video and wants similar options.",
                confidence: 0.75,
              },
            },
          },
        ]),
        event_at: "2026-06-26T21:54:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  const message = model.textThreads.instagram[0].messages[0];

  assert.equal(message.media?.[0].kind, "video");
  assert.equal(message.media?.[0].thumbnailUrl, "https://cdn.example.com/listing-tour-thumb.jpg");
  assert.match(message.media?.[0].transcript || "", /property walkthrough/i);
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

test("adaptInboxData exposes pipeline, channel quality, and media-understanding metrics", () => {
  const data = composeInboxData(
    [
      { full_name: "Buyer One", intent: "qualified buyer", next_action: "book showing" } as SheetRow,
    ],
    [
      {
        channel: "sms",
        direction: "inbound",
        phone: "+15125550100",
        thread_ref: "sms:+15125550100",
        message_text: "I want a 3 bed house under 500k in Austin.",
        event_at: "2026-07-01T15:00:00.000Z",
      } as SheetRow,
      {
        channel: "sms",
        direction: "outbound",
        phone: "+15125550100",
        thread_ref: "sms:+15125550100",
        message_text: "I found a few. Want to book a showing today?",
        ai_action: "appointment_scheduled",
        event_at: "2026-07-01T15:01:00.000Z",
      } as SheetRow,
      {
        channel: "instagram",
        direction: "inbound",
        thread_ref: "instagram:lead1",
        message_text: "Voice note transcript: looking for something like this reel",
        media_json: JSON.stringify([{ type: "video", url: "https://cdn.example.com/reel.mp4", transcript: "looking for something like this reel" }]),
        event_at: "2026-07-01T15:02:00.000Z",
      } as SheetRow,
    ],
    [],
  );

  const model = adaptInboxData(data);
  assert.ok(model.pipelineStages.some((stage) => stage.key === "qualified" && stage.value >= 1));
  assert.equal(model.metrics.appointments, 1);
  assert.equal(model.metrics.mediaItems, 1);
  assert.equal(model.metrics.mediaTranscripts, 1);
  assert.ok(model.channelQuality.some((row) => row.channel === "sms" && row.quality >= 90));
});
