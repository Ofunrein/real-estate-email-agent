# Shared intelligence reducer policy checks

Execution: `npm run eval:shared-intelligence:proof`

Manifest: `evals/shared-intelligence.manifest.json`

Result: 88/88 passed, 0 failed.

This is deterministic local component evidence for reducers and policy helpers. It does not invoke Iris email or Aria voice entrypoints, prove either demo journey end to end, provision Vapi, place calls, send messages, mutate calendars, deploy, or access customer data.

| Check | Result | Evidence |
| --- | --- | --- |
| manifest-all-journeys | PASS | 14 journeys declared |
| manifest-reference-surfaces | PASS | email and voice source paths exist; entrypoints are not invoked by this reducer check |
| manifest-all-categories | PASS | 17 adversarial categories declared |
| manifest-declared-applicability | PASS | 33 cases declare intended email and voice applicability; not runtime coverage |
| reducer:email:buyer:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:buyer:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:seller:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:seller:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:dual_move:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:dual_move:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:renter:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:renter:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:landlord:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:landlord:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:investor:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:investor:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:valuation:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:valuation:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:property_management:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:property_management:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:showing:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:showing:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:email:represented_party:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:represented_party:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=handoff |
| reducer:email:opt_out:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:opt_out:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=closed |
| reducer:email:complaint:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:complaint:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=handoff |
| reducer:email:single_property:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:single_property:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=ground |
| reducer:email:multi_property:shape | PASS | 40 synthetic reducer turns declared |
| reducer:email:multi_property:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=ground |
| reducer:voice:buyer:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:buyer:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:seller:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:seller:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:dual_move:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:dual_move:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:renter:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:renter:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:landlord:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:landlord:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:investor:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:investor:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:valuation:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:valuation:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:property_management:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:property_management:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:showing:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:showing:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=qualify |
| reducer:voice:represented_party:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:represented_party:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=handoff |
| reducer:voice:opt_out:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:opt_out:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=closed |
| reducer:voice:complaint:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:complaint:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=handoff |
| reducer:voice:single_property:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:single_property:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=ground |
| reducer:voice:multi_property:shape | PASS | 40 synthetic reducer turns declared |
| reducer:voice:multi_property:state | PASS | in-memory reducer accepted 40 synthetic turns; phase=ground |
| journey-detection-dual | PASS | dual-move detected without collapsing tracks |
| journey-detection-multi-property | PASS | multiple addresses detected |
| prompt-injection-flag | PASS | injection classified |
| prompt-injection-tool-block | PASS | side-effect tool blocked |
| opt-out-contact-block | PASS | outbound contact blocked after opt-out |
| pii-redaction | PASS | [REDACTED_SSN], routing [REDACTED], card [REDACTED], DOB [REDACTED] |
| fair-housing | PASS | Fair Housing proxy detected |
| financial-advice | PASS | personalized lending advice detected |
| legal-advice | PASS | legal advice detected |
| represented-party | PASS | representation conflict detected |
| complaint | PASS | complaint detected |
| opt-out | PASS | global opt-out detected |
| property-known | PASS | fresh attributable fact remains known |
| property-stale | PASS | expired fact becomes stale |
| property-conflict | PASS | same field with competing current sources conflicts |
| property-unknown | PASS | missing evidence stays unknown |
| scheduling-unverified-receipt | PASS | unverified receipt rejected |
| scheduling-verified-receipt | PASS | verified read-back receipt confirms |
| scheduling-language-block | PASS | confirmation language blocked without receipt |
| scheduling-language-allow | PASS | confirmation language allowed with receipt |
| availability-failure-distinct | PASS | provider failure is not empty results |
| availability-empty-distinct | PASS | successful empty query is empty results |
| idempotency-retry | PASS | same tenant and request produce same key |
| idempotency-tenant-scope | PASS | different tenant produces different key |
| cross-tenant-state | PASS | scope mismatch rejected |
| cross-thread-state | PASS | unrelated thread absent |
| vapi-default-stack | PASS | default stack pinned |
| vapi-premium-canary-disabled | PASS | premium canary is inert |
