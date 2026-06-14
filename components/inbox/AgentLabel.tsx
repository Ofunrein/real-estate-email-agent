const AGENT_FOR_CHANNEL: Record<string, string> = {
  email:        "Iris",
  sms:          "Theo",
  rcs:          "Theo",
  whatsapp:     "Theo",
  voice:        "Aria",
  web:          "Olivia",
  website:      "Olivia",
  website_chat: "Olivia",
};

interface AgentLabelProps {
  channel: string;
  channelLabel?: string;
}

export function AgentLabel({ channel, channelLabel }: AgentLabelProps) {
  const agent = AGENT_FOR_CHANNEL[channel] ?? "Agent";
  const display = channelLabel ?? channel.replace(/_/g, " ");
  return (
    <span
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-xs)",
        color: "var(--text-muted)",
        fontWeight: 400,
      }}
    >
      via {agent} · {display}
    </span>
  );
}
