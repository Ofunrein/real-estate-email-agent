"use client";
import { useEffect, useState } from "react";

function format(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  // Same calendar day → time of day
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  // Calendar yesterday
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  // Within last 7 days → weekday
  if (diff < 604_800_000) return d.toLocaleDateString([], { weekday: "short" });
  // Older → Mon D
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function RelativeTime({ iso }: { iso: string | null | undefined }) {
  const [label, setLabel] = useState<string>(() => format(iso));
  useEffect(() => {
    setLabel(format(iso));
    const id = setInterval(() => setLabel(format(iso)), 30_000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  return (
    <time
      dateTime={iso}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        color: "var(--text-muted)",
        fontWeight: 500,
        flexShrink: 0,
      }}
      title={new Date(iso).toLocaleString()}
    >
      {label}
    </time>
  );
}
