import { agentNameForChannel } from "@/lib/agentIdentity";

interface AgentLabelProps {
  channel: string;
  channelLabel?: string;
}

export function AgentLabel({ channel, channelLabel }: AgentLabelProps) {
  const agent = agentNameForChannel();
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
