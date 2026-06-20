import type { SheetRow } from "@/lib/sheetSchema";

type ChannelGroup = { key: string; label: string; raw: string[] };

const GROUPS: ChannelGroup[] = [
  { key: "email", label: "Email · Iris", raw: ["email"] },
  { key: "sms", label: "SMS · Iris", raw: ["sms", "rcs"] },
  { key: "whatsapp", label: "WhatsApp · Iris", raw: ["whatsapp"] },
  { key: "messenger", label: "Messenger · Iris", raw: ["messenger"] },
  { key: "instagram", label: "Instagram · Iris", raw: ["instagram"] },
  { key: "voice", label: "Voice · Iris", raw: ["voice"] },
  { key: "web", label: "Web · Iris", raw: ["web", "website", "website_chat"] },
];

function buildCounts(events: SheetRow[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const channel = (event.channel || "").toLowerCase();
    if (!channel) continue;
    const group = GROUPS.find((g) => g.raw.includes(channel));
    if (!group) continue;
    counts.set(group.key, (counts.get(group.key) || 0) + 1);
  }
  return GROUPS.map((group) => ({ ...group, count: counts.get(group.key) || 0 })).filter(
    (row) => row.count > 0,
  );
}

export function ChannelMix({ events }: { events: SheetRow[] }) {
  const rows = buildCounts(events).sort((a, b) => b.count - a.count);
  const max = rows.reduce((m, row) => Math.max(m, row.count), 0);
  const topKey = rows[0]?.key;

  return (
    <div className="chart-card">
      <div className="chart-title">
        <span>Channels</span>
        <span className="chart-total">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="channel-mix">
          {rows.map((row) => (
            <div className="channel-row" key={row.key}>
              <span className="channel-label">{row.label}</span>
              <div className="channel-track">
                <span
                  className={`channel-bar${row.key === topKey ? " is-top" : ""}`}
                  style={{ width: `${max ? Math.max(6, (row.count / max) * 100) : 0}%` }}
                />
              </div>
              <span className="channel-count">{row.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="chart-empty">No channel activity yet</p>
      )}
    </div>
  );
}
