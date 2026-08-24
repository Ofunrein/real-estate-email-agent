# Pilot vs production gates

Two thresholds. **Pilot** is a low-volume paid client who knows they are early.
**Production** is a client with no such understanding.

Each gate below is either a product safeguard (something this codebase enforces
and a test covers) or an operator check (something a human must confirm, and in
some cases confirm with their own counsel). The distinction matters: the
enforceable column is a promise the code keeps. The operator column is not
legal advice and this document does not give any — it lists the questions a
competent operator has to have answered before shipping.

---

## Infrastructure

| Gate | Pilot | Production |
|---|---|---|
| **Vercel plan** | Hobby is usable at pilot volume, but has no SLA, no team access, and lower function limits. | Pro. You need concurrency headroom, log retention long enough to debug an incident after the fact, and more than one person able to deploy. |
| **Neon plan** | Free tier. Note: it **suspends compute when idle**, so the first webhook after a quiet period pays a cold start, and the free storage ceiling is real. | Launch. Autoscaling, no idle suspend, point-in-time restore. A client whose leads live only in a free-tier database has no recovery story. |
| **Inngest** | Free is fine for low volume. The binding limits are **concurrency** and the monthly execution count, and the ones you will hit first are concurrency during a burst and the 50k executions cap. | Paid, once sustained volume is visible. Watch step count, not event count: `gmailPushReceived` alone runs 6+ steps per push. |
| **Monitoring** | `/api/health` polled manually during business hours. | `/api/health` polled on a schedule with an alert on `"status": "degraded"`. |

**Before production, per client:** confirm the Neon project is on a plan with
PITR, and confirm you can actually restore it. An untested backup is not a
backup.

---

## Messaging compliance

| Gate | Enforceable safeguard (in code) | Operator check (human) |
|---|---|---|
| **A2P 10DLC** | Sends prefer `TWILIO_MESSAGING_SERVICE_SID`, which is where carrier campaign registration attaches. | **Start registration at onboarding, not at launch.** Brand + campaign review takes days. Unregistered traffic is filtered (30032) or spam-blocked (30007) as volume rises. |
| **STOP / START / HELP** | `smsControlAction` recognizes the keyword set; `optOutPatch` writes a sticky `do_not_contact` no later merge can clear; `channelSuppression` blocks every automated channel; Twilio error 21610 on a delivery callback records an opt-out we never saw. | Confirm the client understands that an opt-out stops **all** automated outreach, not just SMS, and that a human can still reply manually from the dashboard. |
| **Consent to message** | Cadence and reply-send both refuse without consent. Inbound-initiated conversation is the only automatic consent basis in the code. | Confirm how the client collects consent for numbers they upload, and that it covers automated messaging. The code cannot verify a claim about how a list was built. |
| **Quiet hours** | `CADENCE_CALL_WINDOW_START_HOUR` / `END_HOUR` bound outbound calling in the lead's local time. | Confirm the window matches the client's jurisdiction. Defaults are 08:00–21:00. |

---

## Voice

| Gate | Enforceable safeguard | Operator check |
|---|---|---|
| **Call recording** | Every inbound and outbound opener discloses recording (`recordingDisclosure()`, asserted in `ariaAssistant.test.ts`). `ARIA_RECORDING_DISCLOSURE=off` removes it. | Texas is one-party consent. Callers dial in from everywhere, and California, Florida, Pennsylvania, Illinois and Washington are all-party consent states. **Only set `off` if recording is actually disabled in Vapi** — turning off the disclosure while still recording is strictly worse than either alternative. Confirm the client's position with their counsel. |
| **Transfer target** | Provisioning refuses without `HUMAN_TRANSFER_NUMBER`; `vapi-live-audit` flags a missing destination as critical. | Confirm the number is monitored during the hours the agent runs. |
| **Licensed advice** | The prompt hard-blocks lending qualification and rate quotes, and the adversarial evals check transcripts for violations. | Confirm the client's licensed agent is the transfer destination for anything the agent refuses. |

---

## Fair housing

| Gate | Enforceable safeguard | Operator check |
|---|---|---|
| **Protected-characteristic questions** | The voice prompt enumerates the full set — safety, schools, crime, "what kind of people live there", family-friendliness, national origin, familial status, source of income — and requires an explicit refusal plus objective substitutes plus a human handoff. `vapi-adversarial-evals` scans real transcripts. | Sample real transcripts weekly during pilot. An eval is a floor, not proof. |
| **Steering in listings** | Property retrieval matches on objective criteria only. | Confirm the client's own listing copy does not reintroduce it. |

---

## Privacy and data handling

| Gate | Enforceable safeguard | Operator check |
|---|---|---|
| **Tenant isolation** | Separate database per client; provider callbacks bound to provider identifiers; env-collision detection at provisioning. See `docs/MULTI_TENANT_ARCHITECTURE.md`. | — |
| **Credentials at rest** | Gmail tokens and provider access tokens encrypted (AES-256-GCM). Client env files are gitignored. | Confirm no client env file has been committed: `git log --all --diff-filter=A --name-only -- 'clients/*.env'` returns nothing but `template.env`. |
| **Secrets in logs** | Secret scan runs on every build. Webhook URLs are redacted in provisioning output. Phone numbers masked in webhook logs. | — |
| **Media retention** | Uploads are client-scoped on read and require dashboard auth. | **No automatic retention policy exists.** Decide a retention period per client and delete on that schedule, or state that data is retained indefinitely. |
| **DPA / processor terms** | — | You are a data processor for the client's leads. Have a DPA in place before production. Sub-processors to name: Anthropic, Twilio, Vapi, Google, Vercel, Neon, Inngest. This is a business/legal step; nothing in the code substitutes for it. |
| **Deletion requests** | — | No automated subject-deletion flow exists. Deleting a lead today is a manual database operation. Know this before promising a deletion SLA. |

---

## Go / no-go

**Pilot may start when:**
- Provisioning validation passes with no collisions
- `/api/health` reports healthy
- The live smoke test in the operator checklist passes, including the STOP →
  next-inbound check
- A2P registration is **submitted**
- Usage caps are set

**Production requires all of the above, plus:**
- Vercel Pro, Neon Launch, Inngest sized to observed volume
- A2P registration **approved**
- DPA signed; retention period agreed and implemented
- Recording-consent position confirmed for every state the client operates in
- One week of pilot traffic reviewed with no fair-housing or unlicensed-advice
  findings
- `/api/health` on a schedule with alerting
