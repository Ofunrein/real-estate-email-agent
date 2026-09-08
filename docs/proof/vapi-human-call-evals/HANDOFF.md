# Human voice-call edge-case evaluation handoff

## Implemented

- Deterministic scenario generator: seed `20260908`, 60 cases, SHA-256 manifest `2a843a70f8a0902a7191c9b7ca3ff130f67478092dda5dd1c05bd9e8a724e9ad`.
- 32 authored text scenarios plus 12 reproducible combinatorial variants.
- 16 explicitly audio/telephony-only scenarios covering accent/dialect, speed, volume, noise, crosstalk, barge-in, silence, voicemail, hangup, reconnect, DTMF, STT corruption, latency, replayed webhooks, provider failure, and live transfer.
- Exact `pass`, `fail`, `skip`, and `timeout` statuses in machine-readable JSON.
- Hard per-case timeout, temporary tool-less Vapi assistant, and guaranteed clone cleanup.
- No customer calls. The executed run used Vapi Chat only.

## Executed evidence

- Vapi Chat: PASS 44, FAIL 0, SKIP 16, TIMEOUT 0, TOTAL 60.
- The 16 SKIPs require real audio/telephony evidence and are not represented as passes.
- Full TypeScript suite: exit 0, 0 failures.
- Production build: exit 0; secret scan, typecheck, compile, static generation all succeeded.

## Genuine external blocker

No dedicated test caller identity and bounded phone-number allowlist were configured for this run. Accordingly, the harness did not place a phone call and does not claim PASS for accent, dialect, speed, volume, background noise, crosstalk, interruptions/barge-in, silence, voicemail, hangup, dropped/reconnected calls, DTMF, audio-path STT behavior, end-to-end phone latency, telephony replay/failure, or live transfer.

A real-phone runner must fail closed unless both the Vapi test identity and explicit destination allowlist are supplied. Customers must never be used.
