import type { SheetRow } from "@/lib/sheetSchema";

const DAYS = 14;
const VIEW_W = 320;
const VIEW_H = 120;
const PAD_X = 4;
const PAD_TOP = 14;
const PAD_BOTTOM = 16;

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
    bins.push({
      key,
      label: d.toLocaleDateString([], { month: "short", day: "numeric" }),
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

export function ActivityChart({ events }: { events: SheetRow[] }) {
  const { bins, total, max } = buildBins(events);
  const plotW = VIEW_W - PAD_X * 2;
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const baselineY = PAD_TOP + plotH;
  const step = plotW / DAYS;

  const points = bins.map((bin, i) => {
    const x = PAD_X + step * i + step / 2;
    const ratio = max ? bin.count / max : 0;
    const y = baselineY - ratio * plotH;
    return { x, y, bin };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = total
    ? `${linePath} L${points[points.length - 1].x.toFixed(1)} ${baselineY} L${points[0].x.toFixed(1)} ${baselineY} Z`
    : "";

  const peak = bins.reduce<Bin | null>((best, bin) => (bin.count > (best?.count ?? 0) ? bin : best), null);

  return (
    <div className="chart-card">
      <div className="chart-title">
        <span>Activity · 14 days</span>
        <span className="chart-total">{total}</span>
      </div>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        height={VIEW_H}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Events per day over the last ${DAYS} days, ${total} total`}
      >
        <line
          x1={PAD_X}
          y1={baselineY}
          x2={VIEW_W - PAD_X}
          y2={baselineY}
          stroke="var(--border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {total ? (
          <>
            <path d={areaPath} fill="rgba(184,92,56,0.12)" stroke="none" />
            <path
              d={linePath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {peak && peak.count > 0
              ? points
                  .filter((p) => p.bin.key === peak.key)
                  .map((p) => (
                    <circle key={p.bin.key} cx={p.x} cy={p.y} r={2.5} fill="var(--accent)" />
                  ))
              : null}
          </>
        ) : (
          <text
            x={VIEW_W / 2}
            y={baselineY - plotH / 2}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize={11}
            fontFamily="var(--font-ui)"
          >
            No activity yet
          </text>
        )}
      </svg>
      {peak && peak.count > 0 ? (
        <div className="chart-foot">
          <span>Peak {peak.label}</span>
          <span className="chart-foot-value">{peak.count}</span>
        </div>
      ) : null}
    </div>
  );
}
