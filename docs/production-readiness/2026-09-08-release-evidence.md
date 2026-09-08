# Release evidence — 2026-09-08

Base: `b929f293424a7ed44ed7331d240670be650139b7` (merged PR #7)
Branch: `release/production-readiness-20260908`
Policy: unknown or externally controlled state is never PASS.

## Executed repository evidence

| Gate | Status | Evidence |
|---|---|---|
| Canonical checkout and branch isolation | PASS | Clean worktree created from fetched `origin/main`; unrelated `audit/model-routing-evidence-20260907` checkout left untouched. |
| Open-PR collision | PASS | `gh pr list --state open` returned none before branch creation. |
| TypeScript regression | PASS | `node --import tsx --test --test-concurrency=1 "tests/ts/**/*.test.ts"`: 1,075 passed, 0 failed/skipped. |
| Python regression | PASS | `npm run test:py`: 96 passed. |
| PostgreSQL integration | PASS | Both demo-ownership and shared-intelligence scripts passed against disposable PostgreSQL. |
| Shared-intelligence adversarial journeys | PASS | `npm run eval:shared-intelligence:proof`: 88/88 checks passed, including configured 40-turn journeys, tenant isolation, booking receipt gate, default voice stack, and inert premium canary. |
| Routing safety evaluation | PARTIAL | 520 offline cases passed all offline-enforced gates. Provider-dependent quality, latency, and cost remain unmeasured. |
| Production-path typecheck | PASS | `npm run lint` passed. This PR adds an explicit identical `npm run typecheck` gate. Full-repository `tsc --noEmit` is not the repository contract and currently includes test-fixture typing errors; this is not relabeled PASS. |
| CI serial execution | PASS in code | `npm test` now pins `--test-concurrency=1`; CI now runs shared-intelligence proof and production-path typecheck. Remote CI required before merge. |
| Security controls | PASS in code | Existing auth, CSRF, CSP/HSTS/COOP, shared Upstash rate limiting, constant-time webhook-secret comparison, payload limits, tenant isolation, encryption, audit, usage-cap, and idempotency tests are included in the 1,075-test run. Fresh secret scan/build evidence required after final diff. |
| Accessibility/mobile/browser smoke | BLOCKED | No authenticated dedicated test identity/session is available in this checkout. Anonymous login-page browser smoke can be run, but cannot prove protected dashboard accessibility or mobile behavior. |

## Live read-only evidence

| Gate | Status | Evidence |
|---|---|---|
| GitHub | PASS | PR #7 merged as `b929f293424a7ed44ed7331d240670be650139b7`; build workflow run `34218400777` succeeded for that SHA. Main has no branch-protection rule. |
| Vercel deployment | PASS, identity only | Latest production deployment was Ready during inspection. Exact deployed Git SHA and custom-domain alias still require verification before release. |
| Shared rate-limit store | PASS, presence only | Vercel production metadata lists both Upstash variables. Values/connectivity were not exposed or asserted. |
| Production credential values | BLOCKED | Read-only Vercel metadata lists many encrypted variables, but decrypted API inspection yielded empty values for `DATABASE_URL`, `PUBLIC_BASE_URL`, `CRON_SECRET`, Vapi/OpenAI/Deepgram IDs/keys, and all three usage caps. This may be empty-value configuration or a decryption/access-control boundary. No value was printed. Health, DB, provider, and Vapi checks cannot proceed safely until owner-verified non-empty values are available. |
| Vapi live configuration | BLOCKED | Could not authenticate with a non-empty production Vapi credential. Live model, transcriber, voice, recording, transfer, and phone attachment remain unknown. |
| ElevenLabs voice/account | BLOCKED | No `ELEVENLABS_API_KEY` exists in production metadata. Vapi may own the integration, but Vapi state was inaccessible. No voice name/ID can be honestly selected or claimed. |
| Voice source defaults | PASS in code only | `gpt-4.1-mini-2025-04-14`, Deepgram `flux-general-en`, ElevenLabs `eleven_flash_v2_5`; premium `eleven_multilingual_v2` canary disabled. Live parity is unknown. |
| ElevenLabs Flash official public price | PASS, published list price only | ElevenLabs API pricing lists Flash/Turbo TTS at USD 0.05 per 1,000 characters and describes Flash v2.5 as about 75 ms. Actual Vapi/account markup and measured call cost remain unknown. Sources: https://elevenlabs.io/pricing/api and https://elevenlabs.io/docs/product/speech-synthesis/models |
| Domains/SSL/security headers | BLOCKED | `PUBLIC_BASE_URL` could not be safely resolved from decrypted production configuration. Custom-domain certificate, DNS, headers, and endpoint smoke remain unverified. |

## Readiness areas

| Area | Status | Remaining proof or owner control |
|---|---|---|
| Accessibility/mobile | BLOCKED | Dedicated authenticated test identity and browser smoke. |
| Auth/subscription/API/feature flags | BLOCKED | Production values and bounded authenticated smoke; Stripe/customer mutations forbidden. |
| Rate limits/errors | PARTIAL | Code tests pass and Upstash names exist; production connectivity and enforced distributed behavior unverified. |
| Environment separation/security | PARTIAL | Source controls and metadata reviewed; encrypted-value ambiguity and missing usage caps block PASS. |
| Scaling/DDoS/backups/rollback | BLOCKED | Vercel plan, Neon plan/PITR restore drill, Inngest capacity, DDoS controls, named rollback owner/window. |
| Domains/SSL | BLOCKED | DNS, alias, certificate chain, expiry, HSTS, and redirect smoke on intended custom domain. |
| Monitoring/billing | BLOCKED | Scheduled health alert, alert delivery test, plan ownership, budgets, and provider cost telemetry. |
| Least privilege/encryption/audit/key rotation | PARTIAL | Repository and PostgreSQL role tests pass. Live grants/audit retention/key age and rotation runbook owner remain unverified. No secret rotation authorized. |
| Legal/support/privacy | BLOCKED | Signed DPA, recording-consent decision, A2P approval, retention period and implemented deletion schedule, privacy/support ownership. These are not code substitutes. |
| Production release/smoke | BLOCKED | Exact deploy SHA, migration ledger/parity, health, dedicated test data, and non-customer smoke. |

## Voice release decision

Keep source defaults unchanged: ElevenLabs Flash v2.5 (`eleven_flash_v2_5`), Deepgram Flux (`flux-general-en`), GPT-4.1 mini (`gpt-4.1-mini-2025-04-14`). Keep multilingual v2 canary disabled. Do not provision until live Vapi state and a natural professional female voice are inspectable. Reuse an existing approved premium female voice when one is present; otherwise owner must provide ElevenLabs/Vapi access for a bounded audition using synthetic text. No voice ID or name is invented here.

## Rollback and release boundary

Do not merge or deploy while any required gate above is BLOCKED. Before deployment, capture current Vercel deployment ID, Vapi assistant configuration checksum, migration ledger, feature-flag values, and DB backup/PITR restore point without exposing secrets. Apply additive migrations first with flags inert, verify, then provision Vapi, deploy, and run dedicated-test-identity smoke. Roll back by restoring prior Vapi configuration and deployment/flags; never replay ambiguous sends or mutate customer records.
