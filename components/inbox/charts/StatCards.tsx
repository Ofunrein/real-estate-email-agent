"use client";

import { useId, useMemo } from "react";
import { Box, Card, CardContent, Typography } from "@mui/material";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { CircleDollarSign, TrendingUp, UserPlus, Flag } from "lucide-react";
import type { SheetRow } from "@/lib/sheetSchema";

const DAYS = 14;

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

type DayBin = {
  events: number;
  inbound: number;
  outbound: number;
  needReview: number;
  contacts: Set<string>;
};

function contactKey(event: SheetRow): string {
  return event.thread_ref || event.email || event.phone || event.full_name || "unknown";
}

function needsHuman(event: SheetRow) {
  return (
    event.status === "needs_human" ||
    event.event_type === "sms_handoff_reply" ||
    event.ai_action === "handoff_reply_ready" ||
    Boolean(event.handoff_reason)
  );
}

function buildBins(events: SheetRow[]): DayBin[] {
  const now = new Date();
  const bins: DayBin[] = [];
  const index = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    index.set(dayKey(d), bins.length);
    bins.push({ events: 0, inbound: 0, outbound: 0, needReview: 0, contacts: new Set() });
  }
  for (const event of events) {
    const raw = event.event_at;
    if (!raw) continue;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    const slot = index.get(dayKey(parsed));
    if (slot === undefined) continue;
    const bin = bins[slot];
    bin.events += 1;
    if (event.direction === "inbound") bin.inbound += 1;
    else if (event.direction === "outbound") bin.outbound += 1;
    if (needsHuman(event)) bin.needReview += 1;
    bin.contacts.add(contactKey(event));
  }
  return bins;
}

type CardDef = {
  title: string;
  period: string;
  value: string;
  timestamp: string;
  data: { value: number }[];
  color: string;
  Icon: typeof TrendingUp;
  gradientId: string;
};

// 1:1 MUI port of the area-charts-1 stat cards (Card + recharts AreaChart
// with gradient fill, activeDot, custom tooltip). Real 14-day SheetRow data.
export function StatCards({ events }: { events: SheetRow[] }) {
  const bins = useMemo(() => buildBins(events), [events]);
  const uid = useId().replace(/:/g, "");

  const cards = useMemo<CardDef[]>(() => {
    const needReview = bins.reduce((s, b) => s + b.needReview, 0);
    const allContacts = new Set<string>();
    let totalEvents = 0;
    let inbound = 0;
    let outbound = 0;
    for (const b of bins) {
      totalEvents += b.events;
      inbound += b.inbound;
      outbound += b.outbound;
      for (const c of b.contacts) allContacts.add(c);
    }
    const handled = inbound + outbound;
    const aiRate = handled ? Math.round((outbound / handled) * 100) : 0;

    return [
      {
        title: "Need review",
        period: `Last ${DAYS} days`,
        value: String(needReview),
        timestamp: "Flagged for human approval",
        data: bins.map((b) => ({ value: b.needReview })),
        color: "var(--s-stat-2)",
        Icon: Flag,
        gradientId: `needReview-${uid}`,
      },
      {
        title: "Leads total",
        period: `Last ${DAYS} days`,
        value: String(allContacts.size),
        timestamp: "Unique contacts",
        data: bins.map((b) => ({ value: b.contacts.size })),
        color: "var(--s-stat-3)",
        Icon: UserPlus,
        gradientId: `leads-${uid}`,
      },
      {
        title: "Events",
        period: `Last ${DAYS} days`,
        value: String(totalEvents),
        timestamp: `${inbound + outbound} messages tracked`,
        data: bins.map((b) => ({ value: b.events })),
        color: "var(--s-stat-4)",
        Icon: CircleDollarSign,
        gradientId: `events-${uid}`,
      },
      {
        title: "AI reply rate",
        period: `Last ${DAYS} days`,
        value: `${aiRate}%`,
        timestamp: `${outbound} of ${handled} handled`,
        data: bins.map((b) => {
          const h = b.inbound + b.outbound;
          return { value: h ? Math.round((b.outbound / h) * 100) : 0 };
        }),
        color: "var(--s-stat-1)",
        Icon: TrendingUp,
        gradientId: `aiRate-${uid}`,
      },
    ];
  }, [bins, uid]);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
        gap: 1.5,
        p: 2,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      {cards.map((card, i) => {
        const Icon = card.Icon;
        return (
          <Card key={card.title}>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Header with icon and title */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Icon size={18} color={card.color} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {card.title}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 1.25 }}>
                {/* Details */}
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                    {card.period}
                  </Typography>
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 800,
                      letterSpacing: "-0.02em",
                      color: "text.primary",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {card.value}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {card.timestamp}
                  </Typography>
                </Box>
                {/* Chart */}
                <Box sx={{ maxWidth: 160, height: 64, width: "100%", position: "relative", flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={card.data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <defs>
                        <linearGradient id={card.gradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={card.color} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={card.color} stopOpacity={0.05} />
                        </linearGradient>
                        <filter id={`dotShadow${uid}-${i}`} x="-50%" y="-50%" width="200%" height="200%">
                          <feDropShadow dx="2" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.5)" />
                        </filter>
                      </defs>
                      <Tooltip
                        cursor={{ stroke: card.color, strokeWidth: 1, strokeDasharray: "2 2" }}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const value = payload[0].value as number;
                            const label =
                              card.title === "AI reply rate" ? `${value}%` : String(value);
                            return (
                              <Box
                                sx={{
                                  bgcolor: "background.paper",
                                  backdropFilter: "blur(4px)",
                                  border: "1px solid",
                                  borderColor: "divider",
                                  boxShadow: 2,
                                  borderRadius: 1,
                                  p: 1,
                                  pointerEvents: "none",
                                }}
                              >
                                <Typography variant="caption" sx={{ fontWeight: 700, color: "text.primary" }}>
                                  {label}
                                </Typography>
                              </Box>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={card.color}
                        fill={`url(#${card.gradientId})`}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                          r: 6,
                          fill: card.color,
                          stroke: "white",
                          strokeWidth: 2,
                          filter: `url(#dotShadow${uid}-${i})`,
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              </Box>
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
}
