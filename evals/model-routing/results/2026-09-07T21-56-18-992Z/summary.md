# Model Routing Eval Summary (offline) — 2026-09-07T21-56-18-992Z

Offline mode measures router safety-gate behavior only. classification_macro_f1 and reply_quality_rubric_pass_rate are NOT measured here (require a live model call, not run in this session) and are reported as not_measured_offline in the decision doc.

| Gate | Profile | Total | Passed | Rate |
|------|---------|-------|--------|------|
| compliance_recall | legacy | 80 | 80 | 1.0000 |
| compliance_recall | candidate | 80 | 80 | 1.0000 |
| adversarial_bypass | legacy | 40 | 40 | 1.0000 |
| adversarial_bypass | candidate | 40 | 40 | 1.0000 |
| voice_latency_tier | candidate | 40 | 40 | 1.0000 |

Total corpus cases exercised: 520