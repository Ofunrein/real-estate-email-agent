/**
 * Central, PURE model-routing decision engine for the model-routing audit
 * (docs/audits/2026-09-model-routing/). `resolveModelRoute` takes a plain input and returns a
 * `Route` — tier + model + fallback chain + human_review boolean. It performs no I/O, makes no
 * provider calls, and reads no clock/random source, so it is deterministic and trivially testable.
 *
 * Two non-negotiables, both enforced by tests in tests/ts/modelRouting/modelRouting.test.ts:
 *
 * 1. Human-review routing is a deterministic RULE evaluated first. A model may only ADD caution
 *    later in the real pipeline (e.g. a low-confidence classification can still be escalated by
 *    downstream logic) — it can never REMOVE the human_review flag this function sets. Nothing in
 *    this file imports or calls the email send-authority function in lib/irisEmail.ts (its Tier A
 *    allowlist), and `Route` deliberately has no send-authorizing field — the router cannot grant
 *    send permission even by accident, because the type doesn't have a slot for it.
 *
 * 2. Rollout is gated by `clientProfile` (`legacy | canary | candidate`), which callers resolve
 *    through `lib/clientConfig.ts`'s `MODEL_ROUTING_PROFILE` (default `legacy`). `legacy` always
 *    returns the pre-audit behavior unchanged: `tier: "legacy"`, no new model, no human_review
 *    override beyond the existing sensitive-keyword safety net every profile shares. A deploy that
 *    never sets `MODEL_ROUTING_PROFILE` therefore changes NOTHING in production.
 */

import { MODEL_PRICING } from "@/lib/modelPricing";

export type TaskClass = "email-classification" | "email-reply" | "sms-reply" | "voice-turn";
export type Channel = "email" | "sms" | "rcs" | "whatsapp" | "voice" | "web" | "website" | "website_chat";
export type ClientProfile = "legacy" | "canary" | "candidate";
export type RoutingTier = "legacy" | "routine_low" | "routine_medium" | "hard_fallback" | "human_only";

export type RouteInput = {
  taskClass: TaskClass;
  channel: Channel;
  /** Message text used ONLY for the deterministic sensitive/adversarial keyword net below — never
   * sent to a model by this function, and never persisted verbatim by callers (see telemetry: only
   * a hash/length may be logged). */
  text: string;
  clientProfile: ClientProfile;
  /**
   * Present for voice-turn callers for audit/decision-record purposes only. The router does NOT
   * currently vary its tier by this value: voice always resolves to the fast/low-effort tier
   * regardless of budget headroom, because Aria's actual model is Vapi-owned (lib/ariaAssistant.ts)
   * and this router cannot change it — see docs/audits/2026-09-model-routing/02-decision.md, Aria
   * row. A real latency-budget downgrade rule would only matter once a candidate model is actually
   * wired into a voice call path, which is explicitly out of scope for this PR.
   */
  latencyBudgetMs?: number;
  /** Test-only escape hatch to exercise the pricing-registry refusal path. Throws outside test/dev
   * (see resolveModelRoute) so it cannot silently reach a production call site. */
  forceModelId?: string;
};

export type Route = {
  tier: RoutingTier;
  modelId: string | null;
  reasoningEffort: "low" | "medium" | "none";
  /** TRUE means this thread must stop for human review. Deliberately the ONLY review/caution
   * signal this type exposes — there is no complementary send-authorizing field. */
  humanReview: boolean;
  fallbackChain: RoutingTier[];
  routingReason: string;
};

// ---------------------------------------------------------------------------------------------
// Deterministic sensitive/adversarial keyword net. Evaluated BEFORE tier selection, for every
// clientProfile including "legacy" — this is a safety net, not part of the hypothesis rollout.
// Keyword-based on purpose: cheap, auditable, zero model latency/cost, and — critically — cannot
// be argued out of its answer by adversarial text, because it never asks a model anything.
// ---------------------------------------------------------------------------------------------
const SENSITIVE_PATTERNS: RegExp[] = [
  /\bschools?\b.*\b(good|great|rated|rating)\b/i,
  /\bsafe\b.*\b(area|neighborhood)\b/i,
  /\b(families|family|kids|children)\b/i,
  /racial makeup|ethnic makeup/i,
  /\bimmigrants?\b/i,
  /wheelchair|disab(led|ility)|accessib/i,
  /\bchurch\b|religious/i,
  /single (women|woman)|safe for a woman/i,
  /interest rate|down payment|mortgage|qualify.*loan|credit score/i,
  /legal(ly)? (right|enforceable|binding)|breach(es)? the contract/i,
  /formal complaint/i,
  /lowest.*(seller|price)|bottom line|absolute lowest/i,
];

// Adversarial / prompt-injection markers. These do not need to be topical — any attempt to
// instruct the system to change its own routing/compliance behavior is itself the trigger.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (your |the )?(previous |prior )?instructions?/i,
  /system:\s*override/i,
  /developer mode/i,
  /###\s*admin\s*###/i,
  /disable.*(review|compliance|routing)/i,
  /set\s+human_review\s*=\s*false/i,
  /pretend.*doesn'?t need a human/i,
  /send.*on my behalf|without (review|approval)/i,
  /send.*automatically|skip.*approval/i,
  /legally bind|without disclosure/i,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Normalize compatibility characters, then collapse whitespace (including newlines) before
 * matching. Several patterns join phrases with `.*`, and JS `.` does not match `\n` without the
 * `s` flag. NFKC also closes simple full-width-character bypasses such as "ＤＥＶＥＬＯＰＥＲ MODE".
 */
function normalizeForMatching(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ");
}

function isSensitiveOrAdversarial(text: string): { hit: boolean; reason: string } {
  const normalized = normalizeForMatching(text);
  if (matchesAny(SENSITIVE_PATTERNS, normalized)) {
    return { hit: true, reason: "sensitive_keyword_net" };
  }
  if (matchesAny(INJECTION_PATTERNS, normalized)) {
    return { hit: true, reason: "adversarial_injection_net" };
  }
  return { hit: false, reason: "" };
}

// ---------------------------------------------------------------------------------------------
// Tier -> model assignment for the "candidate" profile. "canary" uses the same tiers as
// "candidate" (same code path) — the difference between canary and candidate is a traffic-split
// concern for the caller (Step 11's rollout ladder), not a routing-logic concern here.
// ---------------------------------------------------------------------------------------------
const CANDIDATE_TIER_MODEL: Record<Exclude<RoutingTier, "legacy" | "human_only">, { modelId: string; reasoningEffort: Route["reasoningEffort"] }> = {
  routine_low: { modelId: "claude-haiku-4-5", reasoningEffort: "low" },
  routine_medium: { modelId: "claude-haiku-4-5", reasoningEffort: "medium" },
  hard_fallback: { modelId: "claude-sonnet-5-medium", reasoningEffort: "medium" },
};

const LEGACY_TIER_MODEL: Record<TaskClass, string> = {
  "email-classification": "claude-haiku-4-5",
  "email-reply": "claude-sonnet-4-6",
  "sms-reply": "claude-sonnet-4-6",
  "voice-turn": "gpt-4o-mini", // Vapi-managed; recorded for completeness, never called by this router
};

function tierForTaskClass(taskClass: TaskClass): Exclude<RoutingTier, "legacy" | "human_only"> {
  if (taskClass === "email-classification" || taskClass === "voice-turn") return "routine_low";
  return "routine_medium";
}

const FALLBACK_CHAIN: Record<Exclude<RoutingTier, "legacy" | "human_only">, RoutingTier[]> = {
  routine_low: ["routine_medium", "hard_fallback"],
  routine_medium: ["hard_fallback"],
  hard_fallback: [],
};

export function resolveModelRoute(input: RouteInput): Route {
  const { hit, reason } = isSensitiveOrAdversarial(input.text);
  if (hit) {
    return {
      tier: "human_only",
      modelId: null,
      reasoningEffort: "none",
      humanReview: true,
      fallbackChain: [],
      routingReason: reason,
    };
  }

  if (input.clientProfile === "legacy") {
    return {
      tier: "legacy",
      modelId: LEGACY_TIER_MODEL[input.taskClass],
      reasoningEffort: "none",
      humanReview: false,
      fallbackChain: [],
      routingReason: "legacy_profile_unchanged_behavior",
    };
  }

  // Voice is Vapi-owned regardless of profile: the router records the intended fast tier for
  // audit/decision purposes, but never actually changes Aria's live model (see risk register #7).
  const tier = tierForTaskClass(input.taskClass);
  const modelChoice = CANDIDATE_TIER_MODEL[tier];

  if (input.forceModelId && process.env.NODE_ENV === "production") {
    throw new Error(
      "resolveModelRoute: forceModelId is a test-only override and must never be set when NODE_ENV=production"
    );
  }
  const modelId = input.forceModelId ?? modelChoice.modelId;

  if (!MODEL_PRICING[modelId]) {
    throw new Error(`resolveModelRoute: refusing to route to unpriced model "${modelId}" (not in MODEL_PRICING)`);
  }

  return {
    tier,
    modelId,
    reasoningEffort: modelChoice.reasoningEffort,
    humanReview: false,
    fallbackChain: FALLBACK_CHAIN[tier],
    routingReason: `candidate_profile_${input.taskClass}`,
  };
}
