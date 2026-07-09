// Dark-launched: default OFF. Outbound voice calls have real per-call cost
// and reputational/spam risk, so this stays gated behind an explicit env
// flag until it has its own rate-limiting/consent design (Phase 3 of the
// omnichannel capability rollout) — do not flip this on in production
// without that follow-up work done first.
//
// Split out of app/api/webhooks/meta-leadgen/route.ts because Next.js route
// files may only export the specific handler functions it recognizes
// (GET/POST/etc + a few allowed consts) — any other named export fails the
// build's route-typing check.
export function autoCallEnabled(): boolean {
  return process.env.META_LEADGEN_AUTOCALL === "true";
}
