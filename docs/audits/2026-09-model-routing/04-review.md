# Review Findings and Dispositions

An independent code reviewer examined `origin/main...06a820c` before this repair pass. The current
executor then repaired the findings below. Per the takeover instruction, no new subagents were
launched. Targeted lint, tests, and frozen-threshold eval passed; the full serial sequence stopped
at the pre-existing typecheck blocker recorded in `03-verification.md`.

| Severity | Finding | Disposition |
|---|---|---|
| High | Sensitive/adversarial patterns using `.*` missed phrases split by newlines. | Fixed: NFKC + whitespace normalization before matching; multiline and full-width regression cases added. |
| High | Offline eval hardcoded two thresholds, ignored the frozen file, left other gates ambiguous, and was absent from CI. | Fixed: eval verifies the frozen file hash, reads applicable values from it, enforces compliance, adversarial, determinism, and loop gates, labels provider-dependent gates unmeasured, and runs in `build-check.yml`. |
| Medium | A transient telemetry-table probe failure was cached forever. | Fixed: each attempt probes independently; a regression test proves a second probe succeeds after a transient failure. |
| Medium | Forty adversarial cases repeated a small circular template set. | Fixed: corpus now has 40 unique mixed-case, multiline, indirect, and full-width-character attempts; diversity is test-enforced. |
| Medium | `attemptCostUsd` silently priced unknown models with a plausible fallback. | Fixed: strict accounting now throws for unknown models. Existing Iris/Theo env overrides use an explicitly named legacy compatibility function, preserving shipped behavior. |
| Low | Voice latency-budget comments and test name claimed a downgrade that did not exist. | Fixed: documentation and test now state that voice remains on the fixed fast tier while Vapi owns Aria's live model. |
| Low | `forceModelId` had no production guard. | Fixed: production use throws; regression test added. |

No finding changed the send gate, mailbox label semantics, `AgentInboxData`, production model ids,
or Aria configuration.
