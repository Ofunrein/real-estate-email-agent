export type Status = "needs_human" | "active" | "complete" | "voice" | "unknown";

const STATUS_KEYS: string[] = ["needs_human", "active", "complete", "voice", "unknown"];

const COLOR: Record<Status, string> = {
  needs_human: "var(--status-needs-human)",
  active:      "var(--status-active)",
  complete:    "var(--status-complete)",
  voice:       "var(--status-voice)",
  unknown:     "var(--status-complete)",
};

const LABEL: Record<Status, string> = {
  needs_human: "Needs human",
  active:      "Active",
  complete:    "Complete",
  voice:       "Voice",
  unknown:     "Unknown",
};

export function StatusDot({ status }: { status: string }) {
  const s = (STATUS_KEYS.includes(status) ? status : "unknown") as Status;
  const isUnknown = s === "unknown";
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        backgroundColor: isUnknown ? "transparent" : COLOR[s],
        border: isUnknown ? "1px solid var(--text-muted)" : undefined,
        flexShrink: 0,
      }}
      aria-label={LABEL[s]}
      title={LABEL[s]}
    />
  );
}
