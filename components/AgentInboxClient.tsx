"use client";

import { useMemo, useState } from "react";

import type { AgentInboxData, Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

type View = "overview" | "email" | "sms" | "whatsapp" | "voice" | "properties";

const channelViews: { key: View; label: string; channel?: Channel }[] = [
  { key: "email", label: "Email", channel: "email" },
  { key: "sms", label: "SMS", channel: "sms" },
  { key: "whatsapp", label: "WhatsApp", channel: "whatsapp" },
  { key: "voice", label: "Voice", channel: "voice" },
];

function metric(label: string, value: number | string) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
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

function TableRows({ events }: { events: SheetRow[] }) {
  if (!events.length) {
    return <div className="empty">No conversations yet</div>;
  }
  return (
    <>
      {events.slice(-12).reverse().map((event, index) => (
        <div className="table-row" key={`${event.thread_ref}-${event.event_at}-${index}`}>
          <div className="row-title">{event.email || event.phone || event.thread_ref || "Unknown lead"}</div>
          <div className="row-body">{event.summary || eventText(event)}</div>
          <div className="status">{event.status || event.event_type || event.direction}</div>
        </div>
      ))}
    </>
  );
}

function ThreadViewer({ threads }: { threads: [string, SheetRow[]][] }) {
  if (!threads.length) {
    return <div className="empty">No threads for this channel yet</div>;
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

export function AgentInboxClient({ data, loadError = "" }: { data: AgentInboxData; loadError?: string }) {
  const [view, setView] = useState<View>("overview");
  const threadEntries = useMemo(() => Object.entries(data.threads), [data.threads]);
  const selectedChannel = channelViews.find((channel) => channel.key === view)?.channel;
  const channelThreads = selectedChannel
    ? threadEntries.filter(([, events]) => events.some((event) => eventChannel(event) === selectedChannel))
    : [];
  const currentEvents = selectedChannel
    ? data.events.filter((event) => eventChannel(event) === selectedChannel)
    : data.events;

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Agent Inbox navigation">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <h1 className="brand-title">Agent Inbox</h1>
            <p className="brand-subtitle">Lumenosis AI</p>
          </div>
        </div>

        <div className="side-section">
          <p className="side-label">Workspace</p>
          <button className={`nav-button ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}>
            <span>Overview</span>
            <span className="nav-count">{data.metrics.event_count}</span>
          </button>
          <button className={`nav-button ${view === "properties" ? "active" : ""}`} onClick={() => setView("properties")}>
            <span>Properties</span>
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
              <span>{item.label}</span>
              <span className="nav-count">{data.metrics.channels[item.channel || "unknown"] || 0}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{view === "overview" ? "Conversation Monitor" : view[0].toUpperCase() + view.slice(1)}</h1>
            <p>
              Read-only view of AI conversations, handoff state, and shared lead memory. Edits stay in the client CRM
              and Google Sheets.
            </p>
          </div>
          <div className="sync-status">{loadError ? "Google Sheets limited" : "Google Sheets live"}</div>
        </div>

        {loadError ? (
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="table-row">
              <div className="row-title">Data temporarily unavailable</div>
              <div className="row-body">{loadError}</div>
              <div className="status">retry shortly</div>
            </div>
          </section>
        ) : null}

        <section className="metrics-grid" aria-label="Agent metrics">
          {metric("Leads", data.metrics.lead_count)}
          {metric("Events", data.metrics.event_count)}
          {metric("Needs human", data.metrics.needs_human)}
          {metric("Properties", data.propertyHealth.total)}
        </section>

        {view === "properties" ? (
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Property Data Health</h2>
              <span className="status">{data.propertyHealth.missing_core} missing core fields</span>
            </div>
            <div className="table-row">
              <div className="row-title">Duplicate groups</div>
              <div className="row-body">Potential same-address rows to review in Google Sheets</div>
              <div className="status">{data.propertyHealth.duplicate_groups}</div>
            </div>
            <TableRows
              events={data.properties.slice(0, 15).map((property) => ({
                ...property,
                summary: `${property.price ? `$${Number(property.price).toLocaleString()} ` : ""}${property.beds || ""} bd ${property.baths || ""} bth`,
                status: property.status || "sheet",
                email: property.address,
              }))}
            />
          </section>
        ) : (
          <div className="workspace">
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">
                  {selectedChannel ? `${channelViews.find((item) => item.channel === selectedChannel)?.label} Threads` : "Recent Activity"}
                </h2>
                <span className="status">{currentEvents.length} events</span>
              </div>
              {selectedChannel ? <ThreadViewer threads={channelThreads} /> : <TableRows events={currentEvents} />}
            </section>
            <LeadDetail leads={data.leads} />
          </div>
        )}
      </main>
    </div>
  );
}
