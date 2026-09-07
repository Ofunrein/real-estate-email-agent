import { attemptCostUsd } from "@/lib/modelPricing";

export type TheoMetric = {
  service: string;
  label: string;
  status: string;
  elapsedMs: number;
  costUsd?: number;
  detail?: string;
};

// Pricing now lives in lib/modelPricing.ts (single source of truth — the duplicated table that
// used to live here and in lib/irisEmail.ts was removed; see
// docs/audits/2026-09-model-routing/00-evidence-ledger.md §0.5).

let sessionCostUsd = 0;

export function nowMs(): number {
  return Date.now();
}

export function elapsedMs(startMs: number): number {
  return Date.now() - startMs;
}

export function claudeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  return attemptCostUsd(model, { inputTokens, outputTokens });
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
