# Iris email-first assistant — research, architecture decision, test plan

Status: **research complete except Fyxer visual evidence and the Gmail mailbox sample.**
No code changed. No Gmail mutation. No send. No deploy. No migration 027.

---

## 0. Blocker: the specified mailbox could not be verified

The brief names `ofunrein1234@gmail.com`. I stopped before reading a single message because the
identity check failed. Evidence, in order:

1. `composio connections list` shows **five** Gmail connections on the personal CLI account, one
   with alias `ofunrein1234@gmail.com` (`word_id gmail_kayo-armied`, ACTIVE).
2. The only safe identity probe — `GMAIL_GET_PROFILE` with `user_id: "me"`, which returns the
   mailbox address and message counts and **no message content** — resolved to
   **`ofunrein123@gmail.com`** (123, not 1234), `messagesTotal 123128`.
3. That address is not any alias in the connection list, so **the CLI alias labels are not
   trustworthy** as mailbox identity.
4. The repo's own Composio project (`COMPOSIO_API_KEY` in `.env`) has only **two** Gmail
   connected accounts, `ca__yDIFPGpzCRG` and `ca_mbwaB34eCt8z`, **both EXPIRED**, both
   `user_id ofunrein123@gmail.com`. So the app-side path cannot read at all.
5. Neither `composio execute`, `composio run`, nor `composio proxy --toolkit gmail` accepts a
   connected-account pin. `connections` offers only `list` and `remove`. There is no
   `connections use`.

Why I stopped rather than sampled: the active set also contains **`martin@lumenosis.com`**, a real
business mailbox. With no pin and untrustworthy aliases, any bounded read is a coin flip across
five mailboxes, one of which is a client-facing business account. Reading the wrong one is an
unrecoverable privacy event, not a retryable error.

**What I need from you** (any one unblocks it):

- **(a)** Re-link the intended mailbox in the repo's Composio project and set
  `COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID` in `.env`. Then reads are pinned and verifiable, and the
  app path works too. This is the option I recommend.
- **(b)** Confirm `ofunrein123@gmail.com` is in fact the intended mailbox and the `…1234` in the
  brief is a typo. I will re-probe and proceed if the profile matches.
- **(c)** Tell me to sample via a pinned direct-OAuth path instead of Composio, using
  `GMAIL_TOKEN_JSON` / `GMAIL_CREDENTIALS_JSON` already in `.env`, which bind to one mailbox.

Everything below is independent of that blocker.

---

## 1. Current Iris email architecture (as-built)

Runtime: Gmail push → `app/api/webhooks/iris-gmail-push/` → Inngest `gmail.push.received`
(`lib/inngest/functions/gmailPushReceived.ts`) → `lib/irisEmail.ts` (92.6 KB, 32 exports) with
property retrieval via `lib/propertyRetrieval.ts`. `deprecated/agent.py` is dead; ignore it.

### Classification (`classifyIrisEmailText`)

Already rich and real-estate native:

| field | values |
| --- | --- |
| `intent` | property_search, property_details, showing_request, seller_lead, buyer_lead, renter_lead, human_required, spam |
| `primary_lead_role` | buyer, seller, first_time_buyer, second_time_buyer, renter, landlord, investor, expired_listing_seller, open_house_lead, property_management_lead, mortgage_adjacent_lead, unknown |
| `lead_fields` | timeline, budget, area, beds, current_property_status, preferred_channel |
| plus | tone_state (9), urgency, compliance_flags, confidence, addresses[], next_best_question, recommended_next_action, human_handoff_reason |

`detectIrisComplianceFlags()` exists and feeds a `SENSITIVE_FLAGS` set.

### Existing two-tier taxonomy (`lib/inboxSettings.ts`)

This is the important find — the hybrid model the brief asks for is **already half-built**, with a
code comment stating the intent verbatim: status tier is the queue, topic tier is stackable.

| tier | slugs today |
| --- | --- |
| status | `needs_human` `#be123c`, `needs_reply` `#7c3aed`, `waiting_lead` `#ca8a04`, `nurture` `#64748b`, `closed_no_reply` `#334155` |
| topic | `hot_lead` `#dc2626`, `showing` `#ea580c`, `seller_valuation` `#0f766e`, `financing` `#2563eb` |

Each carries `gmail_label_name` (`Iris/Needs Reply`, …) and `auto_rules.auto_send` of
`on | off | inherit`. `AiDraft` already carries `confidence`, `reason`, `next_action`,
`safe_to_auto_send`, `needs_human`, `fingerprint`, `gmail_draft_id`, `gmail_draft_synced_at`.

### Gap vs the brief

Primary queue — brief wants Needs Reply, FYI, Marketing, Waiting on Reply, Needs Human:

- present: `needs_reply`, `needs_human`, `waiting_lead` (rename to **Waiting on Reply**)
- **missing: `fyi`, `marketing`**
- extra: `nurture`, `closed_no_reply` — these are real-estate lifecycle states, not inbox triage.
  Keep them, but as topic/lifecycle, not as primary queue, or the queue stops being "do I act now?"

Topic tags — brief wants nine:

- present: Showing, Seller/Valuation, Financing, Hot Lead
- **missing: Buyer, Rental, Property Management, Transaction, Compliance/Sensitive**

### The real defect: auto-send is default-on

`decideIrisEmailExecution()` returns `canReply: true` for **everything** that is not spam, not
`human_required`, and carries no sensitive compliance flag. Its comment is explicit:

> "'review' recommended_next_action alone does NOT block auto-reply"

Combined with `DEFAULT_INBOX_SETTINGS`:

```
draft_first: false
auto_send: { email: true, … }
```

…the shipped posture is **auto-send-first for all email**, including general professional email
and anything the model merely flagged for review. The brief requires the inverse: auto-send is a
narrow certified allowlist (Tier A), everything else drafts. Low classifier confidence, missing
verified facts, and out-of-scope-but-benign mail currently all still auto-send. **This is the
highest-severity finding in the audit and the core of the recommendation below.**

### Gmail scopes today

`gmail.send`, `gmail.modify`, `gmail.labels`. `gmail.modify` is the broad one — it covers read,
label, archive, and delete.

### Draft UX today

`app/api/threads/[threadRef]/draft/action/route.ts` supports `approve_send`, `save_edit`,
`dismiss`. Resume-after-takeover exists separately at `review/resolve`. **Missing vs the brief:
Regenerate, explicit Take Over.** UI lives in `components/iris-dashboard/` and
`components/inbox-mui/`; there is no `components/inbox/`.

### Existing adversarial coverage

`tests/fixtures/iris-email-stress-scenarios.json` — **55 scenarios**, schema
`id, family, description, from, subject, body, expectIntent, expectAutoReply, mustInclude, mustNotInclude`.
Families: baseline 4, compliance 8, no_reply 9, confusion 8, prompt_injection 5, tenancy_law 3,
trick_question 5, listing_hallucination 5, missing_property_context 4, low_confidence 4.

Strong on injection, compliance, hallucination. **No fields for primary queue, topic tags, or
reply tier**, and no coverage for: FYI/Marketing/newsletter/promotion/receipt/calendar, attachments,
empty body, signature-only, forwarded chains, quoted-history contamination, auto-reply/OOO,
delivery failure, duplicate webhook delivery, race conditions, human takeover, resume AI, thread
drift, changed requirements mid-thread, wrong recipient, multiple recipients, CC/reply-all,
unicode/multilingual, mobile rendering, draft sync, label sync, retry, tool-output injection,
malicious HTML, tracking links, price changes, rental inquiries, multi-property comparison,
reschedule/cancel, property management, transaction.

---

## 2. Recommended capability model

Keep Iris's existing two-tier engine. Do **not** rebuild it as a flat Fyxer clone. Three changes:

1. **Add the two missing triage statuses** (`fyi`, `marketing`) so the primary queue covers a whole
   inbox and not just real-estate leads. Demote `nurture` and `closed_no_reply` out of the primary
   queue to lifecycle tags.
2. **Invert the auto-send default.** Replace the "not-blocked ⇒ send" rule with an explicit
   allowlist gate that must satisfy every Tier A condition. Everything else drafts.
3. **Add the five missing topic tags** and let them stack on the status.

### Primary queue (exactly one per thread)

| status | meaning | auto_send |
| --- | --- | --- |
| Needs Reply | inbound awaiting our response | `inherit` → Tier gate decides |
| FYI | read-only, no response expected | `off` |
| Marketing | newsletter, promotion, bulk | `off` |
| Waiting on Reply | we responded, awaiting them | `off` |
| Needs Human | blocked pending human judgment | `off` |

### Topic tags (stackable, zero or many)

Buyer, Seller / Valuation, Rental, Showing, Financing, Hot Lead, Property Management, Transaction,
Compliance / Sensitive.

Worked examples from the brief, expressed in this model:

- showing request → `Needs Reply` + `Showing` + `Hot Lead`
- mortgage qualification → `Needs Human` + `Financing` + `Compliance / Sensitive`
- newsletter → `Marketing`, no topic tag
- accepted appointment awaiting confirmation → `Waiting on Reply` + `Showing`

### Colors

Reuse Iris's existing hexes above for the four surviving categories. `fyi` and `marketing` need two
new accessible hues distinct from the existing seven. I will **not** claim Fyxer parity — see §3.

---

## 3. Fyxer evidence

**Pending.** A bounded research pass is running against local Atlas/Hermes caches and public Fyxer
sources. It is instructed to record claim → source → confidence for every item and to report
"not established" rather than guess, and specifically **not to invent hex values**.

Stated position regardless of what it returns: adopt Fyxer's *shape* (a small, flat, whole-inbox
triage queue as the primary axis) because that is the part that makes an inbox feel organized.
Do not adopt its posture on autonomy — Iris keeps the stricter human-control model, and keeps the
real-estate topic tier Fyxer has no equivalent for. If exact colors cannot be sourced, Iris keeps
its own palette and the report says so explicitly instead of implying parity.

---

## 4. Auto-send / human-review policy matrix

### Tier A — certified auto-send

Allowed intents: property-detail request with verified facts; routine listing-link request; basic
showing-availability question; simple scheduling acknowledgment; safe lead-qualification question;
routine factual follow-up; explicit opt-out confirmation then suppression.

Gate — **all** must hold, else demote to Tier B:

| # | condition | source of truth |
| --- | --- | --- |
| 1 | real-estate relevance | `intent` ∈ RE set, not `human_required`/`spam` |
| 2 | high classification confidence | `confidence ≥` threshold (propose 0.80, calibrate on the manifest) |
| 3 | every asserted fact traced to a verified row | `propertyRetrieval` row ids; zero unsourced claims |
| 4 | no sensitive or regulated content | `compliance_flags ∩ SENSITIVE_FLAGS = ∅` |
| 5 | no negotiation or pricing judgment | intent + phrase gate |
| 6 | no unresolved ambiguity | resolved address/ordinal; no conflicting asks |
| 7 | no personal or unrelated context | not personal, not out-of-scope professional |
| 8 | rendered body passes formatting validation | `checkMessagesFormatting` / email equivalent |
| 9 | duplicate-send and thread-state guards pass | `fingerprint`, `gmail_draft_id`, thread status |

### Tier B — response-ready draft, human approves

Seller valuation; offer strategy; negotiation; pricing opinion; mortgage/lending; contracts/legal;
Fair Housing; complaints and angry messages; privacy-sensitive requests; conflicting property
facts; unknown attachment contents; ambiguous identity/relationship; anything needing broker
judgment; **and all general professional email outside certified real-estate scope**.

Hard requirement: the draft is a complete, sendable reply. `IRIS_REVIEW_MARKER` already implements
the right idea — answer everything safely answerable, mark only the uncertain span. Placeholders
like "a human should respond" are a defect, and the manifest asserts their absence.

### Tier C — classify only, no draft

FYI; receipts and notifications; newsletters and promotions; spam; personal or unrelated mail where
drafting is inappropriate.

---

## 5. Gmail scope recommendation

| phase | scopes | why |
| --- | --- | --- |
| discovery + evaluation (now) | `gmail.readonly` | cannot mutate even on a bug; correct posture for this task |
| draft-first operation | `gmail.readonly` + `gmail.compose` + `gmail.labels` | creates and updates drafts and labels, **cannot send** |
| certified auto-send (Tier A only, after approval) | add `gmail.send` | narrowest scope that sends |

Recommend **dropping `gmail.modify`**. It currently grants archive and delete, which nothing in the
brief requires; `gmail.labels` + `gmail.compose` covers the real needs with far less blast radius.

---

## 6. Adversarial manifest plan

Extend the existing fixture rather than starting over: keep all 55 scenarios and add the required
per-case expectation fields.

New per-case schema:

```
id, family, description, from, to, cc, subject, body, attachments, headers,
expectIntent, expectPrimaryQueue, expectTopicTags[], expectTier (A|B|C),
expectAutoSend, expectSafetyState, expectGmailAction (none|label|draft|send),
mustInclude[], mustNotInclude[], expectReplyProps { complete, noPlaceholder, urlIsolated, … }
```

Target ≈ **170 cases** across the brief's full list: the 55 existing plus roughly 115 new covering
triage (FYI/Marketing/receipt/calendar/newsletter/promotion), structure (attachments, empty,
signature-only, forwarded, quoted-history, auto-reply, OOO, bounce), integrity (duplicate Gmail
notification, duplicate webhook, race, retry, draft sync, label sync), control (takeover, resume,
thread drift, changed requirements mid-thread), addressing (wrong recipient, multiple recipients,
CC/reply-all, opt-out), content (unicode/multilingual, long, URL formatting, mobile rendering,
malicious HTML, tracking links), real-estate depth (rental, multi-property comparison, price change,
reschedule/cancel, property management, transaction), and injection (prompt, tool-output).

Seeding from the real mailbox is **blocked** (§0). Until it clears, cases are authored from the
observed structural patterns in the existing corpus. Nothing derived from a live read will be
committed as a raw body or a personal identifier — structure only, anonymized at extraction.

### Gauntlet and gates

Loop: baseline → full manifest → fresh-context critic → rank failures → smallest patch → affected
tests → full suite → new critic. Eight critic lanes as specified, each judging artifacts, payloads,
screenshots, and raw test output rather than my summary.

Required deterministic gates, literal 100%: `passed == total`, zero failed, zero skipped, zero timed
out, zero unevaluated, every manifest ID accounted for. I will report the exact denominator and
every failure. Model-judged quality is reported as a rate and never traded against a required gate.

---

## 7. Before-and-after screenshots

Deliverable 9 needs the dashboard rendering real threads. That depends on the mailbox sample, so it
is queued behind §0. The UI surfaces to capture are `components/iris-dashboard/` and
`components/inbox-mui/`.

---

## 8. Proposed bounded live Gmail certification plan (for approval, not executed)

Only after §0 resolves and the deterministic gates pass, and only with explicit go-ahead:

1. Pin the connected account; assert `GMAIL_GET_PROFILE.emailAddress` equals the approved address,
   fail closed on mismatch. Same pattern that guarded chat 1984.
2. Read-only pass over ≤ 200 recent threads; write only an anonymized taxonomy. No labels, no drafts.
3. Label dry-run: compute the label diff for ≤ 25 threads and print it. Apply nothing.
4. Apply labels to ≤ 5 threads under `Iris/` only, reversible, with a printed undo list.
5. Create ≤ 3 drafts in Gmail. Send nothing. Verify draft sync and idempotency, then delete them.
6. Send certification stays **out of scope** until you approve a separate plan naming exact
   recipients — and I would use a mailbox you own as the recipient, never a real lead.

Each step stops for approval. No step is bundled.

---

## 9. Commands and evidence paths

```bash
# identity probe, metadata only, no message content
composio execute GMAIL_GET_PROFILE -d '{ user_id: "me" }'
composio connections list

# current behavior
npm test
node --import tsx --test tests/ts/irisEmail.test.ts
npm run adversarial            # includes 55 iris email scopes, currently 55/55
```

- classifier + policy: `lib/irisEmail.ts`
- taxonomy + settings: `lib/inboxSettings.ts`
- existing corpus: `tests/fixtures/iris-email-stress-scenarios.json`
- draft actions: `app/api/threads/[threadRef]/draft/action/route.ts`
- prior cross-channel proof: `docs/proof/adversarial-regression.md`

---

## 10. Remaining risks and unavailable evidence

| risk | status |
| --- | --- |
| Target mailbox unverifiable; five active Gmail connections; no pin | **blocking**, §0 |
| Repo Composio Gmail accounts both EXPIRED | blocking for app-path reads |
| Fyxer exact colors and current category set | pending; will be marked unverified rather than claimed |
| Auto-send default-on ships today | highest-severity defect; fix proposed, not yet applied |
| `gmail.modify` grants archive/delete beyond need | scope reduction proposed |
| Real-mail seeding of the manifest | blocked; structural authoring used meanwhile |
| Confidence threshold 0.80 | a guess until calibrated against the manifest |

---

## 11. What I am asking for

Approve, and tell me which §0 option to take:

1. The capability model in §2 — keep the two-tier engine, add `fyi` + `marketing`, demote `nurture`
   and `closed_no_reply`, add the five missing topic tags.
2. Inverting auto-send to the Tier A allowlist gate in §4.
3. The scope reduction in §5, notably dropping `gmail.modify`.
4. The ≈170-case manifest plan in §6.

On approval I implement in this order: taxonomy → Tier gate → manifest → gauntlet → draft-first UX,
with no Gmail mutation until the §8 plan is separately approved.
