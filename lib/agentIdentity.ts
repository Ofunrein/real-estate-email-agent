export const IRIS_AGENT_NAME = "Iris";
export const IRIS_AGENT_AVATAR = "/images/agents/iris.png";

export function agentNameForChannel(): string {
  return IRIS_AGENT_NAME;
}

export function normalizeLegacyAgentName(value = ""): string {
  return /^(Theo|Aria|Olivia)$/i.test(value.trim()) ? IRIS_AGENT_NAME : value;
}

export function normalizeLegacyAgentText(value = ""): string {
  return value.replace(/\b(?:Theo|Aria|Olivia)\b/g, IRIS_AGENT_NAME);
}
