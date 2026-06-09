export type TheoMetric = {
  service: string;
  label: string;
  status: string;
  elapsedMs: number;
  costUsd?: number;
  detail?: string;
};

const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 0.80, output: 4.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
};

let sessionCostUsd = 0;

export function nowMs(): number {
  return Date.now();
}

export function elapsedMs(startMs: number): number {
  return Date.now() - startMs;
}

export function claudeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = CLAUDE_PRICING[model] || { input: 3.00, output: 15.00 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function addTheoSessionCost(costUsd = 0): number {
  sessionCostUsd += costUsd;
  return sessionCostUsd;
}

export function theoSessionCost(): number {
  return sessionCostUsd;
}

export function formatUsd(value = 0): string {
  return `$${value.toFixed(5)}`;
}
