"use client";

import { useState } from "react";
import type { SheetRow } from "@/lib/sheetSchema";

const DAYS = 14;

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

type Bin = { key: string; label: string; count: number };

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
    bins.push({ key, label: d.toLocaleDateString([], { month: "short", day: "numeric" }), count: 0 });
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

// Smooth cubic bezier path through points
function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C${cpx.toFixed(2)},${prev.y.toFixed(2)} ${cpx.toFixed(2)},${curr.y.toFixed(2)} ${curr.x.toFixed(2)},${curr.y.toFixed(2)}`;
  }
  return d;
}

const W = 360;
const H = 100;
const PAD_X = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 4;
const GRAD_ID = "act-grad";

export function ActivityChart({ events }: { events: SheetRow[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { bins, total, max } = buildBins(events);

  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const baselineY = PAD_TOP + plotH;
  const step = plotW / (DAYS - 1);

  const pts = bins.map((bin, i) => ({
    x: PAD_X + step * i,
    y: baselineY - (max ? (bin.count / max) * plotH * 0.9 : 0),
    bin,
    i,
  }));

  const linePath = smoothPath(pts);
  const areaPath = total
    ? `${linePath} L${pts[pts.length - 1].x.toFixed(2)},${baselineY} L${pts[0].x.toFixed(2)},${baselineY} Z`
    : "";

  const peak = bins.reduce<Bin | null>((best, bin) => (bin.count > (best?.count ?? 0) ? bin : best), null);
  const hovered = hoveredIndex !== null ? pts[hoveredIndex] : null;

  return (
    <div className="chart-card activity-chart-card">
      <div className="chart-title">
        <span>Activity · 14 days</span>
        <span className="chart-total">{total}</span>
      </div>
      <div style={{ position: "relative" }}>
        <svg
          className="chart-svg"
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Events per day over the last ${DAYS} days, ${total} total`}
          style={{ display: "block", overflow: "visible" }}
        >
          <defs>
            <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--s-accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--s-accent)" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {/* Subtle grid lines */}
          {[0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={PAD_X} y1={PAD_TOP + plotH * (1 - t * 0.9)}
              x2={W - PAD_X} y2={PAD_TOP + plotH * (1 - t * 0.9)}
              stroke="var(--s-divider)"
              strokeWidth={0.5}
              strokeDasharray="3 4"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Baseline */}
          <line x1={PAD_X} y1={baselineY} x2={W - PAD_X} y2={baselineY} stroke="var(--s-divider)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {total ? (
            <>
              <path d={areaPath} fill={`url(#${GRAD_ID})`} stroke="none" />
              <path d={linePath} fill="none" stroke="var(--s-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {/* Hover vertical line */}
              {hovered ? (
                <line
                  x1={hovered.x} y1={PAD_TOP}
                  x2={hovered.x} y2={baselineY}
                  stroke="var(--s-accent)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.5}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {/* Peak dot */}
              {peak && peak.count > 0 ? pts.filter(p => p.bin.key === peak.key).map(p => (
                <circle key={p.bin.key} cx={p.x} cy={p.y} r={hoveredIndex === p.i ? 5 : 3.5} fill="var(--s-accent)" stroke="var(--s-card)" strokeWidth={2} />
              )) : null}
              {/* Hover dot */}
              {hovered && hovered.bin.key !== peak?.key ? (
                <circle cx={hovered.x} cy={hovered.y} r={4} fill="var(--s-accent)" stroke="var(--s-card)" strokeWidth={2} />
              ) : null}
            </>
          ) : (
            <text x={W / 2} y={baselineY - plotH / 2} textAnchor="middle" fill="var(--s-text-3)" fontSize={11} fontFamily="var(--font-ui)">
              No activity yet
            </text>
          )}
          {/* Invisible hit areas */}
          {pts.map((p) => (
            <rect
              key={p.i}
              x={p.x - step / 2}
              y={PAD_TOP}
              width={step}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(p.i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: "crosshair" }}
            />
          ))}
        </svg>
        {/* Tooltip */}
        {hovered && hovered.bin.count > 0 ? (
          <div
            className="activity-chart-tooltip"
            style={{
              position: "absolute",
              top: 0,
              left: `${(hovered.x / W) * 100}%`,
              transform: hovered.i > DAYS * 0.6 ? "translate(-100%, 0)" : "translate(8px, 0)",
              pointerEvents: "none",
            }}
          >
            <span className="activity-chart-tooltip-date">{hovered.bin.label}</span>
            <span className="activity-chart-tooltip-val">{hovered.bin.count}</span>
          </div>
        ) : null}
      </div>
      <div className="chart-foot">
        <span>{peak?.count ? `Peak ${peak.label}` : ""}</span>
        <span className="chart-foot-value">{peak?.count ?? ""}</span>
      </div>
    </div>
  );
}
