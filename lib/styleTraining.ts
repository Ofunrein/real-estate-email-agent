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
  read: (category: string, limit: number, mailboxEmail?: string) => Promise<StyleExample[]>;
};

const defaultDeps: StyleTrainingDeps = {
  enabled: () => styleTrainingEnabled() && databaseEnabled(),
  read: (category, limit, mailboxEmail) => readStyleExamplesFromDatabase(category, limit, mailboxEmail),
};

// Fetch + format the few-shot block for a category. "" when disabled or empty.
export async function fetchStyleContext(
  category = "",
  deps: StyleTrainingDeps = defaultDeps,
  mailboxEmail = "",
): Promise<string> {
  if (!deps.enabled()) return "";
  const limit = clientConfig().styleTraining.limit;
  try {
    const examples = await deps.read(category, limit, mailboxEmail);
    return buildStyleFewShot(examples, limit);
  } catch {
    return "";
  }
}

export function redactEmailStyleExample(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}\b/g, "[phone]")
    .replace(/\$\s?\d[\d,.]*(?:\s?(?:k|m|million|thousand))?\b/gi, "[price]")
    .replace(/\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,5}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Path|Trail|Trl|Circle|Cir|Place|Pl)\b(?:\s*(?:#|Unit|Apt)\s*[A-Za-z0-9-]+)?/gi, "[property]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}
