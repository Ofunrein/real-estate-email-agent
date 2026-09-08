# Human voice-call edge-case evaluation handoff

## Implemented

- Deterministic scenario generator: seed `20260908`, 60 cases, current SHA-256 manifest `db99c4149870b0837779223eb3e9a460f026232cfe4165623bc315fd29a81983`.
- 32 authored text scenarios plus 12 reproducible combinatorial variants. Each variant now appends its selected stress overlay to the base turns.
- 16 explicitly audio/telephony-only scenarios covering accent/dialect, speed, volume, noise, crosstalk, barge-in, silence, voicemail, hangup, reconnect, DTMF, STT corruption, latency, replayed webhooks, provider failure, and live transfer.
- Exact `pass`, `fail`, `skip`, and `timeout` statuses in machine-readable JSON.
- Canonical assertion serialization records every regex source and flag, and the manifest hash covers that representation.
- Every reply turn must be nonempty and is checked for forbidden disclosures and false completed-action claims. Completed scheduling, transfer, and message claims require a verified turn-specific receipt; the tool-less chat clone has none.
- Hard per-case timeout and temporary tool-less Vapi assistant. Cleanup is attempted in `finally`; cleanup failure is a failing harness result, never a warning.
- Chat execution accepts only explicit `VAPI_EVAL_API_KEY` and `VAPI_EVAL_ACCOUNT_ID`. It verifies the credential's account identity before creating a clone and never reads generic credentials or unrelated absolute `.env` paths.
- No customer calls. The executed run used Vapi Chat only.

## Executed evidence

- Historical Vapi Chat artifact: PASS 44, FAIL 0, SKIP 16, TIMEOUT 0, TOTAL 60, against superseded manifest `2a843a70f8a0902a7191c9b7ca3ff130f67478092dda5dd1c05bd9e8a724e9ad` and its weaker oracle.
- `results.json` and `report.md` are retained as historical executed evidence. Manifest regeneration writes `manifest.json` only, so it cannot erase them. No run has executed current manifest; it has no PASS claim.
- The 16 SKIPs require real audio/telephony evidence and are not represented as passes.
- Evaluator regression test: 10 passed, 0 failed after current harness changes.

## Genuine external blocker

No phone runner exists. `--mode phone` exits nonzero before writing `results.json` or `report.md`; it cannot turn unimplemented coverage into an all-SKIP success. No dedicated test caller identity or bounded destination allowlist was configured, and no phone call was placed. Accent, dialect, speed, volume, background noise, crosstalk, interruptions/barge-in, silence, voicemail, hangup, dropped/reconnected calls, DTMF, audio-path STT behavior, end-to-end phone latency, telephony replay/failure, and live transfer remain unexecuted.

A future real-phone runner must fail closed unless dedicated eval credentials, verified account identity, dedicated caller identity, and an explicit destination allowlist are supplied. Customers must never be used.
