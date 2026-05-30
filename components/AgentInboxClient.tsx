"use client";

import { useEffect, useMemo, useState } from "react";

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

function formatPrice(value?: string) {
  if (!value) return "Blank";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return `$${numeric.toLocaleString()}`;
}

function displayValue(value?: string) {
  return value && value !== "None" ? value : "Blank";
}

const corePropertyFields = [
  "price",
  "beds",
  "baths",
  "photo_url",
  "sqft",
  "year_built",
  "city",
  "state",
  "zip",
  "property_type",
];

function missingPropertyFields(property: SheetRow) {
  return corePropertyFields.filter((field) => !property[field] || property[field] === "None");
}

function propertyLabel(property: SheetRow) {
  const location = [property.city, property.state, property.zip].filter(Boolean).join(", ");
  return location ? `${property.address || "Untitled property"} · ${location}` : property.address || "Untitled property";
}

function PropertyPhoto({ property, large = false }: { property: SheetRow; large?: boolean }) {
  const photoUrl = property.photo_url;
  if (!photoUrl) {
    return <div className={large ? "property-photo missing large" : "property-photo missing"}>No photo</div>;
  }
  return (
    <img
      alt={`${property.address || "Property"} photo`}
      className={large ? "property-photo large" : "property-photo"}
      loading="lazy"
      src={photoUrl}
    />
  );
}

function PropertyTable({
  properties,
  selectedIndex,
  onSelect,
  onOpenCard,
}: {
  properties: SheetRow[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpenCard: (index: number) => void;
}) {
  if (!properties.length) {
    return <div className="empty">No property rows loaded</div>;
  }

  return (
    <div className="property-table-wrap">
      <table className="property-table">
        <thead>
          <tr>
            <th>Address</th>
            <th>Price</th>
            <th>Beds</th>
            <th>Baths</th>
            <th>Photo</th>
            <th>Sqft</th>
            <th>Year</th>
            <th>Status</th>
            <th>City</th>
            <th>Zip</th>
            <th>Type</th>
            <th>Days</th>
            <th>Agent</th>
            <th>Missing</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((property, index) => {
            const missing = missingPropertyFields(property);
            return (
              <tr
                className={selectedIndex === index ? "active" : ""}
                key={`${property.address || "property"}-${index}`}
                aria-label={`Open mobile card for ${property.address || "property"}`}
                onClick={() => {
                  onSelect(index);
                  onOpenCard(index);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(index);
                    onOpenCard(index);
                  }
                }}
                onMouseDown={() => onSelect(index)}
                tabIndex={0}
              >
                <td className="property-address">
                  <strong>{property.address || "Blank address"}</strong>
                  <span>{property.neighborhood || property.description || ""}</span>
                </td>
                <td>{formatPrice(property.price)}</td>
                <td>{displayValue(property.beds)}</td>
                <td>{displayValue(property.baths)}</td>
                <td><PropertyPhoto property={property} /></td>
                <td>{displayValue(property.sqft)}</td>
                <td>{displayValue(property.year_built)}</td>
                <td><span className="status">{property.status || "sheet"}</span></td>
                <td>{displayValue(property.city)}</td>
                <td>{displayValue(property.zip)}</td>
                <td>{displayValue(property.property_type)}</td>
                <td>{displayValue(property.days_on_market)}</td>
                <td>{displayValue(property.agent_name)}</td>
                <td>
                  <span className={missing.length ? "missing-pill" : "complete-pill"}>
                    {missing.length ? `${missing.length} missing` : "complete"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function propertyFeatureList(property: SheetRow) {
  return (property.features || "")
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function PropertyMobileCard({
  property,
  onClose,
}: {
  property: SheetRow;
  onClose: () => void;
}) {
  const features = propertyFeatureList(property);
  const location = [property.city, property.state, property.zip].filter(Boolean).join(", ");

  return (
    <div className="property-card-stage" role="dialog" aria-modal="true" aria-label="Property mobile card preview">
      <button className="property-card-scrim" onClick={onClose} aria-label="Close property card preview" />
      <section className="property-phone" aria-label={property.address || "Property preview"}>
        <div className="phone-bar">
          <span>9:41</span>
          <span className="phone-notch" />
          <span>Agent OS</span>
        </div>
        <div className="phone-card">
          <div className="phone-hero">
            <PropertyPhoto property={property} large />
            <button className="phone-close" onClick={onClose}>Close</button>
            <div className="phone-hero-copy">
              <span>{property.status || "Sheet listing"}</span>
              <strong>{formatPrice(property.price)}</strong>
            </div>
          </div>

          <div className="phone-content">
            <div className="phone-facts" aria-label="Property facts">
              <div><strong>{displayValue(property.beds)}</strong><span>beds</span></div>
              <div><strong>{displayValue(property.baths)}</strong><span>baths</span></div>
              <div><strong>{displayValue(property.sqft)}</strong><span>sqft</span></div>
            </div>

            <div className="phone-address">
              <h3>{property.address || "Untitled property"}</h3>
              <p>{location || displayValue(property.neighborhood)}</p>
            </div>

            <div className="phone-meta-grid">
              <div>
                <span>Type</span>
                <strong>{displayValue(property.property_type)}</strong>
              </div>
              <div>
                <span>Built</span>
                <strong>{displayValue(property.year_built)}</strong>
              </div>
              <div>
                <span>Market</span>
                <strong>{displayValue(property.days_on_market)} days</strong>
              </div>
              <div>
                <span>Area</span>
                <strong>{displayValue(property.neighborhood)}</strong>
              </div>
            </div>

            <p className="phone-description">{displayValue(property.description)}</p>

            {features.length ? (
              <div className="phone-features">
                {features.map((feature) => <span key={feature}>{feature}</span>)}
              </div>
            ) : null}

            <div className="phone-actions">
              {property.listing_url ? <a href={property.listing_url} rel="noreferrer" target="_blank">View listing</a> : null}
              {property.photo_url ? <a href={property.photo_url} rel="noreferrer" target="_blank">Open image</a> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PropertyDetail({ property }: { property: SheetRow }) {
  if (!Object.keys(property).length) {
    return (
      <aside className="panel property-detail-panel">
        <div className="empty">Select a property row</div>
      </aside>
    );
  }

  const missing = missingPropertyFields(property);
  const details = [
    ["Price", formatPrice(property.price)],
    ["Beds / baths", `${displayValue(property.beds)} bd / ${displayValue(property.baths)} bth`],
    ["Sqft", displayValue(property.sqft)],
    ["Year built", displayValue(property.year_built)],
    ["Type", displayValue(property.property_type)],
    ["Neighborhood", displayValue(property.neighborhood)],
    ["Days on market", displayValue(property.days_on_market)],
    ["Agent", displayValue(property.agent_name)],
  ];

  return (
    <aside className="panel property-detail-panel">
      <div className="property-detail-media">
        <PropertyPhoto property={property} large />
      </div>
      <div className="property-detail-body">
        <span className="eyebrow">Selected property</span>
        <h3>{propertyLabel(property)}</h3>
        <div className="property-detail-grid">
          {details.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <div className="property-copy-block">
          <span>Description</span>
          <p>{displayValue(property.description)}</p>
        </div>
        <div className="property-copy-block">
          <span>Features</span>
          <p>{displayValue(property.features)}</p>
        </div>

        <div className="property-link-row">
          {property.listing_url ? <a href={property.listing_url} rel="noreferrer" target="_blank">Listing</a> : null}
          {property.photo_url ? <a href={property.photo_url} rel="noreferrer" target="_blank">Photo URL</a> : null}
        </div>

        <div className="missing-block">
          <span>Missing fields</span>
          {missing.length ? (
            <div className="missing-list">
              {missing.map((field) => <em key={field}>{field}</em>)}
            </div>
          ) : (
            <strong>Core data complete</strong>
          )}
        </div>
      </div>
    </aside>
  );
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
  const [selectedPropertyIndex, setSelectedPropertyIndex] = useState(0);
  const [mobileCardIndex, setMobileCardIndex] = useState<number | null>(null);
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
  const safeSelectedPropertyIndex = Math.min(selectedPropertyIndex, Math.max(data.properties.length - 1, 0));
  const selectedProperty = data.properties[safeSelectedPropertyIndex] || {};
  const mobileCardProperty = mobileCardIndex == null ? null : data.properties[mobileCardIndex] || null;

  useEffect(() => {
    if (mobileCardIndex == null) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileCardIndex(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileCardIndex]);

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
                <h2 className="panel-title">Property Sheet</h2>
                <span className="status">{data.propertyHealth.total} rows</span>
              </div>
              <PropertyTable
                onOpenCard={setMobileCardIndex}
                onSelect={setSelectedPropertyIndex}
                properties={data.properties}
                selectedIndex={safeSelectedPropertyIndex}
              />
            </section>
            <PropertyDetail property={selectedProperty} />
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
      {mobileCardProperty ? (
        <PropertyMobileCard property={mobileCardProperty} onClose={() => setMobileCardIndex(null)} />
      ) : null}
    </div>
  );
}
