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

## 3. Fyxer evidence and comparison

Vendor-primary sources plus one vendor product screenshot. Every visual claim below is measured or
quoted, never inferred. Full claim/source/confidence table produced during research; the load-bearing
findings and the ones that changed my recommendation:

### 3.1 The category set — the brief's list is close, but drops one and adds one

Canonical Fyxer set, five categories, ranked
(`support.fyxer.com/article/fyxer-email-categorization-handbook`, confirmed):

`To do / To respond` → `FYI` → `To follow up / Awaiting reply` → `Notification` → `Marketing`

Real Gmail label strings are numbered and lowercase — `1: to do`, `2: FYI`, `3: notification`,
`4: to follow up`, `5: marketing` — verified by reading the vendor screenshot at
`/tmp/fyxer_labelpane.png` myself. Note the screenshot puts **notification 3rd and to-follow-up 4th**,
contradicting the handbook's ordering. Both are quoted; likely an A/B variant. Casing is inconsistent
across Fyxer's own surfaces (`To do/To respond`, `1: to do`, `To Respond`).

Mapped against the brief's requested queue:

| Fyxer | brief | verdict |
| --- | --- | --- |
| To do / To respond | Needs Reply | same thing |
| FYI | FYI | same |
| To follow up / Awaiting reply | Waiting on Reply | same |
| Marketing | Marketing | same |
| **Notification** | *absent* | **the brief folded this into FYI** |
| *absent* | **Needs Human** | Iris-only; Fyxer needs no such state because it never sends |

**Recommendation change: add `Notification` as a sixth status.** Fyxer separates receipts, alerts and
calendar mail from FYI specifically because drafting is suppressed there — which is exactly Iris's
Tier C. Collapsing it into FYI throws away the signal that already drives the no-draft decision.

Fyxer's categories are **fixed** — "You can't rename them / You can't add or remove categories"
(handbook + `docs.fyxer.com` FAQ). Iris's are DB-backed and editable per client. Keep that; it is a
differentiator, not a gap.

Fyxer also runs a **second topic tier** inside the five ("newsletters, meeting updates, comments,
orders"), on by default, individually toggleable. That is structurally the same two-tier idea Iris
already has — independent convergent evidence the architecture is right. `Meeting update` is a topic
sub-label, **not** a top-level category, correcting a common misreading.

### 3.2 Colors — do not copy the hexes into Iris's current treatment

Fyxer publishes no color spec. The only evidence is one vendor screenshot dated 2026-03-26 served
through GitBook's resizing proxy. I sampled it independently rather than trusting the research pass:

| label | measured fill | Gmail official palette |
| --- | --- | --- |
| 1: to do | `#efa193` | `#efa093` (±1 one channel) |
| 2: FYI | `#ffbc6b` | `#ffbc6b` exact |
| 3: notification | `#68e0a9` | `#68dfa9` (±1) |
| 4: to follow up | `#a4c2f4` | `#a4c2f4` exact |
| 5: marketing | `#fbd4e0` | `#fbd3e0` (±1) |

So: **palette membership is confirmed** (Gmail's official label palette), exact hexes are indicative
only — two exact matches, three off by one channel, consistent with proxy resampling.

The critical finding is that these are **pastel background fills for chips with dark text**, not text
colors. Measured contrast:

| model | range | verdict |
| --- | --- | --- |
| `#202124` text on Fyxer fill | 7.81 – 11.96 | all pass AA |
| Fyxer fill as text on white | 1.35 – 2.06 | **all five fail AA** |

Iris currently uses category color as a *text/dot* color. Dropping Fyxer's hexes into that treatment
would be a severe accessibility regression. **Recommendation:** adopt Fyxer's *treatment* — pastel
chip fill + dark text — using the Gmail-palette fills for the four shared categories, and keep Iris's
existing dark hexes wherever color is applied to text or a status dot. Two token sets, one per usage,
each with a recorded ratio.

Separately, Iris's own palette has two real AA failures as text on white today: `waiting_lead`
`#ca8a04` at 2.94 and `showing` `#ea580c` at 3.56. AA-passing replacements are verified
(`#a16207` at 4.92, `#c2410c` at 5.18), and all sixteen proposed categories clear 4.5.

Treatment details, confirmed from `/tmp/fyxer_inbox.png`: filled colored chip with dark text
immediately left of the subject; topic sub-labels render as a separate neutral grey chip; per-label
counts right-aligned in the label list. No left-border or stripe. No Fyxer-owned inbox chrome — it is
all native Gmail label rendering. Vendor explicitly disclaims stability: "Outlook category colors may
vary by version," and every categorization page carries a "experiences can vary" notice.

### 3.3 Draft-first — Fyxer never auto-sends, at all

Confirmed three times from vendor primary sources:

- "Fyxer never sends drafts automatically – you always review and approve."
- "Fyxer can't send emails on your behalf. We only draft your emails. We never send them." (pricing)
- "Fyxer will never send on your behalf." / "Nothing gets sent without you approving it first."

This is direct evidence for inverting Iris's current default. Iris keeps a **narrow certified Tier A
auto-send** as its differentiation, but the burden of proof sits with auto-send, not with drafting.

Drafts are **native mail-client drafts**, placed as the newest message in the thread, plus the Drafts
folder. Actions are just open → review → small edits → send. **No approve / regenerate / dismiss
affordance is documented anywhere**; regeneration only via forwarding to `ai@fyxer.com` or Fyxer Chat.
Dismissal is passive: unused drafts auto-delete after a retention window, default **14 days**,
adjustable 1–30.

So Iris's proposed draft-first UX (explicit Approve and Send, Edit, Regenerate, Dismiss, Take Over,
Resume AI) is **stronger than Fyxer's**, not catching up to it. Worth adopting from Fyxer: the
retention window with a user control, and the guidance that small edits are the training signal.

Drafts only fire for `To do`/`To respond`; FYI gets nothing; manually relabelling FYI → To do does
**not** trigger a draft. That is the same status-drives-drafting coupling proposed in §4.

### 3.4 Published limits and one vendor self-contradiction

No published accuracy or precision figure exists anywhere. Quality claims are customer-attributed
time savings only ("3.45hrs saved per person per week", Knight Frank). Onboarding analyses only
"~300 of your recent emails" and "doesn't scan your entire inbox history".

Fyxer's own docs contradict themselves on learning: pricing says "Fyxer learns from your corrections
over time to improve accuracy"; support says relabelling mislabelled mail "doesn't train Fyxer".
Both quoted. Iris should not copy either claim.

Documented failure modes worth stealing as test cases: automated/transactional mail skipped, CC-only
threads, very short and extremely long threads, user replied first, snoozed/archived mail, Gmail
filters that archive or skip-inbox overriding the labeller, duplicate integrations wedging
categorisation, and a password change silently breaking the integration.

### 3.5 What could not be established

- Published hex values — none exist; the five above are my measurements of one proxied screenshot.
- The "7-label setup" referenced twice in the handbook; contents undocumented, confirmed gap.
- Whether `notification` sits 3rd or 4th — sources disagree.
- Whether "To do" or "To respond" is the current default; every source hedges with the dual form.
- Any approve/regenerate/dismiss affordance in the running app. Absent from all draft docs, but
  absence of documentation is not proof of absence. I did not log into `app.fyxer.com`.
- Independent review aggregates. Trustpilot returned 403; DuckDuckGo served a CAPTCHA; the only
  other hit looked like affiliate SEO and was not cited.

No prior Fyxer research existed in Atlas or `.hermes`. Local Safari history does show a real Fyxer
trial on 2025-08-21/22 with `gmail.modify` + calendar OAuth. Two Atlas ad PNGs are byte-identical
duplicates and too low-res to be evidence.

**Evidence paths:** `/tmp/fyxer_labelpane.png` (colors, 478×400), `/tmp/fyxer_inbox.png` (layout,
1686×1354), `atlas/ads/competitor_ads/fyxer-ai.json`.


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

---

## SUPERSEDED — final product direction (2026-08-22)

Martin's final direction **replaces §2's queue and every fixed-taxonomy proposal in this document**,
including the later six-label Fyxer-aligned variant. Do not implement those. Recorded here so the
research above is not mistaken for the plan.

**Two Iris-managed labels only, title case, no `Iris/` prefix:**

- `Auto Replied` — applied **only after** Iris successfully sends an authorized reply. Evidence of a
  send, never a decision input. Verified: `AUTO_REPLIED` is only ever written in `lib/irisEmail.ts`
  and the draft-action route; nothing reads it to decide behavior.
- `Needs Human` — applied only when Iris stops for human review. Never triggers a send.

**Respect the user's inbox by default:** `Respect my existing categories/labels` ON; categorization
OFF; no legacy Fyxer/`Iris/*` migration; never rename, delete, recolor, move or archive existing
labels; no archive-after-send by default. Internal machine states stay in the database and must not
leak into the mailbox as extra labels.

**Optional custom categories** (opt-in only): global enable/disable, "Don't categorize my emails"
first-class, create/rename/delete/reorder, custom name + colour with an accessible-contrast preview
and provider colour mapping, keep-in-inbox vs move-out per category, respect-existing-labels,
optional deterministic rules by sender/domain/exact subject, optional marketing-strictness presets.
Custom labels are organizational only and can **never** authorize auto-send.

**Onboarding:** connect inbox → leave organization unchanged (default) or customize → optional
calendar → one-screen summary before activation.

**Calendar:** Google and Outlook/M365 parity, least-privilege, identity/tenant fail-closed, with
provider parity tests (disconnected, expired, permission denied, multiple calendars, timezone/DST,
conflict, cancellation/reschedule, duplicate webhook, retry, tenant isolation).

Consequence for this document: §2's five-status queue, the nine real-estate topic tags, and the
colour work in §3.2 are **reference research only**. The Fyxer evidence stays valid as evidence —
notably that Fyxer never auto-sends, which is the safety baseline this direction adopts.

**Implementation status:** not started. `DEFAULT_INBOX_CATEGORIES` still ships nine `Iris/*`
categories and must shrink to the two managed labels above. The auto-send bug in §7's ordering is
already fixed (commit `e85a2a6`).
