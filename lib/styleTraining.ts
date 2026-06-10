// Few-shot style training shared by Theo (SMS) and Aria (voice). Pulls a
// client's APPROVED past messages from email_style_examples and formats them
// into a compact prompt block the agents can mirror. Gated by
// ENABLE_STYLE_TRAINING — when off (default) fetchStyleContext returns "" and
// agent behavior is unchanged.
//
// Iris (agent.py) has its own flag-gated Python reader; this is the TS side.

import { clientConfig } from "@/lib/clientConfig";
import { databaseEnabled, readStyleExamplesFromDatabase, type StyleExample } from "@/lib/database";

export function styleTrainingEnabled(): boolean {
  return clientConfig().styleTraining.enabled;
}

// Format approved examples into a system-prompt block. Empty string when none.
export function buildStyleFewShot(examples: StyleExample[], limit = 3): string {
  const usable = examples
    .map((example) => (example.redacted_excerpt || "").trim())
    .filter(Boolean)
    .slice(0, Math.max(0, limit));
  if (!usable.length) return "";
  const lines = usable.map((excerpt, index) => `Example ${index + 1}:\n${excerpt}`);
  return [
    "Match the tone, phrasing, and structure of these approved past messages from this team. Do not copy their facts — only their voice:",
    ...lines,
  ].join("\n\n");
}

export type StyleTrainingDeps = {
  enabled: () => boolean;
  read: (category: string, limit: number) => Promise<StyleExample[]>;
};

const defaultDeps: StyleTrainingDeps = {
  enabled: () => styleTrainingEnabled() && databaseEnabled(),
  read: readStyleExamplesFromDatabase,
};

// Fetch + format the few-shot block for a category. "" when disabled or empty.
export async function fetchStyleContext(category = "", deps: StyleTrainingDeps = defaultDeps): Promise<string> {
  if (!deps.enabled()) return "";
  const limit = clientConfig().styleTraining.limit;
  try {
    const examples = await deps.read(category, limit);
    return buildStyleFewShot(examples, limit);
  } catch {
    return "";
  }
}
