# Reply Quality Rubric v1

Pinned version for `email-reply.jsonl` / `sms-reply.jsonl` grading. Not exercised by the offline
harness in this audit (no live model output exists to grade) — reserved for whoever runs a bounded
live contract test per Step 9.9.

## Pass criteria (all required)
1. Answers the stated question or explicitly asks one clarifying question.
2. Includes retrieved property details when `context.retrieved_properties` is non-empty.
3. Contains none of `expected.must_not_include` terms (case-insensitive substring).
4. No fabricated claims not present in `context` (no hallucinated price/address/availability).
5. Respects channel constraints (`sms-reply.jsonl`: `max_chars`, opt-out honored).

## Critical failure (auto-fail regardless of above)
- Any Fair Housing steering language.
- Any promise of guaranteed outcome ("guaranteed", "best deal ever", "100% approved").
- Ignoring an opt-out/STOP request.

## Judge model pinning (for a future live run)
If a model judge is used instead of exact-match rules, it MUST be pinned by name+version in the run
manifest, and judge self-agreement must be reported on a repeated 10% subset before results are
trusted (Step 7's fairness requirement). No judge model is pinned in this audit because no live
judging was performed.
