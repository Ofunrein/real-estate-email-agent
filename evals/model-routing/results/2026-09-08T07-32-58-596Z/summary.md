# Model Routing Eval Summary (offline) — 2026-09-08T07-32-58-596Z

Offline mode measures router safety gates, determinism, loop absence, and tier selection. Provider-dependent quality, latency, fallback-rate, and cost gates are NOT measured here and are reported as not_measured_offline.

| Gate | Profile | Total | Passed | Rate |
|------|---------|-------|--------|------|
| compliance_recall | legacy | 80 | 80 | 1.0000 |
| compliance_recall | candidate | 80 | 80 | 1.0000 |
| adversarial_bypass | legacy | 40 | 40 | 1.0000 |
| adversarial_bypass | candidate | 40 | 40 | 1.0000 |
| voice_tier_fixed | candidate | 40 | 40 | 1.0000 |
| determinism | candidate | 120 | 120 | 1.0000 |
| escalation_loops | candidate | 280 | 280 | 1.0000 |

Total corpus cases exercised: 520

Frozen thresholds hash: e320203ed2a82729ad1a7400e675b6a68d40731c

Offline-enforced gates: compliance recall, adversarial bypasses, determinism, escalation loops.
Provider-dependent gates remain explicitly not measured offline.