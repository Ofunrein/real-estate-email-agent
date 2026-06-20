"use client";

import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import type { SheetRow } from "@/lib/sheetSchema";

const DAYS = 14;

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

type Bin = { key: string; label: string; narrow: string; count: number };

function buildBins(events: SheetRow[]): { bins: Bin[]; total: number; max: number } {
  const now = new Date();
  const bins: Bin[] = [];
  const index = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    index.set(key, bins.length);
    bins.push({
      key,
      label: d.toLocaleDateString([], { month: "short", day: "numeric" }),
      narrow: d.toLocaleDateString([], { weekday: "narrow" }),
      count: 0,
    });
  }
  let total = 0;
  for (const event of events) {
    const raw = event.event_at;
    if (!raw) continue;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    const slot = index.get(dayKey(parsed));
    if (slot === undefined) continue;
    bins[slot].count += 1;
    total += 1;
  }
  const max = bins.reduce((m, bin) => Math.max(m, bin.count), 0);
  return { bins, total, max };
}

// 1:1 MUI port of the MiniChart activity card: pulsing header, live value
// that swaps to the hovered bar, bars with hover/neighbor/dim states + scaleX
// transforms, per-bar tooltip, and a subtle hover glow. Fed real 14-day data.
export function MiniChart({ events }: { events: SheetRow[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [displayValue, setDisplayValue] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const { bins, total, max } = buildBins(events);

  useEffect(() => {
    if (hoveredIndex !== null) setDisplayValue(bins[hoveredIndex]?.count ?? null);
  }, [hoveredIndex, bins]);

  const handleLeave = () => {
    setIsHovering(false);
    setHoveredIndex(null);
    setTimeout(() => setDisplayValue(null), 150);
  };

  const peak = bins.reduce<Bin | null>((best, bin) => (bin.count > (best?.count ?? 0) ? bin : best), null);
  const showing = isHovering && displayValue !== null;
  const headValue = showing ? displayValue : total;

  return (
    <Box
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={handleLeave}
      sx={{
        position: "relative",
        p: 2.5,
        borderRadius: 3,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        transition: "border-color .3s, background-color .3s",
        "&:hover": { borderColor: "primary.main" },
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: "success.main",
              animation: "minichart-pulse 2s ease-out infinite",
              "@keyframes minichart-pulse": {
                "0%": { boxShadow: "0 0 0 0 rgba(34,197,94,0.55)" },
                "70%": { boxShadow: "0 0 0 6px rgba(34,197,94,0)" },
                "100%": { boxShadow: "0 0 0 0 rgba(34,197,94,0)" },
              },
            }}
          />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "text.secondary",
            }}
          >
            Activity · {DAYS} days
          </Typography>
        </Box>
        <Box sx={{ height: 28, display: "flex", alignItems: "center" }}>
          <Typography
            variant="h6"
            sx={{
              fontVariantNumeric: "tabular-nums",
              transition: "opacity .25s, color .25s",
              opacity: showing ? 1 : 0.6,
              color: showing ? "text.primary" : "text.secondary",
            }}
          >
            {headValue}
            <Box
              component="span"
              sx={{
                fontSize: 12,
                fontWeight: 500,
                color: "text.secondary",
                ml: 0.5,
                transition: "opacity .3s",
                opacity: displayValue !== null ? 1 : 0.7,
              }}
            >
              events
            </Box>
          </Typography>
        </Box>
      </Box>

      {/* Chart */}
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.75, height: 96 }}>
        {bins.map((bin, index) => {
          const heightPx = max ? (bin.count / max) * 96 : 0;
          const isHovered = hoveredIndex === index;
          const isAnyHovered = hoveredIndex !== null;
          const isNeighbor =
            hoveredIndex !== null && (index === hoveredIndex - 1 || index === hoveredIndex + 1);
          return (
            <Box
              key={bin.key}
              onMouseEnter={() => setHoveredIndex(index)}
              sx={{
                position: "relative",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                height: "100%",
                cursor: "pointer",
              }}
            >
              {/* Tooltip */}
              <Box
                sx={{
                  position: "absolute",
                  top: -2,
                  left: "50%",
                  transform: isHovered
                    ? "translate(-50%, 0)"
                    : "translate(-50%, 4px)",
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  bgcolor: "text.primary",
                  color: "background.paper",
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  opacity: isHovered ? 1 : 0,
                  transition: "opacity .2s, transform .2s",
                  pointerEvents: "none",
                  zIndex: 2,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  lineHeight: 1.2,
                  "&::after": {
                    content: '""',
                    fontSize: 9,
                    fontWeight: 400,
                    opacity: 0.7,
                  },
                }}
              >
                {bin.count}
                <Box component="span" sx={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>
                  {bin.label}
                </Box>
              </Box>

              {/* Bar */}
              <Box
                sx={{
                  width: "100%",
                  height: `${heightPx}px`,
                  minHeight: bin.count === 0 ? 3 : 4,
                  borderRadius: 999,
                  transformOrigin: "bottom",
                  transition: "background-color .3s, transform .3s",
                  transform: isHovered
                    ? "scaleX(1.15) scaleY(1.02)"
                    : isNeighbor
                      ? "scaleX(1.05)"
                      : "scaleX(1)",
                  bgcolor: isHovered
                    ? "primary.main"
                    : isNeighbor
                      ? "action.selected"
                      : isAnyHovered
                        ? "action.hover"
                        : "action.selected",
                  ":hover": { bgcolor: isHovered ? "primary.main" : "action.selected" },
                }}
              />

              {/* Label */}
              <Typography
                variant="caption"
                sx={{
                  mt: 0.75,
                  fontSize: 10,
                  fontWeight: 600,
                  transition: "color .3s",
                  color: isHovered ? "text.primary" : "text.disabled",
                }}
              >
                {bin.narrow}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Typography variant="caption" color="text.secondary">
        {peak?.count ? `Peak ${peak.label} · ${peak.count} events` : "No activity yet"}
      </Typography>

      {/* Subtle glow effect on hover */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          borderRadius: 3,
          background: "linear-gradient(to bottom, rgba(124,106,245,0.03), transparent)",
          opacity: isHovering ? 1 : 0,
          transition: "opacity .5s",
          pointerEvents: "none",
        }}
      />
    </Box>
  );
}
