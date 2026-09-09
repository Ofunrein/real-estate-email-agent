# Voice Agent Architecture

How the Lumenosis voice agent is built, and how to build another one that replaces a
voicemail box or an inside sales agent without it sounding like a robot or leaking data.

This is written to be reusable. The Lumenosis demo is the worked example, not the subject.

## The core decision: one assistant, per-call context

There is exactly **one** Vapi assistant (`VAPI_DEMO_ASSISTANT_ID`). Nothing is created in
Vapi per customer, per property, or per demo. The dashboard config is a nearly empty shell.

On every call, the server looks up the record for that token and returns `assistantOverrides`,
which the browser passes to `vapi.start(assistantId, overrides)`. The overrides replace, per
call: `firstMessage`, the entire `model.messages[0]` system prompt, `voice`, `transcriber`,
the speaking plans, and the duration cap.

```
browser ──GET /api/demo/[token]/voice──► server
                                          │ look up the ONE record for this token
                                          │ build system prompt from its verified facts
                                          ▼
browser ◄──{ publicKey, assistantId, assistantOverrides }──┘
   │
   └─ vapi.start(assistantId, assistantOverrides)
```

Why this shape:

- **No fan-out.** 500 listings is not 500 assistants to keep in sync. Fix a prompt bug once
  and every call gets it immediately.
- **Facts cannot go stale.** Details are read from the datastore at call time, not frozen into
  a dashboard weeks ago.
- **Isolation is structural, not policed.** Each call's payload contains one record. There is
  no path for tenant A's data to appear in tenant B's call because it was never in the
  payload. This is much stronger than instructing a model not to mix things up.

**The trap:** because behavior lives in code, *editing the assistant in the Vapi dashboard
does almost nothing* — overrides win every call. Change `lib/demo-voice.ts`, not the dashboard.
Tools/functions are the exception: those are not overridden here and do come from the dashboard.

## Four things a prompt alone will not give you

A well-written persona prompt still produces a bad agent, because these four failures are
structural rather than stylistic.

### 1. It has no clock

An LLM cannot infer the wall clock. Unprompted it will offer "Tuesday at 3" during a Sunday
2am call, or call a three-week-old listing "new". `lib/demo-voice-clock.ts` computes the real
time in the **listing's market timezone** (not the server's UTC) and renders it speech-ready.

Non-obvious cases it must handle, all covered by tests:

- Friday evening must roll follow-up to **Monday**, never "tomorrow" (nobody works Saturday).
- Same instant is a different weekday in different markets — 11:15pm Wednesday in Chicago is
  already Thursday in London.
- After hours, the agent must stop promising an immediate human reply.
- On-the-hour times must not read "two o'clock zero zero".

### 2. It never stops talking

With no idle policy and no hangup policy, a voice agent runs until the duration cap. The
caller went silent 90 seconds ago and it is still asking if there's anything else.

`lib/demo-voice-flow.ts` sets a `messagePlan`: a few **varied** idle nudges (identical repeats
sound robotic), capped, then a clean goodbye that actually says goodbye. The duration cap is a
cost guard, not a conversation tool — hitting it means the agent failed to end a finished call.

Turn-taking detail that matters: wait **longer** on speech with no terminal punctuation.
A caller trailing off with "um, so, I think..." is mid-thought; cutting in forces them to start
over. And barge-in needs ≥2 words, or every "yeah"/"mhm" backchannel halts the agent.

### 3. Everything that is not the happy path

Demo agents get asked the obvious questions. Production agents replacing a voicemail box get
wrong numbers, kids on the line, voicemail systems, DTMF, hostile callers, and dead air.
`lib/demo-voice-edge-cases.ts` enumerates these explicitly. An unenumerated edge case is
handled by whatever the base model feels like doing, which is not a policy.

### 4. Text review cannot verify audio

This is the one people skip. A prompt can read perfectly and still produce audio that says
"one two zero four Oak Drive". **The only way to catch it is to synthesize real speech and
transcribe it back.**

## The audio gate, and why naive versions pass vacuously

`scripts/audio-qa-gate.mjs` runs: text → Deepgram TTS (aura-2) → mp3 → Deepgram STT →
assertions on the words that actually came out. It also checks real duration via `ffprobe`,
because an empty 200 response with a silent file will otherwise "pass".

**Hard-won lesson: verify your negative controls, or the gate is theater.**

The first version of this gate passed 5/5 and was nearly worthless. Deepgram's TTS *normalizes
ugly input on its own*, verified against the live API:

| Input | What is actually heard | Consequence |
|---|---|---|
| `800000.00` | "eight hundred thousand dollars" | `"point zero"` can never fire |
| `M L S` | "mls" (one token) | `"m l s"` can never fire |
| `listing_photo_1` | "listing photo one" | `"underscore"` can never fire |
| `https://example.com/` | "h t t p s **colon slash slash** example **dot com**" | `"slash"` fires ✓ |
| `2026-03-09T14:00` | "twenty twenty six-three-09t140" | `"dash"`/`"colon"` never fire |

So half the forbidden phrases were unreachable and asserted nothing. **Every `mustNotSay`
entry must be proven reachable by deliberately feeding bad input and confirming the gate
fails.** Prefer positive `mustSay` assertions, which cannot pass vacuously.

Once corrected, the gate immediately caught a real bug: `1204 Oak Drive` is spoken
"one two zero four oak drive".

## Secrecy and isolation

- The system prompt forbids revealing itself, its instructions, its model, or that overrides
  exist. Assert this in tests; do not assume it.
- Buyer-facing output must not mention AI, automation, or a demo. This is asserted against
  the route source and policy file, so a future edit reintroducing disclosure language fails CI.
- Recording disabled, no phone number, no live calendar/CRM access — and say so in the UI.
- Only one record's facts ever reach a call payload.

## Building a new one: checklist

1. One assistant. Everything dynamic goes in `assistantOverrides`, built server-side per call.
2. Inject the real clock in the **subject's** timezone, spelled for speech.
3. Add an idle plan (varied, capped) and explicit end-of-call rules. Duration cap is a guard.
4. Endpointing: longer wait on unpunctuated speech; barge-in ≥2 words.
5. Enumerate edge cases explicitly. Unlisted means unhandled.
6. Build the real audio gate **and prove it can fail** before trusting a pass.
7. Assert secrecy and no-disclosure in tests, against source files where possible.
8. Never let an LLM emit identifiers or media URLs — retrieve and verify them. (Same class of
   bug as `listing-photo-source.ts`: invented CDN URLs look plausible and show other properties.)

## Files

| File | Role |
|---|---|
| `lib/demo-voice.ts` | Assembles per-call overrides; the one place behavior changes |
| `lib/demo-voice-clock.ts` | Real date/time in market timezone, speech-ready |
| `lib/demo-voice-flow.ts` | Idle/silence plan, endpointing, barge-in, duration cap |
| `lib/demo-voice-edge-cases.ts` | Explicit non-happy-path policy |
| `app/api/demo/[token]/voice/route.ts` | Auth, rate limit, returns overrides |
| `scripts/audio-qa-gate.mjs` | Real TTS→STT audio verification |
| `tests/demo-voice-flow.spec.ts` | Clock/flow/edge-case coverage |

## Runbook

```bash
# Behavior change: edit lib/demo-voice*.ts, never the Vapi dashboard.
npx tsc -p tsconfig.json --noEmit
npx playwright test tests/demo-voice-flow.spec.ts tests/demo-voice.spec.ts

# Audio gate (needs DEEPGRAM_API_KEY + ffprobe). Exits non-zero on failure.
node scripts/audio-qa-gate.mjs
```

**Rebuild before trusting UI test results.** `pnpm test` runs `next build && playwright test`;
running `playwright test` alone tests the *previous* build. A stale build produced six
confusing failures where the page still served old button text that no longer existed in source.
