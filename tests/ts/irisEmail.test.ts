import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildHtmlEmailReply,
  buildIrisEmailLeadMemoryRow,
  classifyIrisEmailText,
  coalesceIrisEmailThreadFollowUps,
  decideIrisEmailExecution,
  generateIrisEmailReply,
  irisEmailPollQuery,
  irisGmailMessageDirection,
  isIrisEligibleEmail,
  parseEmailContact,
  processIrisEmailPoll,
  type IrisEmailClient,
  type IrisEmailMessage,
} from "@/lib/irisEmail";
import { irisEmailCronDryRun, irisEmailCronSendReplies } from "@/lib/irisEmailCron";
import {
  DEFAULT_INBOX_CATEGORIES,
  DEFAULT_INBOX_SETTINGS,
  MANAGED_SYSTEM_CATEGORIES,
  OPTIONAL_CATEGORY_PRESETS,
  normalizeInboxSettings,
} from "@/lib/inboxSettings";
import type { SheetRow } from "@/lib/sheetSchema";

function email(partial: Partial<IrisEmailMessage> = {}): IrisEmailMessage {
  return {
    id: "msg_1",
    threadId: "thread_1",
    from: "Sam Buyer <sam@example.com>",
    subject: "Question",
    body: "Can I see 4309 Fairway Path tomorrow? Email is best.",
    ...partial,
  };
}

type FakeEmailCalls = {
  labels: string[][];
  sent: string[];
  managedLabels?: string[][];
  drafts?: Array<{ body: string; existingDraftId: string }>;
  deletedDrafts?: string[];
};

function fakeClient(messages: IrisEmailMessage[], calls: FakeEmailCalls): IrisEmailClient {
  return {
    listUnreadMessages: async () => messages,
    applyLabels: async (_message, labels, managedLabels = []) => {
      calls.labels.push(labels);
      calls.managedLabels?.push(managedLabels);
    },
    sendReply: async (_message, body) => {
      calls.sent.push(body);
      return {
        threaded: true,
        messageId: "sent_1",
        threadId: _message.threadId,
        mailboxEmail: _message.mailboxEmail || "iris@example.com",
      };
    },
    saveDraft: async (_message, body, _htmlBody, existingDraftId = "") => {
      calls.drafts?.push({ body, existingDraftId });
      return {
        threaded: true,
        draftId: existingDraftId || "draft_1",
        messageId: "draft_message_1",
        threadId: _message.threadId,
        mailboxEmail: _message.mailboxEmail || "iris@example.com",
      };
    },
    deleteDraft: async (draftId) => {
      calls.deletedDrafts?.push(draftId);
    },
  };
}

test("parseEmailContact: extracts name and lowercase email", () => {
  assert.deepEqual(parseEmailContact('"Sam Buyer" <SAM@EXAMPLE.COM>'), {
    name: "Sam Buyer",
    email: "sam@example.com",
  });
});

test("irisGmailMessageDirection: recognizes sent mailbox messages separately from inbound mail", () => {
  assert.equal(irisGmailMessageDirection(["SENT"], "Iris <iris@example.com>", "iris@example.com"), "outbound");
  assert.equal(irisGmailMessageDirection(["INBOX"], "Sam <sam@example.com>", "iris@example.com"), "inbound");
  assert.equal(irisGmailMessageDirection(["INBOX"], "Iris <iris@example.com>", "iris@example.com"), null);
});

test("classifyIrisEmailText: detects showing request and lead fields", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Tour request",
    body: "Can I tour 4309 Fairway Path tomorrow? Looking for 3 beds under $650k near Austin.",
  }));

  assert.equal(classification.intent, "showing_request");
  assert.equal(classification.primary_lead_role, "buyer");
  assert.equal(classification.address, "4309 Fairway Path");
  assert.equal(classification.lead_fields.beds, "3");
  assert.equal(classification.lead_fields.budget, "$650k");
  assert.equal(classification.recommended_next_action, "send_booking_link");
});

test("classifyIrisEmailText: treats explicit looking-to-buy requests as buyer leads", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Austin home search",
    body: "Hi Iris, I am looking to buy a 3 bedroom home in Austin under $600,000. Please send me options.",
  }));

  assert.equal(classification.intent, "property_search");
  assert.equal(classification.primary_lead_role, "buyer");
  assert.equal(classification.lead_fields.area, "Austin");
  assert.equal(classification.lead_fields.beds, "3");
  assert.equal(classification.lead_fields.budget, "$600,000");
  assert.equal(classification.recommended_next_action, "reply_and_qualify");
});

test("classifyIrisEmailText: detects a second-time buyer and opens the valuation path", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Re: Property inquiry",
    body: "Yes, we are second-time buyers and currently own our home.",
  }));

  assert.equal(classification.primary_lead_role, "second_time_buyer");
  assert.deepEqual(classification.secondary_roles, ["seller"]);
  assert.equal(classification.lead_fields.current_property_status, "owns");
  assert.ok(classification.opportunity_tags.includes("valuation_interest"));
  assert.match(classification.next_best_question || "", /free valuation/i);
});

test("classifyIrisEmailText: keeps realistic sell-before-buy context and CTA", () => {
  const prior = process.env.FILLOUT_VALUATION_URL;
  process.env.FILLOUT_VALUATION_URL = "https://example.com/free-valuation";
  try {
    const message = email({
      subject: "Tarrytown sale and Northwest Austin purchase",
      body: [
        "Hi Iris,",
        "My family owns a four-bedroom home in Tarrytown, and we are planning to sell before buying our next place in Northwest Austin.",
        "For the new home, our budget is around $1.9M. We would like at least four bedrooms, a dedicated office, and ideally a pool.",
        "We hope to move before November.",
        "Can you help us understand what our current home may be worth and what the right first step would be?",
        "One quick detail I forgot: we would prefer to sell the Tarrytown home before buying, but we can move quickly for the right Northwest Austin property.",
      ].join("\n"),
    });
    const classification = classifyIrisEmailText(message);
    const reply = generateIrisEmailReply(message, classification) || "";
    const rendered = buildHtmlEmailReply(reply, [], classification);
    const html = rendered.html || "";

    assert.equal(classification.primary_lead_role, "second_time_buyer");
    assert.equal(classification.lead_fields.current_property_status, "owns");
    assert.equal(classification.lead_fields.area, "Northwest Austin");
    assert.equal(classification.lead_fields.timeline, "before November");
    assert.ok(classification.opportunity_tags.includes("sell_before_buy"));
    assert.match(reply, /free valuation/i);
    assert.match(html, /href="https:\/\/example\.com\/free-valuation"/);
    assert.match(html, />Get Free Home Valuation<\/a>/);
  } finally {
    if (prior === undefined) delete process.env.FILLOUT_VALUATION_URL;
    else process.env.FILLOUT_VALUATION_URL = prior;
  }
});

test("classifyIrisEmailText: valuation acceptance sends booking path", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Re: Your next purchase",
    body: [
      "Yes, please book the property valuation.",
      "",
      "Thread context for classification only:",
      "Prior summary: Lead role: second_time_buyer. Current property status: owns.",
    ].join("\n"),
  }));

  assert.equal(classification.primary_lead_role, "second_time_buyer");
  assert.ok(classification.opportunity_tags.includes("valuation_consented"));
  assert.equal(classification.recommended_next_action, "send_booking_link");
});

test("generateIrisEmailReply: second-time buyer gets valuation booking link", () => {
  const prior = process.env.FILLOUT_VALUATION_URL;
  process.env.FILLOUT_VALUATION_URL = "https://example.com/free-valuation";
  try {
    const message = email({ body: "Yes, I am a second-time buyer and would like to book a valuation." });
    const reply = generateIrisEmailReply(message, classifyIrisEmailText(message)) || "";
    assert.match(reply, /next purchase/i);
    assert.match(reply, /free valuation/i);
    assert.match(reply, /https:\/\/example\.com\/free-valuation/);
    assert.doesNotMatch(reply, /price range should I use/i);
  } finally {
    if (prior === undefined) delete process.env.FILLOUT_VALUATION_URL;
    else process.env.FILLOUT_VALUATION_URL = prior;
  }
});

test("generateIrisEmailReply: a second-time buyer can advance to a showing", () => {
  const message = email({
    subject: "Re: About your property inquiry",
    body: "I am a second-time buyer and would like to tour 808 Bent Wood Pl Saturday at 11 AM.",
  });
  const classification = classifyIrisEmailText(message);
  const reply = generateIrisEmailReply(message, classification) || "";

  assert.equal(classification.primary_lead_role, "second_time_buyer");
  assert.equal(classification.intent, "showing_request");
  assert.match(reply, /requested time|showing/i);
  assert.doesNotMatch(reply, /free valuation/i);
});

test("coalesceIrisEmailThreadFollowUps: keeps one latest message and combines quick follow-up context", () => {
  const first = email({ id: "first", threadId: "thread_a", body: "Looking in Round Rock.", receivedAt: "Wed, 15 Jul 2026 10:00:00 -0500" });
  const followUp = email({ id: "follow_up", threadId: "thread_a", body: "Also need a backyard.", receivedAt: "Wed, 15 Jul 2026 10:01:00 -0500" });
  const result = coalesceIrisEmailThreadFollowUps([followUp, first]);

  assert.deepEqual(result.superseded.map((message) => message.id), ["first"]);
  assert.deepEqual(result.messages.map((message) => message.id), ["follow_up"]);
  assert.match(result.messages[0].body, /Looking in Round Rock\.\n\nAlso need a backyard\./);
});

test("classifyIrisEmailText: carries forward area and beds from thread context (no re-ask)", () => {
  const MARKER = "Thread context for classification only:";
  const classification = classifyIrisEmailText(email({
    subject: "Re: Round Rock home search",
    body: [
      "For my budget I want properties in the range of $400,000 to $600,000.",
      "I am hoping to move in within the next 2 to 3 months.",
      "",
      MARKER,
      "Previous property interest: Round Rock single family",
      "Known area: Round Rock",
      "Known bedrooms: 4",
    ].join("\n"),
  }));

  assert.equal(classification.intent, "property_search");
  assert.equal(classification.lead_fields.area, "Round Rock");
  assert.equal(classification.lead_fields.beds, "4");
  assert.notEqual(classification.lead_fields.budget, null);
  // All criteria known from the thread -> Iris should search, not re-ask the area.
  assert.equal(classification.next_best_question, null);
});

test("classifyIrisEmailText: routes compliance-sensitive questions to human", () => {
  const classification = classifyIrisEmailText(email({
    body: "Is this a safe neighborhood for families with kids, and should I waive inspection?",
  }));
  const execution = decideIrisEmailExecution(classification);

  assert.equal(classification.intent, "human_required");
  assert.deepEqual(classification.compliance_flags.sort(), ["contract_terms", "fair_housing"]);
  assert.deepEqual(execution.labels, ["NEEDS_HUMAN"]);
  assert.equal(execution.canReply, false);
});

test("buildIrisEmailLeadMemoryRow: carries structured email qualification fields", () => {
  const classification = classifyIrisEmailText(email({
    body: "Looking for 4 bed homes near Round Rock under $800k next month.",
  }));
  const execution = decideIrisEmailExecution(classification);
  const row = buildIrisEmailLeadMemoryRow(email(), classification, execution);

  assert.equal(row.email, "sam@example.com");
  assert.equal(row.lead_source, "email");
  assert.equal(row.budget, "$800k");
  assert.equal(row.bedrooms, "4");
  assert.equal(row.last_channel, "email");
});

test("processIrisEmailPoll: dry run avoids labels, sends, and database writes", async () => {
  const calls = { labels: [] as string[][], sent: [] as string[] };
  let recorded = 0;
  const result = await processIrisEmailPoll(
    { dryRun: true },
    {
      emailClient: fakeClient([email()], calls),
      recordInteraction: async () => {
        recorded += 1;
      },
    },
  );

  assert.equal(result.processed, 1);
  assert.equal(result.dryRun, true);
  assert.equal(result.recorded, 0);
  assert.equal(recorded, 0);
  assert.deepEqual(calls.labels, []);
  assert.deepEqual(calls.sent, []);
  assert.match(result.results[0].replyDraft || "", /4309 Fairway Path/);
  assert.match(result.results[0].replyDraft || "", /time windows|What day and time|time of day|what time works best/i);
});

test("processIrisEmailPoll: opt-out closes without sending or drafting", async () => {
  const calls = { labels: [] as string[][], sent: [] as string[] };
  const recorded: string[] = [];
  const result = await processIrisEmailPoll(
    { dryRun: false, sendReplies: true },
    {
      emailClient: fakeClient([email({ body: "Please remove me from emails." })], calls),
      recordInteraction: async (_message, classification, execution) => {
        recorded.push(`${classification.intent}:${execution.status}`);
      },
    },
  );

  assert.equal(result.processed, 1);
  assert.equal(result.recorded, 1);
  assert.equal(result.labeled, 1);
  assert.equal(result.sent, 0);
  assert.deepEqual(calls.labels, [[]]);
  assert.deepEqual(recorded, ["human_required:spam"]);
});

test("processIrisEmailPoll: human-only turn creates a proactive review draft", async () => {
  const calls: FakeEmailCalls = {
    labels: [],
    sent: [],
    managedLabels: [],
    drafts: [],
  };
  const stored: Array<Record<string, unknown>> = [];
  const result = await processIrisEmailPoll(
    { dryRun: false, sendReplies: true },
    {
      emailClient: fakeClient([email({
        mailboxEmail: "iris@tenant-a.example",
        body: "Is this a safe neighborhood for families, and should I waive inspection?",
      })], calls),
      categories: DEFAULT_INBOX_CATEGORIES,
      recordInteraction: async () => {},
      readActiveDraft: async () => null,
      storeReviewDraft: async (draft) => {
        stored.push(draft);
      },
    },
  );

  assert.equal(result.sent, 0);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.drafts?.length, 1);
  assert.match(calls.drafts?.[0].body || "", /team|review|follow up/i);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].needs_human, true);
  // Internal machine tokens stay internal. The mailbox sees exactly one clean managed label, and
  // the managed set is the two system labels only, so nothing of the user's can be removed.
  assert.deepEqual(calls.labels[0], ["Needs Human"]);
  assert.ok(!calls.labels[0].includes("NEEDS_HUMAN"));
  assert.deepEqual(calls.managedLabels?.[0].slice().sort(), ["Auto Replied", "Needs Human"]);
  assert.ok(!calls.managedLabels?.[0].includes("Waiting on Reply"));
});

test("processIrisEmailPoll: a later safe turn auto-sends and clears the old review draft", async () => {
  const calls: FakeEmailCalls = {
    labels: [],
    sent: [],
    managedLabels: [],
    deletedDrafts: [],
  };
  const archived: string[] = [];
  const result = await processIrisEmailPoll(
    { dryRun: false, sendReplies: true },
    {
      emailClient: fakeClient([email({
        mailboxEmail: "iris@tenant-a.example",
        body: "Can I tour 4309 Fairway Path tomorrow at 2 PM?",
      })], calls),
      categories: DEFAULT_INBOX_CATEGORIES,
      recordInteraction: async () => {},
      readActiveDraft: async () => ({ gmail_draft_id: "draft_old" }),
      archiveActiveDraft: async (threadRef) => {
        archived.push(threadRef);
      },
    },
  );

  assert.equal(result.sent, 1);
  assert.equal(calls.sent.length, 1);
  assert.deepEqual(calls.deletedDrafts, ["draft_old"]);
  assert.deepEqual(archived, ["thread_1"]);
  // A confirmed send earns exactly one label. The internal `waiting_lead` state is a database
  // fact and is no longer written into the user's label list.
  assert.deepEqual(calls.labels[0], ["Auto Replied"]);
  assert.ok(!calls.labels[0].includes("AUTO_REPLIED"));
  assert.ok(!calls.labels[0].includes("Waiting on Reply"));
  assert.ok(!calls.labels[0].includes("Needs Human"));
});

test("processIrisEmailPoll: a human-sent Gmail review draft resolves without another Iris reply", async () => {
  const calls: FakeEmailCalls = { labels: [], sent: [] };
  const resolved: string[] = [];
  const result = await processIrisEmailPoll(
    { dryRun: false, sendReplies: true },
    {
      emailClient: fakeClient([email({
        direction: "outbound",
        from: "Iris <iris@tenant-a.example>",
        to: "Sam Buyer <sam@example.com>",
        mailboxEmail: "iris@tenant-a.example",
        body: "I checked with the team. Tuesday at 2 PM works.",
      })], calls),
      categories: DEFAULT_INBOX_CATEGORIES,
      readActiveDraft: async () => ({ gmail_draft_id: "draft_review" }),
      duplicateExists: async () => false,
      recordInteraction: async () => assert.fail("outbound review send must not be recorded as inbound"),
      resolveSentReview: async (message) => {
        resolved.push(message.id);
      },
    },
  );

  assert.equal(result.processed, 0);
  assert.deepEqual(resolved, ["msg_1"]);
  assert.equal(calls.sent.length, 0);
});

test("processIrisEmailPoll: repeated human-only turns update one Gmail draft", async () => {
  const calls: FakeEmailCalls = { labels: [], sent: [], drafts: [] };
  await processIrisEmailPoll(
    { dryRun: false, sendReplies: true },
    {
      emailClient: fakeClient([email({ body: "Should I waive inspection on this property?" })], calls),
      categories: DEFAULT_INBOX_CATEGORIES,
      recordInteraction: async () => {},
      readActiveDraft: async () => ({ gmail_draft_id: "draft_existing" }),
      storeReviewDraft: async () => {},
    },
  );

  assert.equal(calls.drafts?.length, 1);
  assert.equal(calls.drafts?.[0].existingDraftId, "draft_existing");
});

test("processIrisEmailPoll: spam closes without a review draft", async () => {
  const calls: FakeEmailCalls = { labels: [], sent: [], drafts: [] };
  await processIrisEmailPoll(
    { dryRun: false, sendReplies: true },
    {
      emailClient: fakeClient([email({
        subject: "Grow your SaaS pipeline",
        body: "We partner with technical founders on outbound sales. Want a demo?",
      })], calls),
      categories: DEFAULT_INBOX_CATEGORIES,
      recordInteraction: async () => {},
      storeReviewDraft: async () => {
        assert.fail("spam must not create a human-review draft");
      },
    },
  );

  assert.equal(calls.sent.length, 0);
  assert.equal(calls.drafts?.length, 0);
  // No send and no human stop, so no label at all. `Closed No Reply` is internal state now: Iris
  // does not file a stranger's cold pitch into the user's mailbox taxonomy.
  assert.deepEqual(calls.labels[0], []);
  assert.ok(!calls.labels[0].includes("Closed No Reply"));
  assert.ok(!calls.labels[0].includes("NEEDS_HUMAN"));
});

test("iris email cron: live env sends by default unless explicitly overridden", () => {
  const previousLive = process.env.IRIS_EMAIL_LIVE;
  const previousSend = process.env.IRIS_EMAIL_SEND_REPLIES;
  process.env.IRIS_EMAIL_LIVE = "true";
  process.env.IRIS_EMAIL_SEND_REPLIES = "true";
  try {
    assert.equal(irisEmailCronDryRun(new URLSearchParams()), false);
    assert.equal(irisEmailCronSendReplies(new URLSearchParams(), true), true);
    assert.equal(irisEmailCronDryRun(new URLSearchParams("dryRun=true")), true);
    assert.equal(irisEmailCronSendReplies(new URLSearchParams("sendReplies=false"), true), false);
    assert.equal(irisEmailCronSendReplies(new URLSearchParams(), false), false);
  } finally {
    if (previousLive === undefined) delete process.env.IRIS_EMAIL_LIVE;
    else process.env.IRIS_EMAIL_LIVE = previousLive;
    if (previousSend === undefined) delete process.env.IRIS_EMAIL_SEND_REPLIES;
    else process.env.IRIS_EMAIL_SEND_REPLIES = previousSend;
  }
});

test("irisEmailPollQuery: scopes default Gmail polling to configured inbound address", () => {
  const previousQuery = process.env.IRIS_EMAIL_POLL_QUERY;
  const previousInbound = process.env.IRIS_EMAIL_INBOUND_TO;
  const previousTeam = process.env.TEAM_LEAD_EMAIL;
  delete process.env.IRIS_EMAIL_POLL_QUERY;
  delete process.env.IRIS_EMAIL_INBOUND_TO;
  process.env.TEAM_LEAD_EMAIL = "martin@lumenosis.com";
  try {
    const query = irisEmailPollQuery();
    assert.match(query, /in:inbox/);
    assert.match(query, /is:unread/);
    assert.match(query, /newer_than:14d/);
    assert.doesNotMatch(query, /AUTO_REPLIED/);
    assert.doesNotMatch(query, /NEEDS_HUMAN/);
    assert.match(query, /to:martin@lumenosis\.com/);
    assert.match(query, /deliveredto:martin@lumenosis\.com/);
  } finally {
    if (previousQuery === undefined) delete process.env.IRIS_EMAIL_POLL_QUERY;
    else process.env.IRIS_EMAIL_POLL_QUERY = previousQuery;
    if (previousInbound === undefined) delete process.env.IRIS_EMAIL_INBOUND_TO;
    else process.env.IRIS_EMAIL_INBOUND_TO = previousInbound;
    if (previousTeam === undefined) delete process.env.TEAM_LEAD_EMAIL;
    else process.env.TEAM_LEAD_EMAIL = previousTeam;
  }
});

test("classifyIrisEmailText: treats listing links as property inquiries", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Property",
    body: "https://www.zillow.com/homedetails/12725-Bloomington-Dr-129-Austin-TX-78748/123_zpid/",
  }));
  const execution = decideIrisEmailExecution(classification);

  assert.equal(classification.intent, "property_details");
  assert.equal(classification.primary_lead_role, "buyer");
  assert.equal(execution.canReply, true);
});

test("processIrisEmailPoll: duplicate unread messages are labeled but not recorded or sent", async () => {
  const calls = { labels: [] as string[][], sent: [] as string[] };
  let recorded = 0;
  const result = await processIrisEmailPoll(
    { dryRun: false, sendReplies: true },
    {
      emailClient: fakeClient([email()], calls),
      duplicateExists: async () => true,
      recordInteraction: async () => {
        recorded += 1;
      },
    },
  );

  assert.equal(result.processed, 1);
  assert.equal(result.recorded, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.results[0].skippedDuplicate, true);
  // A duplicate is "already handled", which is NOT evidence a reply went out on this pass, so it
  // cannot mint `Auto Replied`. Nothing is removed either, so an earlier legitimate label survives.
  assert.deepEqual(calls.labels, [[]]);
  assert.deepEqual(calls.sent, []);
  assert.equal(recorded, 0);
});

test("a duplicate re-asserts an Auto Replied label it already carries instead of stripping it", async () => {
  const calls: FakeEmailCalls = { labels: [], sent: [], managedLabels: [] };
  await processIrisEmailPoll(
    { dryRun: false, sendReplies: true },
    {
      emailClient: fakeClient([email({ labelIds: ["INBOX", "Auto Replied"] })], calls),
      duplicateExists: async () => true,
      recordInteraction: async () => {},
    },
  );

  // Idempotency without lying: the label is preserved because the thread already had it, not
  // because this pass sent anything.
  assert.deepEqual(calls.labels[0], ["Auto Replied"]);
  assert.deepEqual(calls.sent, []);
});

test("isIrisEligibleEmail: blocks system and no-reply senders before auto-send", () => {
  assert.equal(isIrisEligibleEmail(email({
    from: "Google <no-reply@accounts.google.com>",
    subject: "Security alert",
    body: "New sign-in from a device.",
  })), false);
  assert.equal(isIrisEligibleEmail(email({
    from: "German Linares <german.linares+gohighlevel.com@mailbox.gohighlevel.com>",
    subject: "HighLevel End of Trial Discount",
    body: "Book a demo. 400 N. Saint Paul St. Unsubscribe.",
  })), false);
  assert.equal(isIrisEligibleEmail(email({
    from: "Sherzod from HandTextAI <sales@handtextai.com>",
    subject: "Re: HandtextAI API - Lumenosis AI inquiry",
    body: "Quick question about API automation for your SaaS workflow.",
  })), false);
  assert.equal(isIrisEligibleEmail(email({
    from: "Codex Email Test Buyer <codex.email.test+1@lumenosis.local>",
    subject: "Property",
    body: "Can I see 9605 Corbe Dr?",
  })), false);
  assert.equal(isIrisEligibleEmail(email({
    from: "Sam Buyer <sam@example.com>",
    subject: "Tour request",
    body: "Can I tour 100 E 51st St #7 tomorrow?",
  })), true);
});

test("buildHtmlEmailReply: proxies usable photos and avoids duplicate property copy", () => {
  const previousBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://app.example.com";
  try {
    const property = {
      address: "100 E 51st St #7",
      price: "843900",
      beds: "3",
      baths: "3",
      sqft: "1902",
      description: "3 beds, 3 baths, 1902 sqft Townhouse in Austin, TX 78751",
      photo_url: "https://photos.zillowstatic.com/fp/abc123-p_e.jpg",
      listing_url: "https://www.zillow.com/homedetails/100-E-51st-St-7-Austin-TX-78751/70353702_zpid/",
    } as SheetRow;
    const reply = buildHtmlEmailReply("Hello,\n\nI can help with details on 100 E 51st St.\n\nBest,\nIris", [property, { ...property }]);

    assert.match(reply.html || "", /photos\.zillowstatic\.com/);
    assert.equal((reply.html || "").match(/<h3[^>]*>100 E 51st St #7<\/h3>/g)?.length, 1);
    assert.equal((reply.html || "").match(/3 beds, 3 baths, 1902 sqft Townhouse/g)?.length || 0, 0);
    assert.equal((reply.html || "").match(/View listing/g)?.length, 1);
    assert.ok((reply.html || "").indexOf("I can help with details") < (reply.html || "").indexOf("<img"));
  } finally {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
  }
});

test("buildHtmlEmailReply: showing requests focus on the selected property instead of similar options", () => {
  const primary = {
    address: "9605 Corbe Dr",
    price: "1150000",
    beds: "5",
    baths: "5",
    sqft: "4226",
    photo_url: "https://photos.zillowstatic.com/fp/primary-p_e.jpg",
    listing_url: "https://www.zillow.com/homedetails/9605-Corbe-Dr-Austin-TX-78726/29373093_zpid/",
  } as SheetRow;
  const similar = {
    address: "12725 Bloomington Dr #129, Austin, Texas 78748",
    price: "268000",
    beds: "4",
    baths: "3",
    sqft: "1650",
    listing_url: "https://www.zillow.com/homedetails/12725-Bloomington-Dr-129-Austin-TX-78748/2053065412_zpid/",
  } as SheetRow;
  const classification = classifyIrisEmailText(email({
    subject: "Re: Property",
    body: "Want to take a look at 9605 Corbe Dr",
  }));

  const reply = buildHtmlEmailReply(
    "Hi Martin,\n\nGreat, happy to set up a showing at 9605 Corbe Dr for you! What day and time works best for you this week?\n\nBest,\nIris",
    [primary, similar],
    classification,
  );

  assert.doesNotMatch(reply.html || "", /Similar options/i);
  assert.doesNotMatch(reply.html || "", /12725 Bloomington/i);
  assert.match(reply.html || "", /What day and time works best/i);
  assert.equal((reply.html || "").match(/happy to set up a showing/gi)?.length, 1);
  assert.doesNotMatch(reply.html || "", /I can help with 9605 Corbe Dr/i);
  assert.equal((reply.text.match(/Property details:/g) || []).length, 1);
  assert.match(reply.text, /9605 Corbe Dr/);
  assert.doesNotMatch(reply.text, /12725 Bloomington/i);
});

test("buildHtmlEmailReply: showing flow includes a Gmail-compatible schedule button", () => {
  const previous = process.env.CALENDLY_URL;
  process.env.CALENDLY_URL = "https://calendly.com/martin-lumenosis/30min";
  try {
    const classification = classifyIrisEmailText(email({
      subject: "Re: About your property inquiry",
      body: "Can I tour 808 Bent Wood Pl on Saturday?",
    }));
    const reply = buildHtmlEmailReply(
      "Hello,\n\nI can help schedule a showing.\n\nBest,\nIris",
      [],
      classification,
    );

    assert.match(reply.html || "", /href="https:\/\/calendly\.com\/martin-lumenosis\/30min"/);
    assert.match(reply.html || "", />Schedule Showing<\/a>/);
    assert.match(reply.html || "", /role="presentation"/);
    assert.match(reply.html || "", /background-color:\s*#2563eb/i);
    assert.match(reply.text, /Schedule Showing: https:\/\/calendly\.com\/martin-lumenosis\/30min/);
  } finally {
    if (previous === undefined) delete process.env.CALENDLY_URL;
    else process.env.CALENDLY_URL = previous;
  }
});

test("buildHtmlEmailReply: seller flow includes a Gmail-compatible free valuation button", () => {
  const previous = process.env.FILLOUT_VALUATION_URL;
  process.env.FILLOUT_VALUATION_URL = "https://lumenosis.fillout.com/t/uVsRftdUNFus";
  try {
    const classification = classifyIrisEmailText(email({
      subject: "Selling my Austin home",
      body: "I own a home and want to sell it this fall.",
    }));
    const reply = buildHtmlEmailReply(
      "Hello,\n\nWhat timeline are you working with?\n\nBest,\nIris",
      [],
      classification,
    );

    assert.equal(classification.intent, "seller_lead");
    assert.match(reply.html || "", /href="https:\/\/lumenosis\.fillout\.com\/t\/uVsRftdUNFus"/);
    assert.match(reply.html || "", />Get Free Home Valuation<\/a>/);
    assert.match(reply.html || "", /role="presentation"/);
    assert.match(reply.html || "", /background-color:\s*#16803c/i);
    assert.match(reply.text, /Get Free Home Valuation: https:\/\/lumenosis\.fillout\.com\/t\/uVsRftdUNFus/);
  } finally {
    if (previous === undefined) delete process.env.FILLOUT_VALUATION_URL;
    else process.env.FILLOUT_VALUATION_URL = previous;
  }
});

test("buildHtmlEmailReply: selected showing reply does not re-ask which property", () => {
  const primary = {
    address: "9605 Corbe Dr",
    price: "1150000",
    beds: "5",
    baths: "5",
    sqft: "4226",
    photo_url: "https://photos.zillowstatic.com/fp/primary-p_e.jpg",
    listing_url: "https://www.zillow.com/homedetails/9605-Corbe-Dr-Austin-TX-78726/29373093_zpid/",
  } as SheetRow;
  const classification = classifyIrisEmailText(email({
    subject: "Re: Property",
    body: "How about tomorrow afternoon?",
  }));
  classification.intent = "showing_request";
  classification.address = "9605 Corbe Dr";
  classification.addresses = ["9605 Corbe Dr"];

  const reply = buildHtmlEmailReply(
    "Hi Martin,\n\nTomorrow afternoon works great! To get it confirmed, could you share what time works best for you - and which of the three properties you'd like to tour first?\n\nBest,\nIris",
    [primary],
    classification,
  );

  assert.doesNotMatch(reply.text, /which of the three properties/i);
  assert.doesNotMatch(reply.html || "", /which of the three properties/i);
  assert.match(reply.text, /What time works best for you\?/);
  assert.match(reply.html || "", /What time works best for you\?/);
});

test("classifyIrisEmailText: pivots away from prior selected property when lead asks for other options", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Re: Property",
    body: [
      "I'm no longer interested in this property, what else can we do? I am looking for a three bed in Austin now. What options are there?",
      "",
      "Thread context for classification only:",
      "Previous property interest: 9605 Corbe Dr, 12725 Bloomington Dr #129, Austin, Texas 78748, 100 E 51st St #7",
      "Recent omnichannel timeline:",
      "2026-06-29 email outbound sent: I can help with 9605 Corbe Dr.",
    ].join("\n"),
  }));

  assert.equal(classification.intent, "property_search");
  assert.deepEqual(classification.addresses, []);
  assert.equal(classification.address, null);
  assert.equal(classification.lead_fields.beds, "3");
  assert.equal(classification.lead_fields.area, "Austin");
  assert.ok(classification.opportunity_tags.includes("property_pivot"));
});

test("classifyIrisEmailText: uses prior selected property for scheduling follow-up only", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Re: Property",
    body: [
      "How about tomorrow afternoon?",
      "",
      "Thread context for classification only:",
      "Previous property interest: 9605 Corbe Dr",
      "Recent omnichannel timeline:",
      "2026-06-29 email outbound sent: I can help with 9605 Corbe Dr.",
    ].join("\n"),
  }));

  assert.equal(classification.intent, "showing_request");
  assert.equal(classification.address, "9605 Corbe Dr");
  assert.deepEqual(classification.addresses, ["9605 Corbe Dr"]);
});

test("classifyIrisEmailText: does not re-ask for showing time when day and time are supplied", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Re: Property",
    body: [
      "Tomorrow at 2:00 PM works. Please schedule the tour.",
      "",
      "Thread context for classification only:",
      "Previous property interest: 9605 Corbe Dr",
    ].join("\n"),
  }));

  assert.equal(classification.intent, "showing_request");
  assert.equal(classification.next_best_question, null);
  assert.match(generateIrisEmailReply(email(), classification) || "", /confirm availability/i);
  assert.doesNotMatch(generateIrisEmailReply(email(), classification) || "", /I can help/i);
});

test("classifyIrisEmailText: resolves first property in prior email cards", () => {
  const classification = classifyIrisEmailText(email({
    subject: "Re: Property inquiry",
    body: [
      "I'm really interested in the first property. Can you give me more information about that one?",
      "",
      "Thread context for classification only:",
      "2026-07-15 email outbound sent: 700 Whitetail Dr, Round Rock, TX 78681 | 701 Old Ravine Ct, Round Rock, TX 78665",
    ].join("\n"),
  }));

  assert.equal(classification.intent, "showing_request");
  assert.equal(classification.address, "700 Whitetail Dr");
  assert.deepEqual(classification.addresses, ["700 Whitetail Dr"]);
});

test("buildHtmlEmailReply: renders Street View photos in outbound email cards", () => {
  const reply = buildHtmlEmailReply("Hello,\n\nBest,\nIris", [{
    address: "100 E 51st St #7",
    photo_url: "https://maps.googleapis.com/maps/api/streetview?location=100+E+51st",
    listing_url: "https://www.zillow.com/homedetails/100-E-51st-St-7-Austin-TX-78751/70353702_zpid/",
  } as SheetRow]);

  assert.match(reply.html || "", /<img\b/i);
  assert.match(reply.html || "", /maps\.googleapis\.com/);
  assert.match(reply.html || "", /View listing/);
});

test("classifyIrisEmailText: blocks account activation emails from auto-reply", () => {
  const classification = classifyIrisEmailText(email({
    from: "Bulk Email Checker <support@bulkemailchecker.com>",
    subject: "Welcome to Bulk Email Checker!",
    body: "Welcome to Bulk Email Checker! Your account has been created. Confirm Email Address https://panel.bulkemailchecker.com/activate/320767197/",
  }));
  const execution = decideIrisEmailExecution(classification);

  assert.equal(isIrisEligibleEmail(email({
    from: "Bulk Email Checker <support@bulkemailchecker.com>",
    subject: "Welcome to Bulk Email Checker!",
    body: "Confirm Email Address https://panel.bulkemailchecker.com/activate/320767197/",
  })), false);
  assert.equal(classification.intent, "spam");
  assert.equal(execution.canReply, false);
});

test("classifyIrisEmailText: blocks non-real-estate founder outreach from auto-reply", () => {
  const classification = classifyIrisEmailText(email({
    from: "Amy Green <amy@example.com>",
    subject: "Martin - partners at Lumenosis AI?",
    body: "Martin, selling all day, no deals moving? We partner with technical founders on their actual deals. Want the method?",
  }));
  const execution = decideIrisEmailExecution(classification);

  assert.equal(isIrisEligibleEmail(email({
    from: "Amy Green <amy@example.com>",
    subject: "Martin - partners at Lumenosis AI?",
    body: "We partner with technical founders on their actual deals. Want the method?",
  })), false);
  assert.equal(classification.intent, "spam");
  assert.equal(execution.canReply, false);
});

// Production incident, evidenced by Martin's Gmail screenshots: Iris auto-replied to cold
// outbound sales mail from Mercury (fintech) and a business-development sender, then appended a
// property card and a valuation CTA, and Gmail showed AUTO_REPLIED + Iris/Seller Valuation +
// Iris/Waiting on Lead on unrelated fintech marketing.
//
// Two independent fail-opens caused it and both are asserted here:
//   1. classifyIrisEmailText's "autonomy floor" downgraded the safe human_required default to
//      property_search/buyer whenever no blocklist keyword matched. Mercury's copy ("IO card",
//      "cash back", "spend controls") matches no blocklist term AND no real-estate term, so it
//      became a buyer lead at confidence 0.72.
//   2. decideIrisEmailExecution replied to anything not spam/human_required/sensitive.
// Bodies below are anonymized structural reproductions, not the customers' mail.
const COLD_OUTBOUND_CASES: Array<{ id: string; subject: string; from: string; body: string }> = [
  {
    id: "fintech_card_outbound",
    subject: "finance tools",
    from: "Sender Name <bd@examplefintech.com>",
    body: "Martin, our IO card isn't built around fees or interest. You earn 1.5% cash back, get higher limits tied to your balance, built-in spend controls, and can build business credit.\n\nEven if you're not at the $15k deposit threshold yet, we can still get you set up on day one, with the same benefits.\n\nOpen to learning more about how this could work for you?\n\nBusiness Development",
  },
  {
    id: "bizdev_cold_call_request",
    subject: "Quick question about your business",
    from: "Sender Name <bd@examplevendor.com>",
    body: "Hi Martin,\n\nI came across your company and wanted to reach out. We help founders scale their outbound. Would you be open to a quick 15 minute call next week to see if there's a fit?\n\nBest,\nBusiness Development",
  },
];

test("cold outbound sales email is never auto-replied to and never gets a property pitch", () => {
  for (const item of COLD_OUTBOUND_CASES) {
    const classification = classifyIrisEmailText({ subject: item.subject, body: item.body, from: item.from });
    const execution = decideIrisEmailExecution(classification);

    // 1. No send, ever.
    assert.equal(execution.canReply, false, `${item.id}: would auto-reply to cold outbound`);
    // 2. Never labeled AUTO_REPLIED.
    assert.ok(!execution.labels.includes("AUTO_REPLIED"), `${item.id}: got AUTO_REPLIED`);
    // 3. Never classified as a real-estate lead, so no inventory retrieval is triggered and no
    //    Seller/Valuation topic tag can be derived from the intent.
    assert.ok(
      !["property_search", "property_details", "showing_request", "buyer_lead", "seller_lead", "renter_lead"].includes(classification.intent),
      `${item.id}: classified as real-estate intent ${classification.intent}`,
    );
    assert.notEqual(classification.primary_lead_role, "buyer", `${item.id}: assigned buyer role`);
    // 4. The autonomy floor must not have fired.
    assert.ok(
      !classification.opportunity_tags.includes("autonomy_floor_reply"),
      `${item.id}: autonomy floor downgraded unrelated mail into a repliable lead`,
    );
    // 5. No valuation opportunity invented from fintech marketing.
    assert.ok(
      !classification.opportunity_tags.includes("valuation_interest"),
      `${item.id}: invented valuation interest`,
    );
  }
});

test("the autonomy floor requires affirmative real-estate evidence", () => {
  // Same shape of message, with and without real-estate evidence. Only the second may reply.
  const withoutEvidence = classifyIrisEmailText({
    subject: "following up",
    body: "Just circling back on my note from last week. Worth a quick chat?",
    from: "Sender Name <bd@examplevendor.com>",
  });
  assert.ok(!withoutEvidence.opportunity_tags.includes("autonomy_floor_reply"));
  assert.equal(decideIrisEmailExecution(withoutEvidence).canReply, false);

  const withEvidence = classifyIrisEmailText({
    subject: "following up",
    body: "Just circling back on my note from last week. Is the condo at 70 Rainey St still available? Worth a quick chat?",
    from: "Lead Name <lead@example.com>",
  });
  assert.ok(withEvidence.intent !== "human_required", "real real-estate mail must stay answerable");
});

test("ambiguous mail from a possible lead drafts for a human instead of going silent", () => {
  // No resolvable real-estate context, but this is not affirmatively someone else's business.
  // Silence on a real lead is its own failure, so this is Tier B: a draft, not a no-op.
  const classification = classifyIrisEmailText({ subject: "question", body: "How much is it?", from: "Lead Name <lead@example.com>" });
  const execution = decideIrisEmailExecution(classification);
  assert.equal(execution.canReply, false, "must not auto-send on unresolved ambiguity");
  assert.equal(execution.aiAction, "draft_reply", "must still produce a draft, not silence");
  assert.ok(!classification.opportunity_tags.includes("out_of_scope_no_reply"));
});

test("email auto-send is off by default and draft_first stays a global switch", () => {
  // Email must be opt-in. draft_first must NOT be flipped to achieve that, because it is a
  // global kill switch and would silently disable SMS, WhatsApp and social auto-send too.
  assert.equal(DEFAULT_INBOX_SETTINGS.auto_send.email, false);
  assert.equal(DEFAULT_INBOX_SETTINGS.draft_first, false);
  for (const channel of ["sms", "whatsapp", "messenger", "instagram", "website_chat"] as const) {
    assert.equal(DEFAULT_INBOX_SETTINGS.auto_send[channel], true, `${channel} auto-send was disabled as a side effect`);
  }
});

// Second half of the incident: canReply:false stops the send, but the DRAFT was still a
// real-estate pitch. The fintech cold email got "putting a shortlist together against your price
// range and bedroom count" — selling houses to someone who never asked, the same class of defect
// as attaching a property card. Assert no pitch, no card, no CTA on unrelated mail.
test("unrelated mail gets no property card, listing, price or real-estate pitch in the draft", () => {
  const properties: SheetRow[] = [{
    address: "70 Rainey St #1509", price: "750000", beds: "2", baths: "2", sqft: "1128",
    neighborhood: "Downtown Austin", listing_url: "https://www.zillow.com/homedetails/x/1_zpid/",
  } as SheetRow];

  for (const item of COLD_OUTBOUND_CASES) {
    const message = { id: "m1", threadId: "t1", from: item.from, subject: item.subject, body: item.body };
    const classification = classifyIrisEmailText(message);
    const reply = generateIrisEmailReply(message, classification, properties) || "";

    assert.doesNotMatch(reply, /70 Rainey St/, `${item.id}: leaked a property address`);
    assert.doesNotMatch(reply, /zillow\.com/, `${item.id}: leaked a listing URL`);
    assert.doesNotMatch(reply, /750,?000/, `${item.id}: leaked a price`);
    assert.doesNotMatch(reply, /valuation|home value|what it should list/i, `${item.id}: leaked a valuation CTA`);
    // No real-estate pitch either: no invented buyer brief for someone who never asked.
    assert.doesNotMatch(reply, /shortlist|bedroom count|price range|listings? (?:in|near)/i, `${item.id}: pitched real estate`);
  }
});

// Final product direction: the ONLY labels Iris may create in a user's mailbox by default are
// "Auto Replied" and "Needs Human", clean title case, no Iris/ prefix. Everything else is opt-in.
test("only two labels are managed in the user's mailbox, with no Iris/ prefix anywhere", () => {
  assert.deepEqual(
    MANAGED_SYSTEM_CATEGORIES.map((c) => c.gmail_label_name).sort(),
    ["Auto Replied", "Needs Human"],
  );
  // Auto Replied is evidence of a completed send, never a trigger.
  const autoReplied = MANAGED_SYSTEM_CATEGORIES.find((c) => c.slug === "auto_replied")!;
  assert.equal(autoReplied.auto_rules.applies_after_send, true);
  assert.equal(autoReplied.auto_rules.auto_send, "off");

  // No category anywhere may carry an Iris/ prefix into the mailbox.
  for (const category of [...DEFAULT_INBOX_CATEGORIES, ...MANAGED_SYSTEM_CATEGORIES, ...OPTIONAL_CATEGORY_PRESETS]) {
    assert.doesNotMatch(category.gmail_label_name, /^Iris\//, `${category.slug} still writes an Iris/ label`);
  }
});

test("no label or rule can authorize an auto-send", () => {
  // Sending is decided solely by decideIrisEmailExecution's Tier A gate. If any category could
  // opt itself into sending, a user renaming a label would become a send permission.
  for (const category of [...DEFAULT_INBOX_CATEGORIES, ...MANAGED_SYSTEM_CATEGORIES, ...OPTIONAL_CATEGORY_PRESETS]) {
    assert.notEqual(category.auto_rules.auto_send, "on", `${category.slug} grants auto_send`);
    assert.notEqual(category.auto_rules.auto_send, "inherit", `${category.slug} inherits auto_send`);
  }
});

test("defaults respect the user's existing inbox", () => {
  const s = DEFAULT_INBOX_SETTINGS;
  assert.equal(s.categorization_enabled, false, "categorization must be off by default");
  assert.equal(s.respect_existing_labels, true, "existing labels must be respected by default");
  assert.equal(s.archive_after_send, false, "archive-after-send must be opt-in");
  assert.equal(s.marketing_strictness, "off");
  assert.deepEqual(s.category_rules, []);
});

test("an absent respect_existing_labels is never read as permission to re-sort", () => {
  // A partial settings row from an older client must not silently opt into re-sorting their mail.
  assert.equal(normalizeInboxSettings({}).respect_existing_labels, true);
  assert.equal(normalizeInboxSettings({ categorization_enabled: true }).respect_existing_labels, true);
  assert.equal(normalizeInboxSettings({ respect_existing_labels: false }).respect_existing_labels, false);
  // Optional customization round-trips.
  const custom = normalizeInboxSettings({
    categorization_enabled: true,
    marketing_strictness: "cold_and_unknown",
    category_rules: [{ category_slug: "marketing", domain: "example.com" }, { category_slug: "" } as never],
  });
  assert.equal(custom.marketing_strictness, "cold_and_unknown");
  assert.equal(custom.category_rules.length, 1, "rules with no category_slug are dropped");
  // An unknown strictness value falls back to off rather than being trusted.
  assert.equal(normalizeInboxSettings({ marketing_strictness: "everything" as never }).marketing_strictness, "off");
});
