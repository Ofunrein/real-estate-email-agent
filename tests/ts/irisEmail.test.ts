import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildIrisEmailLeadMemoryRow,
  classifyIrisEmailText,
  decideIrisEmailExecution,
  irisEmailPollQuery,
  isIrisEligibleEmail,
  parseEmailContact,
  processIrisEmailPoll,
  type IrisEmailClient,
  type IrisEmailMessage,
} from "@/lib/irisEmail";
import { irisEmailCronDryRun, irisEmailCronSendReplies } from "@/lib/irisEmailCron";

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

function fakeClient(messages: IrisEmailMessage[], calls: { labels: string[][]; sent: string[] }): IrisEmailClient {
  return {
    listUnreadMessages: async () => messages,
    applyLabels: async (_messageId, labels) => {
      calls.labels.push(labels);
    },
    sendReply: async (_message, body) => {
      calls.sent.push(body);
    },
  };
}

test("parseEmailContact: extracts name and lowercase email", () => {
  assert.deepEqual(parseEmailContact('"Sam Buyer" <SAM@EXAMPLE.COM>'), {
    name: "Sam Buyer",
    email: "sam@example.com",
  });
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
  assert.match(result.results[0].replyDraft || "", /What day and time works best/);
});

test("processIrisEmailPoll: live injected path records and applies conservative labels", async () => {
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
  assert.deepEqual(calls.labels, [["NEEDS_HUMAN"]]);
  assert.deepEqual(recorded, ["human_required:needs_human"]);
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
    assert.match(query, /is:unread/);
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
    from: "Sam Buyer <sam@example.com>",
    subject: "Tour request",
    body: "Can I tour 100 E 51st St #7 tomorrow?",
  })), true);
});
