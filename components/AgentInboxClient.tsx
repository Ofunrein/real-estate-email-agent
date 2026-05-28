"use client";

import { useMemo, useState } from "react";

import type { AgentInboxData, Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

type View = "overview" | "email" | "sms" | "whatsapp" | "voice" | "website_chat" | "properties";

const channelViews: { key: View; label: string; agent: string; channel?: Channel }[] = [
  { key: "email", label: "Email", agent: "Iris", channel: "email" },
  { key: "sms", label: "SMS", agent: "Theo", channel: "sms" },
  { key: "whatsapp", label: "WhatsApp", agent: "Theo", channel: "whatsapp" },
  { key: "voice", label: "Voice", agent: "Aria", channel: "voice" },
  { key: "website_chat", label: "Website", agent: "Nova", channel: "website_chat" },
];

function formatNumber(value: number | string) {
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  return value;
}

function metric(label: string, value: number | string, note = "") {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function eventText(event: SheetRow) {
  return event.message_text || event.summary || event.ai_action || "";
}

function eventChannel(event: SheetRow) {
  return (event.channel || "unknown").toLowerCase();
}

function latestEvent(events: SheetRow[]) {
  return events[events.length - 1] || {};
}

function TableRows({ events, emptyLabel = "No conversations yet" }: { events: SheetRow[]; emptyLabel?: string }) {
  if (!events.length) {
    return <div className="empty">{emptyLabel}</div>;
  }
  return (
    <div className="row-stack">
      {events.slice(-12).reverse().map((event, index) => (
        <div className="table-row" key={`${event.thread_ref}-${event.event_at}-${index}`}>
          <div className="row-title">{event.email || event.phone || event.thread_ref || "Unknown lead"}</div>
          <div className="row-body">{event.summary || eventText(event)}</div>
          <div className="status">{event.status || event.event_type || event.direction}</div>
        </div>
      ))}
    </div>
  );
}

function ThreadViewer({ threads, channelLabel }: { threads: [string, SheetRow[]][]; channelLabel: string }) {
  if (!threads.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">0</div>
        <strong>No {channelLabel.toLowerCase()} conversations yet</strong>
        <span>Connected webhooks will appear here as live conversation threads.</span>
      </div>
    );
  }
  return (
    <div className="thread-list">
      {threads.map(([threadRef, events]) => {
        const latest = latestEvent(events);
        return (
          <article className="thread" key={threadRef}>
            <div className="thread-head">
              <div>
                <strong>{latest.email || latest.phone || threadRef}</strong>
                <div className="brand-subtitle">{threadRef}</div>
              </div>
              <span className="status">{latest.status || latest.event_type || "active"}</span>
            </div>
            {events.map((event, index) => (
              <div
                className={`message ${event.direction === "outbound" ? "outbound" : "inbound"}`}
                key={`${event.event_at}-${index}`}
              >
                <div className="message-meta">
                  <span>{event.direction || "event"} {event.agent_name ? `via ${event.agent_name}` : ""}</span>
                  <span>{event.event_at || ""}</span>
                </div>
                {eventText(event) || "No message text recorded"}
              </div>
            ))}
          </article>
        );
      })}
    </div>
  );
}

function LeadDetail({ leads }: { leads: SheetRow[] }) {
  const active = leads[leads.length - 1] || {};
  const fields = [
    ["Lead", active.full_name || active.email || active.phone || "No lead selected"],
    ["Role", active.lead_role || "unknown"],
    ["Intent", active.intent || "unknown"],
    ["Property", active.property_interest || ""],
    ["Next action", active.next_action || ""],
    ["Owner", active.assigned_owner || ""],
    ["Handoff", active.handoff_status || ""],
  ];
  return (
    <aside className="panel detail-panel">
      <div className="panel-header">
        <h2 className="panel-title">Shared Lead Memory</h2>
      </div>
      <div className="detail-list">
        {fields.map(([label, value]) => (
          <div className="detail-item" key={label}>
            <span>{label}</span>
            <span>{value || "Blank"}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function viewTitle(view: View) {
  if (view === "overview") return "Conversation Command";
  if (view === "website_chat") return "Website Chat";
  return view[0].toUpperCase() + view.slice(1);
}

export function AgentInboxClient({
  data,
  loadError = "",
  sourceLabel = "Google Sheets",
}: {
  data: AgentInboxData;
  loadError?: string;
  sourceLabel?: string;
}) {
  const [view, setView] = useState<View>("overview");
  const threadEntries = useMemo(() => Object.entries(data.threads), [data.threads]);
  const selectedChannel = channelViews.find((channel) => channel.key === view)?.channel;
  const selectedChannelLabel = channelViews.find((channel) => channel.channel === selectedChannel)?.label || "Channel";
  const channelThreads = selectedChannel
    ? threadEntries.filter(([, events]) => events.some((event) => eventChannel(event) === selectedChannel))
    : [];
  const currentEvents = selectedChannel
    ? data.events.filter((event) => eventChannel(event) === selectedChannel)
    : data.events;
  const propertyHealthScore = data.propertyHealth.total
    ? Math.max(0, Math.round(((data.propertyHealth.total - data.propertyHealth.missing_core) / data.propertyHealth.total) * 100))
    : 0;
  const activeThreads = threadEntries.length;
  const dataStatus = loadError ? "Limited" : "Live";

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Agent Inbox navigation">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <h1 className="brand-title">Agent OS</h1>
            <p className="brand-subtitle">Lumenosis AI</p>
          </div>
        </div>

        <div className="source-card">
          <span>{sourceLabel}</span>
          <strong>{dataStatus}</strong>
          <div className="source-meter" aria-label={`Property data health ${propertyHealthScore}%`}>
            <span style={{ width: `${propertyHealthScore}%` }} />
          </div>
          <small>{propertyHealthScore}% property health</small>
        </div>

        <div className="side-section">
          <p className="side-label">Workspace</p>
          <button className={`nav-button ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}>
            <span><i />Overview</span>
            <span className="nav-count">{data.metrics.event_count}</span>
          </button>
          <button className={`nav-button ${view === "properties" ? "active" : ""}`} onClick={() => setView("properties")}>
            <span><i />Properties</span>
            <span className="nav-count">{data.propertyHealth.total}</span>
          </button>
        </div>

        <div className="side-section">
          <p className="side-label">Channels</p>
          {channelViews.map((item) => (
            <button
              className={`nav-button ${view === item.key ? "active" : ""}`}
              key={item.key}
              onClick={() => setView(item.key)}
            >
              <span><i />{item.label}</span>
              <span className="nav-count">{data.metrics.channels[item.channel || "unknown"] || 0}</span>
            </button>
          ))}
        </div>

        <div className="side-footer">
          <span>Current mode</span>
          <strong>Monitor only</strong>
        </div>
      </nav>

      <main className="main">
        <div className="topbar">
          <div>
            <span className="eyebrow">Urban Mail workspace</span>
            <h1>{viewTitle(view)}</h1>
            <p>Live AI replies, channel handoffs, lead memory, and property sheet health in one place.</p>
          </div>
          <div className="top-actions">
            <div className="sync-status">{sourceLabel} {dataStatus.toLowerCase()}</div>
            <div className="sync-status secondary">Read only</div>
          </div>
        </div>

        {loadError ? (
          <section className="panel notice-panel">
            <div className="table-row">
              <div className="row-title">Data temporarily unavailable</div>
              <div className="row-body">{loadError}</div>
              <div className="status">retry shortly</div>
            </div>
          </section>
        ) : null}

        <section className="metrics-grid" aria-label="Agent metrics">
          {metric("Leads", data.metrics.lead_count, "shared memory")}
          {metric("Threads", activeThreads, "cross-channel")}
          {metric("Inbound", data.metrics.inbound_messages, "lead messages")}
          {metric("AI replies", data.metrics.outbound_replies, "sent events")}
          {metric("Handoffs", data.metrics.needs_human, "needs human")}
          {metric("Properties", data.propertyHealth.total, `${data.propertyHealth.missing_core} need review`)}
        </section>

        <section className="channel-strip" aria-label="Channel status">
          {channelViews.map((item) => {
            const count = data.metrics.channels[item.channel || "unknown"] || 0;
            return (
              <button
                className={`channel-tile ${view === item.key ? "active" : ""}`}
                key={item.key}
                onClick={() => setView(item.key)}
              >
                <span className="channel-agent">{item.agent}</span>
                <strong>{item.label}</strong>
                <small>{count ? `${count} events` : "waiting for webhook"}</small>
              </button>
            );
          })}
        </section>

        {view === "properties" ? (
          <div className="property-layout">
            <section className="panel health-panel">
              <div className="panel-header">
                <h2 className="panel-title">Property Data Health</h2>
                <span className="status">{propertyHealthScore}% clean</span>
              </div>
              <div className="health-score">
                <strong>{propertyHealthScore}</strong>
                <span>of 100</span>
              </div>
              <div className="health-grid">
                <div>
                  <span>Missing core</span>
                  <strong>{data.propertyHealth.missing_core}</strong>
                </div>
                <div>
                  <span>Duplicate groups</span>
                  <strong>{data.propertyHealth.duplicate_groups}</strong>
                </div>
              </div>
            </section>
            <section className="panel property-panel">
              <div className="panel-header">
                <h2 className="panel-title">Sheet Preview</h2>
                <span className="status">{data.propertyHealth.total} rows</span>
              </div>
              <TableRows
                emptyLabel="No property rows loaded"
                events={data.properties.slice(0, 15).map((property) => ({
                  ...property,
                  summary: `${property.price ? `$${Number(property.price).toLocaleString()} ` : ""}${property.beds || ""} bd ${property.baths || ""} bth`,
                  status: property.status || "sheet",
                  email: property.address,
                }))}
              />
            </section>
          </div>
        ) : (
          <div className="workspace">
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">
                  {selectedChannel ? `${selectedChannelLabel} Threads` : "Recent Activity"}
                </h2>
                <span className="status">{currentEvents.length} events</span>
              </div>
              {selectedChannel ? (
                <ThreadViewer threads={channelThreads} channelLabel={selectedChannelLabel} />
              ) : (
                <TableRows events={currentEvents} />
              )}
            </section>
            <LeadDetail leads={data.leads} />
          </div>
        )}
      </main>
    </div>
  );
}
