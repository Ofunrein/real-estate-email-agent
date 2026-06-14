"use client";
import { useState } from "react";

interface SyncIndicatorProps {
  lastUpdated: string | null;
  isLive: boolean;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function SyncIndicator({ lastUpdated, isLive }: SyncIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const label = isLive
    ? lastUpdated
      ? `Live · Updated ${formatRelative(lastUpdated)}`
      : "Live"
    : "Offline";
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: isLive ? "var(--status-active)" : "var(--status-complete)",
          animation: isLive ? "pulse-dot 2400ms ease-in-out infinite" : "none",
        }}
        aria-label={label}
      />
      {showTooltip && (
        <span
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "var(--nav)",
            color: "var(--text-nav)",
            fontSize: "var(--text-xs)",
            padding: "4px 8px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 100,
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
