"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/inbox/EmptyState";
import { Sidebar } from "@/components/inbox/Sidebar";
import { StatusDot } from "@/components/inbox/StatusDot";
import { SyncIndicator } from "@/components/inbox/SyncIndicator";
import {
  PreviewIcon,
  PropertyPhoto,
  PropertyTable,
  type PropertySort,
  type PropertySortKey,
} from "@/components/inbox/PropertyTable";
import { type AgentInboxData, type Channel, parseVoiceTranscript, voiceCallTranscriptSource } from "@/lib/inboxData";
import { displayValue, formatPrice, missingPropertyFields } from "@/lib/format";
import {
  inboxImagePreviewUrl,
  isDisplayableImageUrl,
  rewriteEmailHtmlForInbox,
  unwrapMediaProxyUrl,
} from "@/lib/mediaProxy";
import type { SheetRow } from "@/lib/sheetSchema";

type View = "overview" | "email" | "sms" | "whatsapp" | "voice" | "website_chat" | "properties";

const DASHBOARD_REFRESH_MS = 5000;

const channelViews: { key: View; label: string; agent: string; avatar: string; channel?: Channel }[] = [
  { key: "email", label: "Email", agent: "Iris", avatar: "/images/agents/iris.png", channel: "email" },
  { key: "sms", label: "SMS", agent: "Theo", avatar: "/images/agents/theo.png", channel: "sms" },
  { key: "whatsapp", label: "WhatsApp", agent: "Theo", avatar: "/images/agents/theo.png", channel: "whatsapp" },
  { key: "voice", label: "Voice", agent: "Aria", avatar: "/images/agents/aria.png", channel: "voice" },
  { key: "website_chat", label: "Website", agent: "Olivia", avatar: "/images/agents/olivia.png", channel: "website_chat" },
];

function eventText(event: SheetRow) {
  return event.message_text || event.summary || event.ai_action || "";
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function extractUrls(value: string) {
  return Array.from(new Set(value.match(/https?:\/\/[^\s<>"')]+/gi) || []));
}

function EmailRenderedHtml({ html, properties }: { html: string; properties: SheetRow[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const preparedHtml = useMemo(
    () => rewriteEmailHtmlForInbox(html, properties),
    [html, properties],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll("img").forEach((img) => {
      img.onerror = () => {
        img.classList.add("image-load-failed");
        img.removeAttribute("src");
      };
    });
  }, [preparedHtml]);

  return (
    <div
      ref={rootRef}
      className="email-rendered"
      dangerouslySetInnerHTML={{ __html: preparedHtml }}
    />
  );
}

function MessageContent({ event, properties }: { event: SheetRow; properties: SheetRow[] }) {
  const text = eventText(event);
  if (!text) {
    return <div className="message-text empty-message">No message text recorded</div>;
  }

  if (looksLikeHtml(text)) {
    return <EmailRenderedHtml html={text} properties={properties} />;
  }

  const imageUrls = extractUrls(text).filter(isDisplayableImageUrl);
  return (
    <div className="message-content">
      <div className="message-text">{text}</div>
      {imageUrls.length ? (
        <div className="message-images" aria-label="Images mentioned in message">
          {imageUrls.map((url) => (
            <a className="message-image-link" href={unwrapMediaProxyUrl(url)} key={url} rel="noreferrer" target="_blank">
              <img
                alt="Message attachment preview"
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.closest(".message-image-link")?.classList.add("image-load-failed");
                }}
                src={inboxImagePreviewUrl(url)}
              />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function eventChannel(event: SheetRow) {
  return (event.channel || "unknown").toLowerCase();
}

function latestEvent(events: SheetRow[]) {
  return events[events.length - 1] || {};
}

function eventTimeValue(event: SheetRow) {
  const parsed = new Date(event.event_at || "");
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatEventTime(value?: string) {
  if (!value) return "No timestamp";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function directionCount(events: SheetRow[], direction: string) {
  return events.filter((event) => event.direction === direction).length;
}

function statusText(value?: string) {
  return value ? value.replaceAll("_", " ") : "waiting";
}

function eventNeedsHuman(event: SheetRow) {
  return (
    event.status === "needs_human" ||
    event.event_type === "sms_handoff_reply" ||
    event.ai_action === "handoff_reply_ready" ||
    Boolean(event.handoff_reason)
  );
}

function threadNeedsHuman(events: SheetRow[]) {
  return events.some(eventNeedsHuman);
}

function threadHandoffReason(events: SheetRow[]) {
  return [...events].reverse().find((event) => event.handoff_reason)?.handoff_reason || "Review before continuing.";
}

function humanReviewThreads(threads: [string, SheetRow[]][]) {
  return threads.filter(([, events]) => threadNeedsHuman(events));
}

function conversationKey(event: SheetRow, channel?: Channel | string) {
  const normalizedChannel = channel || eventChannel(event);
  if (["sms", "whatsapp", "voice"].includes(normalizedChannel)) {
    return event.phone || event.thread_ref || event.email || "unknown";
  }
  if (normalizedChannel === "email") {
    return event.email || event.thread_ref || event.phone || "unknown";
  }
  return event.email || event.phone || event.thread_ref || event.full_name || "unknown";
}

function buildChannelThreads(events: SheetRow[], channel: Channel): [string, SheetRow[]][] {
  const groups = events
    .filter((event) => eventChannel(event) === channel)
    .reduce<Record<string, SheetRow[]>>((acc, event) => {
      const key = conversationKey(event, channel);
      acc[key] ||= [];
      acc[key].push(event);
      return acc;
    }, {});
  return sortThreadEntries(Object.entries(groups));
}

function sortThreadEntries(entries: [string, SheetRow[]][]) {
  return [...entries].sort((a, b) => eventTimeValue(latestEvent(b[1])) - eventTimeValue(latestEvent(a[1])));
}

function threadIdentity(threadRef: string, events: SheetRow[], channel?: Channel) {
  const latest = latestEvent(events);
  if (channel === "email") return latest.email || threadRef;
  if (["sms", "whatsapp", "voice"].includes(channel || "")) return latest.phone || threadRef;
  return latest.email || latest.phone || latest.full_name || threadRef;
}

function threadSubtitle(threadRef: string, events: SheetRow[], channel?: Channel) {
  const latest = latestEvent(events);
  if (channel === "email") return latest.thread_ref || latest.source || threadRef;
  if (["sms", "whatsapp", "voice"].includes(channel || "")) return latest.thread_ref || threadRef;
  return latest.source || latest.thread_ref || "";
}

function threadSearchText(threadRef: string, events: SheetRow[], channel?: Channel) {
  return [
    threadRef,
    threadIdentity(threadRef, events, channel),
    threadSubtitle(threadRef, events, channel),
    ...events.flatMap((event) => [
      event.email,
      event.phone,
      event.full_name,
      event.thread_ref,
      event.summary,
      eventText(event),
    ]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function threadSearchPlaceholder(channelLabel: string, channel?: Channel) {
  if (channel === "sms" || channel === "whatsapp" || channel === "voice") {
    return `Search ${channelLabel.toLowerCase()} by phone number`;
  }
  if (channel === "email") return "Search email conversations by email";
  return `Search ${channelLabel.toLowerCase()} conversations`;
}

function voiceCallKey(call: SheetRow) {
  return call.phone || call.thread_ref || call.call_id || "voice:unknown";
}

function buildVoiceCallThreads(calls: SheetRow[]): [string, SheetRow[]][] {
  const groups = calls.reduce<Record<string, SheetRow[]>>((acc, call) => {
    const key = voiceCallKey(call);
    acc[key] ||= [];
    acc[key].push(call);
    return acc;
  }, {});
  return [...Object.entries(groups)].sort((a, b) => {
    const latestA = latestVoiceCall(a[1]);
    const latestB = latestVoiceCall(b[1]);
    return voiceCallTimeValue(latestB) - voiceCallTimeValue(latestA);
  });
}

function latestVoiceCall(calls: SheetRow[]) {
  return calls[calls.length - 1] || {};
}

function voiceCallTimeValue(call: SheetRow) {
  const parsed = new Date(call.ended_at || call.started_at || "");
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function voiceThreadIdentity(threadRef: string, calls: SheetRow[]) {
  const latest = latestVoiceCall(calls);
  return latest.phone || latest.full_name || threadRef;
}

function voiceThreadSubtitle(threadRef: string, calls: SheetRow[]) {
  const latest = latestVoiceCall(calls);
  const count = calls.length === 1 ? "1 call" : `${calls.length} calls`;
  return [count, latest.ended_reason || latest.disposition || latest.thread_ref || threadRef].filter(Boolean).join(" · ");
}

function voiceThreadSearchText(threadRef: string, calls: SheetRow[]) {
  return [
    threadRef,
    voiceThreadIdentity(threadRef, calls),
    voiceThreadSubtitle(threadRef, calls),
    ...calls.flatMap((call) => [
      call.phone,
      call.full_name,
      call.summary,
      call.transcript,
      call.recording_url,
    ]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function recordingAudioUrl(value?: string) {
  const url = (value || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/media/audio") return url;
    return `/api/media/audio?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

function formatCallDuration(value?: string) {
  const seconds = Math.max(0, Math.round(Number(value || 0)));
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function messageSpeaker(event: SheetRow) {
  if (event.direction === "outbound") return event.agent_name || "AI";
  return event.full_name || event.email || event.phone || "Lead";
}

function numericSortValue(value?: string) {
  const numeric = Number(String(value || "").replace(/[$,]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function propertySortValue(property: SheetRow, index: number, key: PropertySortKey) {
  if (key === "source_order") return index;
  if (["price", "beds", "baths", "sqft"].includes(key)) {
    return numericSortValue(property[key]) ?? Number.NEGATIVE_INFINITY;
  }
  return (property[key] || "").toLowerCase();
}

function sortProperties(properties: SheetRow[], sort: PropertySort) {
  return properties
    .map((property, index) => ({ property, index }))
    .sort((left, right) => {
      const a = propertySortValue(left.property, left.index, sort.key);
      const b = propertySortValue(right.property, right.index, sort.key);
      let comparison = 0;
      if (typeof a === "number" && typeof b === "number") {
        comparison = a - b;
      } else {
        comparison = String(a).localeCompare(String(b));
      }
      if (comparison === 0) {
        comparison = (left.property.address || "").localeCompare(right.property.address || "");
      }
      return sort.direction === "asc" ? comparison : comparison * -1;
    })
    .map(({ property }) => property);
}

function normalizePropertySearch(value: string) {
  return value.toLowerCase().replace(/[$,]/g, " ").replace(/\s+/g, " ").trim();
}

function propertySearchText(property: SheetRow) {
  return [
    property.address,
    property.city,
    property.state,
    property.zip,
    property.neighborhood,
    property.property_type,
    property.features,
    property.description,
    property.status || "sheet",
    property.agent_name,
    property.agent_email,
    property.listing_url,
    property.price,
    property.price ? formatPrice(property.price) : "",
    property.beds ? `${property.beds} bed beds bd ${property.beds}bd` : "",
    property.baths ? `${property.baths} bath baths bth ba ${property.baths}ba` : "",
    property.sqft ? `${property.sqft} sqft square feet ${property.sqft}sqft` : "",
    property.year_built,
  ].filter(Boolean).map(String).join(" ");
}

function filterProperties(properties: SheetRow[], search: string) {
  const query = normalizePropertySearch(search);
  if (!query) return properties;
  const tokens = query.split(" ").filter(Boolean);
  return properties.filter((property) => {
    const haystack = normalizePropertySearch(propertySearchText(property));
    return tokens.every((token) => haystack.includes(token));
  });
}

function sortLabel(sort: PropertySort) {
  if (sort.key === "source_order") return "Sheet order";
  return `${sort.key} ${sort.direction}`;
}

function propertyLabel(property: SheetRow) {
  const location = [property.city, property.state, property.zip].filter(Boolean).join(", ");
  return location ? `${property.address || "Untitled property"} · ${location}` : property.address || "Untitled property";
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

function PropertyDetail({ property, onOpenCard }: { property: SheetRow; onOpenCard: () => void }) {
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
        <button className="property-detail-preview" onClick={onOpenCard} type="button">
          <PropertyPhoto property={property} large />
          <span><PreviewIcon /> Mobile preview</span>
        </button>
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

function TableRows({
  events,
  emptyLabel = "No conversations yet",
  onOpenEvent,
}: {
  events: SheetRow[];
  emptyLabel?: string;
  onOpenEvent?: (event: SheetRow) => void;
}) {
  if (!events.length) {
    return <div className="empty">{emptyLabel}</div>;
  }
  return (
    <div className="row-stack">
      {events.slice(-12).reverse().map((event, index) => {
        const rowContent = (
          <>
            <div className="row-title">{event.email || event.phone || event.thread_ref || "Unknown lead"}</div>
            <div className="row-body">{event.summary || eventText(event)}</div>
            <div className="row-meta">
              <StatusDot status={eventNeedsHuman(event) ? "needs_human" : (event.status || event.event_type || event.direction || "")} />
              <time>{formatEventTime(event.event_at)}</time>
            </div>
          </>
        );
        if (onOpenEvent) {
          return (
            <button
              className="table-row activity-row"
              key={`${event.thread_ref}-${event.event_at}-${index}`}
              onClick={() => onOpenEvent(event)}
              type="button"
            >
              {rowContent}
            </button>
          );
        }
        return (
          <div className="table-row" key={`${event.thread_ref}-${event.event_at}-${index}`}>
            {rowContent}
          </div>
        );
      })}
    </div>
  );
}

function ConversationThread({
  threadRef,
  events,
  channelLabel,
  channel,
  properties,
}: {
  threadRef: string;
  events: SheetRow[];
  channelLabel: string;
  channel?: Channel;
  properties: SheetRow[];
}) {
  const latest = latestEvent(events);
  const needsHuman = threadNeedsHuman(events);
  return (
    <article className={needsHuman ? "thread selected-thread needs-human" : "thread selected-thread"} key={threadRef}>
      <div className="thread-head">
        <div>
          <strong>{threadIdentity(threadRef, events, channel)}</strong>
          <div className="brand-subtitle">{threadSubtitle(threadRef, events, channel)}</div>
        </div>
        <div className="thread-status-stack">
          <StatusDot status={needsHuman ? "needs_human" : (latest.status || latest.event_type || "active")} />
        </div>
      </div>
      {needsHuman ? (
        <div className="handoff-note">
          <strong>Human review reason</strong>
          <span>{threadHandoffReason(events)}</span>
        </div>
      ) : null}
      <div className="thread-messages" aria-label={`${channelLabel} messages for ${threadIdentity(threadRef, events, channel)}`}>
        {events.map((event, index) => (
          <div
            className={`message ${event.direction === "outbound" ? "outbound" : "inbound"}`}
            key={`${event.event_at}-${index}`}
          >
            <div className="message-meta">
              <span>{messageSpeaker(event)} {event.direction === "outbound" ? "sent" : "received"}</span>
              <span>{formatEventTime(event.event_at)}</span>
            </div>
            <MessageContent event={event} properties={properties} />
            {event.handoff_reason ? (
              <div className="message-handoff">
                <strong>Flag</strong>
                <span>{event.handoff_reason}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function ThreadViewer({
  threads,
  channelLabel,
  channel,
  search,
  selectedThreadKey,
  onSearchChange,
  onSelectThread,
  properties,
}: {
  threads: [string, SheetRow[]][];
  channelLabel: string;
  channel?: Channel;
  search: string;
  selectedThreadKey: string;
  onSearchChange: (value: string) => void;
  onSelectThread: (threadRef: string) => void;
  properties: SheetRow[];
}) {
  if (!threads.length) {
    return (
      <div className="empty-state">
        <EmptyState channel={channel ?? "email"} label={`No ${channelLabel.toLowerCase()} conversations yet`} />
        <span>Connected webhooks will appear here as live conversation threads.</span>
      </div>
    );
  }
  const normalizedSearch = search.trim().toLowerCase();
  const visibleThreads = threads.filter(([threadRef, events]) => {
    if (!normalizedSearch) return true;
    return threadSearchText(threadRef, events, channel).includes(normalizedSearch);
  });
  const activeThread = visibleThreads.find(([threadRef]) => threadRef === selectedThreadKey) || visibleThreads[0];

  return (
    <div className="conversation-inbox">
      <aside className="conversation-list-column" aria-label={`${channelLabel} conversations`}>
        <div className="conversation-list-header">
          <strong>Conversations</strong>
          <span>{visibleThreads.length} shown</span>
        </div>
        <input
          aria-label={`Search ${channelLabel} conversations`}
          className="conversation-search"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={threadSearchPlaceholder(channelLabel, channel)}
          type="search"
          value={search}
        />
        <div className="conversation-list">
          {visibleThreads.length ? visibleThreads.map(([threadRef, events]) => {
            const latest = latestEvent(events);
            const active = activeThread?.[0] === threadRef;
            const needsHuman = threadNeedsHuman(events);
            return (
              <button
                className={active ? "conversation-list-item active" : "conversation-list-item"}
                data-unread={needsHuman ? "true" : "false"}
                key={threadRef}
                onClick={() => onSelectThread(threadRef)}
                type="button"
              >
                <span className="conversation-row-top">
                  <strong>{threadIdentity(threadRef, events, channel)}</strong>
                  <time>{formatEventTime(latest.event_at)}</time>
                </span>
                <span className="conversation-preview">{latest.summary || eventText(latest)}</span>
                <span className="conversation-row-bottom">
                  <em>{events.length} messages</em>
                  {needsHuman ? <StatusDot status="needs_human" /> : null}
                </span>
              </button>
            );
          }) : (
            <div className="conversation-empty">
              No matching {channelLabel.toLowerCase()} conversations.
            </div>
          )}
        </div>
      </aside>
      <section className="conversation-thread-column">
        {activeThread ? (
          <ConversationThread
            channel={channel}
            channelLabel={channelLabel}
            events={activeThread[1]}
            properties={properties}
            threadRef={activeThread[0]}
          />
        ) : (
          <div className="empty-state thread-viewer-empty">
            <EmptyState channel={channel ?? "email"} label="No conversation selected" />
            <span>Select a conversation from the list.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function VoiceCallCard({ call }: { call: SheetRow }) {
  const transcript = voiceCallTranscriptSource(call);
  const turns = parseVoiceTranscript(transcript);
  const audioUrl = recordingAudioUrl(call.recording_url);
  return (
    <section className="voice-call-card">
      <div className="voice-call-card-head">
        <div>
          <strong>{formatEventTime(call.ended_at || call.started_at)}</strong>
          <span>{[formatCallDuration(call.duration_sec), call.ended_reason || call.disposition].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="status">{call.agent_name || "Aria"}</span>
      </div>
      <div className="thread-messages voice-transcript" aria-label="Voice call transcript">
        {turns.length ? turns.map((turn, index) => (
          <div className={`message ${turn.direction === "outbound" ? "outbound" : "inbound"}`} key={`${call.call_id}-${index}`}>
            <div className="message-meta">
              <span>{turn.speaker}</span>
            </div>
            <div className="message-content">
              <div className="message-text voice-message-text">{turn.text || "No transcript text recorded for this turn."}</div>
            </div>
          </div>
        )) : (
          <div className="empty-state voice-empty">
            <strong>No transcript text recorded</strong>
            <span>The call report is still available below.</span>
          </div>
        )}
      </div>
      <div className="voice-call-report">
        <strong>Call report</strong>
        <p>{call.summary || "No call summary recorded yet."}</p>
        {transcript ? (
          <details className="voice-raw-transcript">
            <summary>Raw transcript</summary>
            <pre>{transcript}</pre>
          </details>
        ) : null}
        {call.recording_url ? (
          <div className="voice-recording">
            <span>Recording</span>
            <audio controls preload="metadata" src={audioUrl}>
              <a href={call.recording_url} rel="noreferrer" target="_blank">Open recording</a>
            </audio>
            <a href={call.recording_url} rel="noreferrer" target="_blank">Open recording</a>
          </div>
        ) : (
          <span className="brand-subtitle">No recording URL loaded for this call.</span>
        )}
      </div>
    </section>
  );
}

function VoiceThreadViewer({
  threads,
  search,
  selectedThreadKey,
  onSearchChange,
  onSelectThread,
}: {
  threads: [string, SheetRow[]][];
  search: string;
  selectedThreadKey: string;
  onSearchChange: (value: string) => void;
  onSelectThread: (threadRef: string) => void;
}) {
  if (!threads.length) {
    return (
      <div className="empty-state">
        <EmptyState channel="voice" label="No voice conversations yet" />
        <span>Completed Vapi call transcripts and recordings will appear here.</span>
      </div>
    );
  }

  const normalizedSearch = search.trim().toLowerCase();
  const visibleThreads = threads.filter(([threadRef, calls]) => {
    if (!normalizedSearch) return true;
    return voiceThreadSearchText(threadRef, calls).includes(normalizedSearch);
  });
  const activeThread = visibleThreads.find(([threadRef]) => threadRef === selectedThreadKey) || visibleThreads[0];

  return (
    <div className="conversation-inbox">
      <aside className="conversation-list-column" aria-label="Voice conversations">
        <div className="conversation-list-header">
          <strong>Conversations</strong>
          <span>{visibleThreads.length} shown</span>
        </div>
        <input
          aria-label="Search voice conversations"
          className="conversation-search"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search voice by phone number"
          type="search"
          value={search}
        />
        <div className="conversation-list">
          {visibleThreads.length ? visibleThreads.map(([threadRef, calls]) => {
            const latest = latestVoiceCall(calls);
            const active = activeThread?.[0] === threadRef;
            return (
              <button
                className={active ? "conversation-list-item active" : "conversation-list-item"}
                key={threadRef}
                onClick={() => onSelectThread(threadRef)}
                type="button"
              >
                <span className="conversation-row-top">
                  <strong>{voiceThreadIdentity(threadRef, calls)}</strong>
                  <time>{formatEventTime(latest.ended_at || latest.started_at)}</time>
                </span>
                <span className="conversation-preview">{latest.summary || "Voice call transcript"}</span>
                <span className="conversation-row-bottom">
                  <em>{calls.length} call{calls.length === 1 ? "" : "s"}</em>
                  {latest.recording_url ? <span className="status mini-status">Recording</span> : null}
                </span>
              </button>
            );
          }) : (
            <div className="conversation-empty">No matching voice conversations.</div>
          )}
        </div>
      </aside>
      <section className="conversation-thread-column">
        {activeThread ? (
          <article className="thread selected-thread voice-thread" key={activeThread[0]}>
            <div className="thread-head">
              <div>
                <strong>{voiceThreadIdentity(activeThread[0], activeThread[1])}</strong>
                <div className="brand-subtitle">{voiceThreadSubtitle(activeThread[0], activeThread[1])}</div>
              </div>
              <span className="status">call transcript</span>
            </div>
            <div className="voice-call-stack">
              {activeThread[1].map((call) => <VoiceCallCard call={call} key={call.call_id || call.thread_ref || call.started_at} />)}
            </div>
          </article>
        ) : (
          <div className="empty-state thread-viewer-empty">
            <EmptyState channel="voice" label="No voice conversation selected" />
            <span>Select a caller from the list.</span>
          </div>
        )}
      </section>
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

function ContextRail({
  currentEvents,
  latest,
  selectedChannelLabel,
  selectedChannel,
  activeThreads,
  propertyHealthScore,
  propertiesNeedingReview,
}: {
  currentEvents: SheetRow[];
  latest: SheetRow;
  selectedChannelLabel: string;
  selectedChannel?: Channel;
  activeThreads: number;
  propertyHealthScore: number;
  propertiesNeedingReview: number;
}) {
  const inbound = directionCount(currentEvents, "inbound");
  const outbound = directionCount(currentEvents, "outbound");
  const label = selectedChannel ? selectedChannelLabel : "All channels";
  const latestIdentity = latest.email || latest.phone || latest.full_name || "No lead selected";
  const reviewEvents = currentEvents.filter(eventNeedsHuman).slice(-5).reverse();

  return (
    <aside className="context-rail" aria-label="Conversation context">
      <section className="context-card">
        <span className="rail-label">Watching</span>
        <h2>{label}</h2>
        <div className="rail-metric-grid">
          <div>
            <strong>{currentEvents.length}</strong>
            <span>events</span>
          </div>
          <div>
            <strong>{activeThreads}</strong>
            <span>threads</span>
          </div>
        </div>
      </section>

      <section className="context-card">
        <span className="rail-label">Last activity</span>
        <h3>{latestIdentity}</h3>
        <p>{latest.summary || latest.ai_action || latest.event_type || "No conversation activity loaded yet."}</p>
        <dl className="rail-facts">
          <div>
            <dt>Status</dt>
            <dd>{statusText(latest.status || latest.event_type)}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>{formatEventTime(latest.event_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="context-card human-review-card">
        <span className="rail-label">Human review</span>
        <h3>{reviewEvents.length ? `${reviewEvents.length} flagged` : "Clear"}</h3>
        {reviewEvents.length ? (
          <div className="review-stack">
            {reviewEvents.map((event, index) => (
              <div className="review-item" key={`${event.thread_ref}-${event.event_at}-${index}`}>
                <strong>{event.phone || event.email || event.thread_ref || "Unknown lead"}</strong>
                <span>{event.handoff_reason || event.summary || "Review this conversation."}</span>
              </div>
            ))}
          </div>
        ) : (
          <p>No handoffs in this view.</p>
        )}
      </section>

      <section className="context-card">
        <span className="rail-label">Flow balance</span>
        <div className="flow-balance" aria-label={`${inbound} inbound and ${outbound} outbound messages`}>
          <span style={{ width: `${currentEvents.length ? Math.max(12, (inbound / currentEvents.length) * 100) : 0}%` }} />
          <span style={{ width: `${currentEvents.length ? Math.max(12, (outbound / currentEvents.length) * 100) : 0}%` }} />
        </div>
        <dl className="rail-facts compact">
          <div>
            <dt>Inbound</dt>
            <dd>{inbound}</dd>
          </div>
          <div>
            <dt>AI replies</dt>
            <dd>{outbound}</dd>
          </div>
        </dl>
      </section>

      <section className="context-card">
        <span className="rail-label">Data readiness</span>
        <div className="readiness-ring" style={{ ["--score" as string]: `${propertyHealthScore}%` }}>
          <strong>{propertyHealthScore}</strong>
          <span>property health</span>
        </div>
        <p>{propertiesNeedingReview ? `${propertiesNeedingReview} property rows still need review.` : "Property rows are ready for agent use."}</p>
      </section>
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
  initialRefreshedAt = "",
  loadError = "",
  sourceLabel = "Google Sheets",
}: {
  data: AgentInboxData;
  initialRefreshedAt?: string;
  loadError?: string;
  sourceLabel?: string;
}) {
  const [dashboardData, setDashboardData] = useState<AgentInboxData>(data);
  const [refreshError, setRefreshError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(initialRefreshedAt);
  const [view, setView] = useState<View>("overview");
  const [selectedPropertyIndex, setSelectedPropertyIndex] = useState(0);
  const [mobileCardIndex, setMobileCardIndex] = useState<number | null>(null);
  const [propertySort, setPropertySort] = useState<PropertySort>({ key: "source_order", direction: "asc" });
  const [showPropertyReviewOnly, setShowPropertyReviewOnly] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const [selectedThreadKey, setSelectedThreadKey] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const effectiveLoadError = loadError || refreshError;
  const threadEntries = useMemo(() => Object.entries(dashboardData.threads), [dashboardData.threads]);
  const selectedChannel = channelViews.find((channel) => channel.key === view)?.channel;
  const selectedChannelLabel = channelViews.find((channel) => channel.channel === selectedChannel)?.label || "Channel";
  const channelThreads = useMemo(
    () => selectedChannel ? buildChannelThreads(dashboardData.events, selectedChannel) : [],
    [dashboardData.events, selectedChannel],
  );
  const voiceCallThreads = useMemo(
    () => buildVoiceCallThreads(dashboardData.voiceCalls || []),
    [dashboardData.voiceCalls],
  );
  const visibleChannelThreads = selectedChannel === "voice" ? voiceCallThreads : channelThreads;
  const selectedHumanThreads = selectedChannel ? humanReviewThreads(selectedChannel === "voice" ? [] : channelThreads) : humanReviewThreads(threadEntries);
  const currentEvents = selectedChannel
    ? dashboardData.events.filter((event) => eventChannel(event) === selectedChannel)
    : dashboardData.events;
  const propertyHealthScore = dashboardData.propertyHealth.total
    ? Math.max(0, Math.round(((dashboardData.propertyHealth.total - dashboardData.propertyHealth.missing_core) / dashboardData.propertyHealth.total) * 100))
    : 0;
  const activeThreads = threadEntries.length;
  const latestCurrentEvent = latestEvent(currentEvents);
  const sortedProperties = useMemo(
    () => sortProperties(dashboardData.properties, propertySort),
    [dashboardData.properties, propertySort],
  );
  const reviewProperties = useMemo(
    () => sortedProperties.filter((property) => missingPropertyFields(property).length),
    [sortedProperties],
  );
  const propertyBaseRows = showPropertyReviewOnly && reviewProperties.length ? reviewProperties : sortedProperties;
  const visibleProperties = useMemo(
    () => filterProperties(propertyBaseRows, propertySearch),
    [propertyBaseRows, propertySearch],
  );
  const safeSelectedPropertyIndex = Math.min(selectedPropertyIndex, Math.max(visibleProperties.length - 1, 0));
  const selectedProperty = visibleProperties[safeSelectedPropertyIndex] || {};
  const mobileCardProperty = mobileCardIndex == null ? null : visibleProperties[mobileCardIndex] || null;

  useEffect(() => {
    setDashboardData(data);
    setLastRefreshedAt(new Date().toISOString());
  }, [data]);

  useEffect(() => {
    setThreadSearch("");
  }, [selectedChannel]);

  useEffect(() => {
    setSelectedPropertyIndex(0);
    setMobileCardIndex(null);
  }, [propertySearch, showPropertyReviewOnly]);

  useEffect(() => {
    if (!selectedChannel || !visibleChannelThreads.length) {
      return;
    }
    if (!visibleChannelThreads.some(([threadRef]) => threadRef === selectedThreadKey)) {
      setSelectedThreadKey(visibleChannelThreads[0][0]);
    }
  }, [visibleChannelThreads, selectedChannel, selectedThreadKey]);

  useEffect(() => {
    let cancelled = false;

    async function refreshData() {
      try {
        const response = await fetch(`/api/data?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Refresh failed with ${response.status}`);
        }
        const nextData = await response.json() as AgentInboxData;
        if (!cancelled) {
          setDashboardData(nextData);
          setRefreshError("");
          setLastRefreshedAt(new Date().toISOString());
        }
      } catch (error) {
        if (!cancelled) {
          setRefreshError(error instanceof Error ? error.message : "Refresh failed");
        }
      }
    }

    refreshData();
    const interval = window.setInterval(refreshData, DASHBOARD_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  function updatePropertySort(key: PropertySortKey) {
    setPropertySort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setSelectedPropertyIndex(0);
    setMobileCardIndex(null);
  }

  function openEventThread(event: SheetRow) {
    const channel = eventChannel(event) as Channel;
    const target = channelViews.find((item) => item.channel === channel);
    if (!target) {
      return;
    }
    setThreadSearch("");
    setSelectedThreadKey(conversationKey(event, channel));
    setView(target.key);
  }

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
      <Sidebar currentView={view} onViewChange={setView} data={dashboardData} />

      <main className="inbox-main">
        <header className="inbox-topbar">
          <span className="inbox-topbar-title">{selectedChannel ? selectedChannelLabel : viewTitle(view)}</span>
          <SyncIndicator lastUpdated={lastRefreshedAt || null} isLive={!effectiveLoadError} />
        </header>

        {effectiveLoadError ? (
          <section className="panel notice-panel">
            <div className="table-row">
              <div className="row-title">Data temporarily unavailable</div>
              <div className="row-body">{effectiveLoadError}</div>
              <div className="status">retry shortly</div>
            </div>
          </section>
        ) : null}

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
                  <strong>{dashboardData.propertyHealth.missing_core}</strong>
                </div>
                <div>
                  <span>Duplicate groups</span>
                  <strong>{dashboardData.propertyHealth.duplicate_groups}</strong>
                </div>
              </div>
            </section>
            <section className="panel property-panel">
              <div className="panel-header">
                <h2 className="panel-title">Property Sheet</h2>
                <div className="panel-actions">
                  <span className="status">
                    {showPropertyReviewOnly && reviewProperties.length && !propertySearch
                      ? `${reviewProperties.length} review rows`
                      : propertySearch || showPropertyReviewOnly
                        ? `${visibleProperties.length} shown`
                        : `${dashboardData.propertyHealth.total} rows`}
                  </span>
                  {showPropertyReviewOnly && reviewProperties.length ? (
                    <button className="filter-clear" onClick={() => setShowPropertyReviewOnly(false)} type="button">
                      Show all
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="property-toolbar">
                <label className="property-search">
                  <span>Search properties</span>
                  <input
                    aria-label="Search properties"
                    onChange={(event) => setPropertySearch(event.target.value)}
                    placeholder="Search address, city, zip, price, beds, features..."
                    type="search"
                    value={propertySearch}
                  />
                </label>
                <div className="property-toolbar-meta" aria-label="Property table controls">
                  <span>{visibleProperties.length} shown</span>
                  <span>Sort: {sortLabel(propertySort)}</span>
                  {propertySearch ? (
                    <button className="filter-clear" onClick={() => setPropertySearch("")} type="button">
                      Clear search
                    </button>
                  ) : null}
                </div>
              </div>
              <PropertyTable
                onOpenCard={setMobileCardIndex}
                onSelect={setSelectedPropertyIndex}
                onSort={updatePropertySort}
                properties={visibleProperties}
                sort={propertySort}
                selectedIndex={safeSelectedPropertyIndex}
              />
            </section>
            <PropertyDetail property={selectedProperty} onOpenCard={() => setMobileCardIndex(safeSelectedPropertyIndex)} />
          </div>
        ) : (
          <div className="workspace">
            <section className="panel conversation-panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">
                    {selectedChannel ? `${selectedChannelLabel} Threads` : "Recent Activity"}
                  </h2>
                  <p className="panel-kicker">{selectedChannel ? "Read the exact conversation as the AI handled it." : "Latest cross-channel activity from the shared event log."}</p>
                </div>
                <span className="status">{selectedChannel === "voice" ? `${dashboardData.voiceCalls?.length || 0} calls` : `${currentEvents.length} events`}</span>
              </div>
              {selectedHumanThreads.length ? (
                <div className="handoff-summary">
                  <strong>{selectedHumanThreads.length} thread{selectedHumanThreads.length === 1 ? "" : "s"} need human review</strong>
                  <span>Open the flagged thread before the AI continues beyond the handoff message.</span>
                </div>
              ) : null}
              {selectedChannel === "voice" ? (
                <VoiceThreadViewer
                  onSearchChange={setThreadSearch}
                  onSelectThread={setSelectedThreadKey}
                  search={threadSearch}
                  selectedThreadKey={selectedThreadKey}
                  threads={voiceCallThreads}
                />
              ) : selectedChannel ? (
                <ThreadViewer
                  channel={selectedChannel}
                  channelLabel={selectedChannelLabel}
                  onSearchChange={setThreadSearch}
                  onSelectThread={setSelectedThreadKey}
                  properties={dashboardData.properties}
                  search={threadSearch}
                  selectedThreadKey={selectedThreadKey}
                  threads={channelThreads}
                />
              ) : (
                <TableRows events={currentEvents} onOpenEvent={openEventThread} />
              )}
            </section>
            <ContextRail
              activeThreads={selectedChannel === "voice" ? voiceCallThreads.length : selectedChannel ? channelThreads.length : activeThreads}
              currentEvents={currentEvents}
              latest={latestCurrentEvent}
              propertiesNeedingReview={dashboardData.propertyHealth.missing_core}
              propertyHealthScore={propertyHealthScore}
              selectedChannel={selectedChannel}
              selectedChannelLabel={selectedChannelLabel}
            />
          </div>
        )}
      </main>
      {mobileCardProperty ? (
        <PropertyMobileCard property={mobileCardProperty} onClose={() => setMobileCardIndex(null)} />
      ) : null}
    </div>
  );
}
