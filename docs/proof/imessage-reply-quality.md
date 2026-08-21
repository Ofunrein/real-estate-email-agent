# iMessage / SMS reply-quality proof — chat 1984 live run

Evidence for the cross-channel text rendering and safety work. Two independent tracks, because
this change **was not deployed**: the live track measures the deployed runtime, the local
tracks measure the working tree.

## Target scope (live track)

Resolved from `imsg group --chat-id 1984` and re-verified from `chat.db` before every send:

| field | value |
| --- | --- |
| chat id | `1984` |
| contact | Iris AI |
| service | SMS |
| participant | `+1512•••9460` (agent Twilio number) |
| sending account | `+1512•••2595` |

`scripts/imessage-live-evals.mjs` hard-pins this rowid, has no `--to`, and exits non-zero
without sending if the identity check does not match exactly. No other chat was contacted.

Bounds: 95s per turn, 4s settle, 22min per run, sent one case at a time in five batches.
Every case is appended to `imessage-live-evals-journal.jsonl` the moment its sends complete,
so a killed run never loses evidence and `--regrade` can re-judge without re-texting.

## Suite

21 adversarial cases, 26 sends: property lookup, ambiguous criteria, corrections/typos,
multi-turn memory, amenities, price/budget, showing scheduling, unavailable listing,
malformed/shared link, unrelated request, prompt injection, fair-housing steering,
financial/legal advice, PII/secrets, harassment, urgency, duplicate/replay, unsupported media,
empty/emoji-only, escalation/handoff, dynamic formatting.

Grading is deterministic checks (`lib/smsFormatting.ts`) **plus** an independent model judge on
10 criteria. Deterministic violations are a hard fail regardless of judge score.

## Live BEFORE — deployed runtime, 21/21 cases

`docs/proof/imessage-live-evals-BEFORE.json` (raw replies, message ids, timestamps, direction)

- 1/21 passed, judge mean **2.70** (**3.15** after the judge-prompt fix below)
- `line_wall` ×15 — replies arriving as one unbroken 200–538 char line
- `url_not_isolated` ×6 — `…, Downtown Austin Listing: https://… Want me to send photos?`
- `robotic_label` ×1, `no_reply` ×2, `over_budget` / `too_many_blocks` / `ack_not_single_block`

Compliance guardrails **held** live: prompt injection refused without echoing or leaking, racial
steering refused with a Fair Housing citation, PII/credentials refused, harassment declined.
Those refusals were LLM-dependent, which is the fail-open fixed below.

## Live AFTER — same 21 inputs through the fixed tree

`docs/proof/imessage-live-evals-AFTER.json` via `scripts/imessage-local-replay.mjs`, replaying
the exact outbound texts read back from the live journal.

- **21/21 deterministically clean, 0 violations** (was 19/21 violating)
- `line_wall` 15 → 0, `url_not_isolated` 6 → 0, `robotic_label` 1 → 0

Deterministic checks are the comparable metric across the two runs: they are objective
channel-level invariants and do not depend on which rows retrieval returned.

## In-process judged corpus — 15 cases, same judge

`docs/proof/imessage-reply-evals.json` vs `imessage-reply-evals-BEFORE.json`

| | before | after |
| --- | --- | --- |
| passed | 1/15 | **11/15** |
| overall mean | 2.33 | **4.28** |
| formatting | — | **4.87** |
| readability | — | 4.87 |

Every one of the 15 cases improved; there are no regressions. Four remain under the 4.0 bar
(`ack_sounds_good_midthread` 3.7, `multi_listing_roundup` 3.3, `sensitive_mortgage` 3.9,
`shared_property_context_amenities` 3.8) — all well above their 1.8–2.5 baselines. They are
judge quality-bar shortfalls on tone and specificity, not deterministic or safety failures.

## Fixes this evidence produced

Rendering, all central in `lib/smsFormatting.ts` so SMS, iMessage, WhatsApp, website chat and
social DMs inherit them (every channel funnels through `generateTheoReply`):

1. **Wall splitting** — an over-long line is broken into blocks at sentence boundaries. A single
   over-long sentence is left intact rather than chopped mid-clause.
2. **URL isolation (binding invariant)** — every URL is its own paragraph: alone on its line,
   blank line before and after, nothing preceding or following it, no blank line introduced at a
   message boundary, raw clickable URL preserved, no Markdown link syntax. A label that existed
   only to introduce the link (`Listing:`) is dropped rather than stranded.
3. **`url_not_isolated`** checker rule, evaluated on raw generator output.
4. Family block/line budgets raised where an isolated URL paragraph legitimately costs a block.

Behaviour:

5. **Fail-open safety gate closed** — explicit protected-class steering, credential/PII
   exfiltration, prompt injection and sexual harassment previously matched nothing in the
   deterministic path and fell through to `I can help narrow the search.` Gated on a
   people/place noun so `1200 White Oak Dr` does not escalate.
6. **Appointment misroute** — `\bmove\b` matched "I need to **move** in TOMORROW", so an urgent
   housing text answered `No upcoming appointment found.` Reschedule/cancel now need a booking referent.
7. **Unresolvable shared link** answers with "what's the address?" instead of a different
   listing's facts.
8. **Off-topic asks** decline before steering back.
9. **Emoji-only / punctuation-only** inbound gets a one-line ack, not a pitch.
10. Scheduling names the listing and asks one question; handoffs name the lead and listing;
    amenity answers read as speech, not a pasted Title Case column.

## Evaluator bugs fixed (they were inflating failures)

- Judge prompt omitted `year_built` / `property_type`, so real facts scored as invented.
- Judge prompt included the graded reply inside the thread, so every single-turn case was
  reported as "re-sends the exact message already delivered".
- `checkMessagesFormatting` read normalized lines for `line_wall`, which the new splitter
  repaired first — the rule was permanently unreachable. It now reads raw output.
- First wall splitter broke sentences on the periods inside `zillow.com/...`, tearing links in
  half and silently defeating the repeat guard.

## Reproduce

```bash
node --import tsx scripts/imessage-live-evals.mjs --dry-run              # plan, sends nothing
node --import tsx scripts/imessage-live-evals.mjs --cases prompt_injection --out docs/proof/imessage-live-evals.json
node --import tsx scripts/imessage-live-evals.mjs --regrade --out /tmp/regraded.json
node --import tsx scripts/imessage-local-replay.mjs --out docs/proof/imessage-live-evals-AFTER.json
node --import tsx scripts/imessage-reply-evals.mjs --out docs/proof/imessage-reply-evals.json
```

Not done here, deliberately: no deploy, no migration 027. The live BEFORE numbers describe the
currently deployed runtime and will only change when this is shipped.
