"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/inbox/EmptyState";
import { HumanTakeover } from "@/components/inbox/HumanTakeover";
import { ActivityChart } from "@/components/inbox/charts/ActivityChart";
import { ChannelMix } from "@/components/inbox/charts/ChannelMix";
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
import { categoryBySlug, type AiDraft, type InboxCategory, type InboxSettings } from "@/lib/inboxSettings";
import { displayValue, formatPrice, missingPropertyFields } from "@/lib/format";
import {
  inboxImagePreviewUrl,
  isDisplayableImageUrl,
  rewriteEmailHtmlForInbox,
  unwrapMediaProxyUrl,
} from "@/lib/mediaProxy";
import {
  IRIS_AGENT_AVATAR,
  IRIS_AGENT_NAME,
  normalizeLegacyAgentName,
  normalizeLegacyAgentText,
} from "@/lib/agentIdentity";
import type { SheetRow } from "@/lib/sheetSchema";

type View = "overview" | "email" | "sms" | "whatsapp" | "messenger" | "instagram" | "voice" | "website_chat" | "properties";

const DASHBOARD_REFRESH_MS = 5000;

type EmailAccountStatus = {
  connected: boolean;
  legacy_configured: boolean;
  database_enabled: boolean;
  accounts: Array<{
    email: string;
    is_default: boolean;
    status: string;
    last_error: string;
    updated_at: string;
    scopes?: string[];
  }>;
};

const channelViews: { key: View; label: string; agent: string; avatar: string; channel?: Channel }[] = [
  { key: "email", label: "Email", agent: IRIS_AGENT_NAME, avatar: IRIS_AGENT_AVATAR, channel: "email" },
  { key: "sms", label: "SMS", agent: IRIS_AGENT_NAME, avatar: IRIS_AGENT_AVATAR, channel: "sms" },
  { key: "voice", label: "Voice", agent: IRIS_AGENT_NAME, avatar: IRIS_AGENT_AVATAR, channel: "voice" },
  { key: "instagram", label: "Instagram", agent: IRIS_AGENT_NAME, avatar: IRIS_AGENT_AVATAR, channel: "instagram" },
  { key: "messenger", label: "Messenger", agent: IRIS_AGENT_NAME, avatar: IRIS_AGENT_AVATAR, channel: "messenger" },
  { key: "whatsapp", label: "WhatsApp", agent: IRIS_AGENT_NAME, avatar: IRIS_AGENT_AVATAR, channel: "whatsapp" },
  { key: "website_chat", label: "Website", agent: IRIS_AGENT_NAME, avatar: IRIS_AGENT_AVATAR, channel: "website_chat" },
];

function eventText(event: SheetRow) {
  const isInboundEmail = event.direction === "inbound" && (event.channel || "").toLowerCase() === "email";
  // For inbound emails, only use message_text — summary is AI-generated metadata, not the email body
  const text = isInboundEmail
    ? (event.message_text || "")
    : (event.message_text || event.summary || event.ai_action || "");
  const raw = event.direction === "inbound" ? text : normalizeLegacyAgentText(text);
  if (isInboundEmail) {
    return stripEmailMetadata(raw);
  }
  return raw;
}

// Remove lines that are AI extraction output (Intent/role/tags/key=value metadata)
function stripEmailMetadata(text: string): string {
  const lines = text.split("\n").filter((line) => {
    const t = line.trim().toLowerCase();
    if (!t) return false;
    // Drop lines that are pure metadata: "Intent: ..." "role: ..." "tags: ..." or semicolon key=value chains
    if (/^intent:\s/.test(t)) return false;
    if (/^role:\s/.test(t)) return false;
    if (/\btimeline=|budget=|beds=|area=|preferred_channel=|current_property_status=/.test(t)) return false;
    if (/^tags:\s/.test(t)) return false;
    return true;
  });
  return lines.join("\n").trim();
}

function eventSummaryText(event: SheetRow, fallback = "") {
  return normalizeLegacyAgentText(event.summary || fallback || eventText(event));
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function extractUrls(value: string) {
  return Array.from(new Set(value.match(/https?:\/\/[^\s<>"')]+/gi) || []));
}

function linkifyText(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"')]+)/gi);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^https?:\/\//i.test(part)
      ? <a key={i} href={part} rel="noreferrer" target="_blank" className="message-link">{part}</a>
      : part
  );
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

function isHistoricalEmailBodyUnavailable(event: SheetRow, text: string) {
  if (eventChannel(event) !== "email") return false;
  const reason = `${event.handoff_reason || ""} ${event.summary || ""}`.toLowerCase();
  const source = `${event.source || ""} ${event.thread_status || ""}`.toLowerCase();
  return reason.includes("full body was not recorded") ||
    reason.includes("historical log") ||
    source.includes("historical") ||
    (!text.trim() && source.includes("log"));
}

function MessageContent({ event, properties }: { event: SheetRow; properties: SheetRow[] }) {
  const text = eventText(event);
  if (isHistoricalEmailBodyUnavailable(event, text)) {
    return (
      <div className="message-text empty-message historical-email-missing">
        <strong>Historical import, body unavailable</strong>
        <span>This row came from an older log that did not preserve the full email body.</span>
      </div>
    );
  }
  if (!text) {
    return <div className="message-text empty-message">No message text recorded</div>;
  }

  if (looksLikeHtml(text)) {
    return <EmailRenderedHtml html={text} properties={properties} />;
  }

  const imageUrls = extractUrls(text).filter(isDisplayableImageUrl);
  // Linkify URLs in plain-text messages
  const linkified = linkifyText(text);
  return (
    <div className="message-content">
      <div className="message-text">{linkified}</div>
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

function parseDraftKey(key: string): { channel: Channel; threadRef: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const channel = key.slice(0, separator) as Channel;
  const threadRef = key.slice(separator + 1);
  if (!threadRef || !["email", "sms", "whatsapp", "messenger", "instagram", "website_chat"].includes(channel)) return null;
  return { channel, threadRef };
}

function conversationKey(event: SheetRow, channel?: Channel | string) {
  const normalizedChannel = channel || eventChannel(event);
  if (["sms", "whatsapp", "messenger", "instagram", "voice"].includes(normalizedChannel)) {
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
  if (["sms", "whatsapp", "messenger", "instagram", "voice"].includes(channel || "")) return latest.phone || latest.full_name || threadRef;
  return latest.email || latest.phone || latest.full_name || threadRef;
}

function threadSubtitle(threadRef: string, events: SheetRow[], channel?: Channel) {
  const latest = latestEvent(events);
  if (channel === "email") return latest.thread_ref || latest.source || threadRef;
  if (["sms", "whatsapp", "messenger", "instagram", "voice"].includes(channel || "")) return latest.thread_ref || threadRef;
  return latest.source || latest.thread_ref || "";
}

function gmailThreadIdForEmail(events: SheetRow[]) {
  return events.map((event) => event.gmail_thread_id || event.thread_ref).find((threadRef) => /^[a-f0-9]{8,}$/i.test(threadRef || ""));
}

function emailThreadNotice(events: SheetRow[]) {
  if (!events.some((event) => eventChannel(event) === "email")) return "";
  const latestFresh = [...events].reverse().find((event) => event.thread_status === "sent_fresh_from_current_mailbox" || event.status === "sent_fresh");
  if (latestFresh?.mailbox_email) {
    return `Last reply sent as a fresh email from ${latestFresh.mailbox_email} because the original Gmail thread was not in that mailbox.`;
  }
  const hasHistoricalMissingBody = events.some((event) => isHistoricalEmailBodyUnavailable(event, eventText(event)));
  if (hasHistoricalMissingBody) {
    return "Historical email import: older body content is unavailable. Replies still send from the active mailbox and may start a fresh email.";
  }
  const hasGmailThread = Boolean(gmailThreadIdForEmail(events));
  const hasMailboxOwner = events.some((event) => event.mailbox_email);
  if (hasGmailThread && !hasMailboxOwner) {
    return "Imported Gmail thread without active mailbox ownership. If the current mailbox cannot find it, Iris will send a fresh email instead.";
  }
  return "";
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
  if (channel === "sms" || channel === "whatsapp" || channel === "messenger" || channel === "instagram" || channel === "voice") {
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
  if (event.direction === "outbound") return normalizeLegacyAgentName(event.agent_name) || IRIS_AGENT_NAME;
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

// Per-channel brand colors for activity rows
const CH_COLORS: Record<string, string> = {
  email: "#60A5FA", sms: "#2DD4BF", rcs: "#2DD4BF", voice: "#4ADE80",
  instagram: "#F472B6", messenger: "#38BDF8", whatsapp: "#4ADE80",
  web: "#FBBF24", website: "#FBBF24", website_chat: "#FBBF24",
};

function chColor(channel: string) { return CH_COLORS[channel.toLowerCase()] ?? "#94A3B8"; }

function ChannelIconSmall({ channel }: { channel: string }) {
  const ch = channel.toLowerCase();
  if (ch === "email") return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 5.5L8 9.5l6.5-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>;
  if (ch === "sms" || ch === "rcs") return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M5 14l3-2h.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="5.5" cy="7" r=".7" fill="currentColor"/><circle cx="8" cy="7" r=".7" fill="currentColor"/><circle cx="10.5" cy="7" r=".7" fill="currentColor"/></svg>;
  if (ch === "voice") return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M5.5 4.5v7M3 6.5v3M10.5 4.5v7M13 6.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>;
  if (ch === "instagram") return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="11.5" cy="4.5" r=".6" fill="currentColor"/></svg>;
  if (ch === "messenger") return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C4.13 1.5 1 4.3 1 7.75c0 2.07 1.1 3.9 2.8 5.05v2.2l2.4-1.32A8.2 8.2 0 008 14c3.87 0 7-2.8 7-6.25S11.87 1.5 8 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>;
  if (ch === "whatsapp") return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/><path d="M5.5 7.5A2.5 2.5 0 018 5a2.5 2.5 0 012.5 2.5A2.5 2.5 0 018 10c-.55 0-1.06-.18-1.47-.48L5 10l.5-1.53A2.48 2.48 0 015.5 7.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/><path d="M1.5 8h13M8 1.5C6.34 3.5 5.5 5.64 5.5 8s.84 4.5 2.5 6.5M8 1.5C9.66 3.5 10.5 5.64 10.5 8s-.84 4.5-2.5 6.5" stroke="currentColor" strokeWidth="1.1"/></svg>;
}

function activityPillClass(event: SheetRow): { cls: string; label: string } {
  if (eventNeedsHuman(event)) return { cls: "arv2-pill-review", label: "Review" };
  if (event.direction === "outbound") return { cls: "arv2-pill-ai", label: "AI handled" };
  return { cls: "arv2-pill-received", label: "Received" };
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
      {events.slice(-20).reverse().map((event, index) => {
        const ch = eventChannel(event);
        const color = chColor(ch);
        const pill = activityPillClass(event);
        const intent = event.intent || event.lead_role;
        const chDisplayLabel = ch === "website_chat" || ch === "web" || ch === "website" ? "Website" : ch === "sms" ? "SMS" : ch.charAt(0).toUpperCase() + ch.slice(1);
        const rowContent = (
          <div className="arv2-row" style={{ "--ch-color": color } as React.CSSProperties}>
            <div className="arv2-icon-circle">
              <ChannelIconSmall channel={ch} />
            </div>
            <div className="arv2-body">
              <div className="arv2-top">
                <span className="arv2-id">{event.email || event.phone || event.thread_ref || "Unknown"}</span>
                <time className="arv2-time">{formatEventTime(event.event_at)}</time>
              </div>
              <span className="arv2-preview">{eventSummaryText(event)}</span>
              <div className="arv2-pills">
                <span className={`arv2-pill ${pill.cls}`}>{pill.label}</span>
                <span className="arv2-pill arv2-pill-channel">{chDisplayLabel}</span>
                {intent ? <span className="arv2-pill arv2-pill-intent">{intent}</span> : null}
              </div>
            </div>
          </div>
        );
        if (onOpenEvent) {
          return (
            <button
              className="arv2-btn"
              key={`${event.thread_ref}-${event.event_at}-${index}`}
              onClick={() => onOpenEvent(event)}
              type="button"
            >
              {rowContent}
            </button>
          );
        }
        return (
          <div key={`${event.thread_ref}-${event.event_at}-${index}`}>
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
      {channel === "email" && emailThreadNotice(events) ? (
        <div className="thread-mailbox-note">
          {emailThreadNotice(events)}
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
      {channel === "sms" || channel === "whatsapp" || channel === "messenger" || channel === "instagram" || channel === "email" ? (
        <HumanTakeover
          threadRef={threadRef}
          channel={channel}
          to={(channel === "email" ? latest.email : latest.phone) || ""}
          subject={channel === "email" ? eventSummaryText(latest) : undefined}
          gmailThreadId={channel === "email" ? gmailThreadIdForEmail(events) : undefined}
        />
      ) : null}
    </article>
  );
}

function ThreadViewer({
  threads,
  channelLabel,
  channel,
  search,
  categoryFilter,
  categories,
  threadCategories,
  selectedThreadKey,
  onSearchChange,
  onSelectThread,
  properties,
}: {
  threads: [string, SheetRow[]][];
  channelLabel: string;
  channel?: Channel;
  search: string;
  categoryFilter: string;
  categories: InboxCategory[];
  threadCategories: Record<string, string>;
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
    if (categoryFilter && threadCategories[threadRef] !== categoryFilter) return false;
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
            const category = categoryBySlug(categories, threadCategories[threadRef] || "needs_reply");
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
                <span className="conversation-preview">{eventSummaryText(latest)}</span>
                <span className="conversation-row-bottom">
                  <em>{events.length} messages</em>
                  <span className="category-pill mini" style={{ ["--category-color" as string]: category.color }}>{category.name}</span>
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
        <span className="status">{normalizeLegacyAgentName(call.agent_name) || IRIS_AGENT_NAME}</span>
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
        <p>{normalizeLegacyAgentText(call.summary || "No call summary recorded yet.")}</p>
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
                <span className="conversation-preview">{normalizeLegacyAgentText(latest.summary || "Voice call transcript")}</span>
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

type ReviewQueueItem = {
  key: string;
  threadRef: string;
  channel: Channel;
  identity: string;
  receivedAt: string;
  inboundText: string;
  category: InboxCategory;
  draft: AiDraft;
};

function buildReviewQueue(
  currentEvents: SheetRow[],
  drafts: Record<string, AiDraft>,
  categories: InboxCategory[],
  selectedChannel?: Channel,
): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];
  for (const [key, draft] of Object.entries(drafts)) {
    const parsed = parseDraftKey(key);
    if (!parsed || !draft.body.trim()) continue;
    if (!["email", "sms", "whatsapp"].includes(parsed.channel)) continue;
    if (selectedChannel && parsed.channel !== selectedChannel) continue;
    const events = currentEvents.filter((event) =>
      eventChannel(event) === parsed.channel &&
      (conversationKey(event, parsed.channel) === parsed.threadRef || event.thread_ref === parsed.threadRef)
    );
    const latest = latestEvent(events);
    const inbound = [...events].reverse().find((event) => event.direction === "inbound") || latest;
    const category = categoryBySlug(categories, draft.category_slug || "needs_reply");
    items.push({
      key,
      threadRef: parsed.threadRef,
      channel: parsed.channel,
      identity: threadIdentity(parsed.threadRef, events, parsed.channel),
      receivedAt: inbound.event_at || draft.updated_at,
      inboundText: eventText(inbound) || eventSummaryText(inbound, "No inbound text captured."),
      category,
      draft,
    });
  }
  return items.sort((a, b) => new Date(b.receivedAt || b.draft.updated_at).getTime() - new Date(a.receivedAt || a.draft.updated_at).getTime());
}

function HumanReviewQueue({
  items,
  onChanged,
}: {
  items: ReviewQueueItem[];
  onChanged: (key: string, next?: AiDraft) => void;
}) {
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const safeIndex = items.length ? Math.min(index, items.length - 1) : 0;
  const item = items[safeIndex];

  useEffect(() => {
    setBody(item?.draft.body || "");
    setEditing(false);
    setError("");
  }, [item?.key, item?.draft.body]);

  if (!item) {
    return (
      <section className="context-card human-review-card review-queue-card">
        <span className="rail-label">Human review queue</span>
        <h3>Clear</h3>
        <p>No active Iris drafts in this view.</p>
      </section>
    );
  }

  async function action(actionType: "approve_send" | "save_edit" | "dismiss") {
    setBusy(actionType);
    setError("");
    const response = await fetch(`/api/threads/${encodeURIComponent(item.threadRef)}/draft/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionType, channel: item.channel, body }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy("");
    if (!payload.ok) {
      setError(payload.error || "Review action failed");
      return;
    }
    if (actionType === "save_edit" && payload.draft) {
      onChanged(item.key, payload.draft);
      setEditing(false);
      return;
    }
    onChanged(item.key);
    setIndex((current) => Math.max(0, Math.min(current, items.length - 2)));
  }

  return (
    <section className="context-card human-review-card review-queue-card">
      <div className="review-queue-head">
        <span className="rail-label">Human review queue</span>
        <span className="review-count">{items.length} flagged</span>
      </div>
      <div className="review-lead-row">
        <div>
          <strong>{item.identity}</strong>
          <span>{item.channel.toUpperCase()} · {formatEventTime(item.receivedAt)}</span>
        </div>
        <span className="category-pill mini" style={{ ["--category-color" as string]: item.category.color }}>{item.category.name}</span>
      </div>
      <div className="review-inbound">
        <span>Inbound message</span>
        <p>{item.inboundText}</p>
      </div>
      <div className="review-reason">
        <span>{item.draft.reason || `${item.category.name} needs approval`}</span>
      </div>
      <div className="review-draft-head">
        <strong>Iris's drafted reply</strong>
        <span>Confidence {Math.round(item.draft.confidence * 100)}%</span>
      </div>
      <div className="review-confidence"><span style={{ width: `${Math.round(item.draft.confidence * 100)}%` }} /></div>
      {editing ? (
        <textarea className="review-draft-edit" value={body} onChange={(event) => setBody(event.target.value)} rows={5} />
      ) : (
        <p className="review-draft-body">{body}</p>
      )}
      {error ? <div className="human-compose-error">{error}</div> : null}
      <div className="review-actions">
        <button className="human-compose-send-btn review-approve" type="button" onClick={() => action("approve_send")} disabled={Boolean(busy)}>
          {busy === "approve_send" ? "Sending..." : "Approve & send"}
        </button>
        <button className="review-icon-button" type="button" onClick={() => editing ? action("save_edit") : setEditing(true)} disabled={Boolean(busy)} title={editing ? "Save edit" : "Edit draft"}>
          {editing ? "Save" : "Edit"}
        </button>
        <button className="review-icon-button" type="button" onClick={() => action("dismiss")} disabled={Boolean(busy)} title="Dismiss draft">
          Dismiss
        </button>
      </div>
      <div className="review-pager">
        <button type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={safeIndex === 0}>‹</button>
        <span>{safeIndex + 1} of {items.length} flagged</span>
        <button type="button" onClick={() => setIndex((current) => Math.min(items.length - 1, current + 1))} disabled={safeIndex >= items.length - 1}>›</button>
      </div>
    </section>
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
  drafts,
  categories,
  onDraftChanged,
}: {
  currentEvents: SheetRow[];
  latest: SheetRow;
  selectedChannelLabel: string;
  selectedChannel?: Channel;
  activeThreads: number;
  propertyHealthScore: number;
  propertiesNeedingReview: number;
  drafts: Record<string, AiDraft>;
  categories: InboxCategory[];
  onDraftChanged: (key: string, next?: AiDraft) => void;
}) {
  const inbound = directionCount(currentEvents, "inbound");
  const outbound = directionCount(currentEvents, "outbound");
  const label = selectedChannel ? selectedChannelLabel : "All channels";
  const latestIdentity = latest.email || latest.phone || latest.full_name || "No lead selected";
  const reviewEvents = currentEvents.filter(eventNeedsHuman).slice(-5).reverse();
  const reviewQueue = buildReviewQueue(currentEvents, drafts, categories, selectedChannel);

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
        <p>{normalizeLegacyAgentText(latest.summary || latest.ai_action || latest.event_type || "No conversation activity loaded yet.")}</p>
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

      <HumanReviewQueue items={reviewQueue} onChanged={onDraftChanged} />

      {reviewEvents.length ? (
        <section className="context-card human-review-card">
          <span className="rail-label">Handoff flags</span>
          <h3>{reviewEvents.length} flagged</h3>
          <div className="review-stack">
            {reviewEvents.map((event, index) => (
              <div className="review-item" key={`${event.thread_ref}-${event.event_at}-${index}`}>
                <strong>{event.phone || event.email || event.thread_ref || "Unknown lead"}</strong>
                <span>{normalizeLegacyAgentText(event.handoff_reason || event.summary || "Review this conversation.")}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="context-card">
        <span className="rail-label">Flow balance</span>
        <div className="flow-balance-rows">
          <div>
            <div className="flow-balance-row-top">
              <span className="flow-dir inbound">↘</span>
              <span className="flow-dir-label">Inbound</span>
              <span className="flow-count">{inbound}</span>
            </div>
            <div className="flow-bar-track">
              <div className="flow-bar-fill inbound" style={{ width: `${currentEvents.length ? Math.max(8, (inbound / currentEvents.length) * 100) : 0}%` }} />
            </div>
          </div>
          <div>
            <div className="flow-balance-row-top">
              <span className="flow-dir outbound">↗</span>
              <span className="flow-dir-label">AI replies</span>
              <span className="flow-count">{outbound}</span>
            </div>
            <div className="flow-bar-track">
              <div className="flow-bar-fill outbound" style={{ width: `${currentEvents.length ? Math.max(8, (outbound / currentEvents.length) * 100) : 0}%` }} />
            </div>
          </div>
        </div>
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
  if (view === "instagram") return "Instagram DMs";
  return view[0].toUpperCase() + view.slice(1);
}

function EmailAccountControl({
  status,
  loading,
  error,
  autoSendEmail,
}: {
  status: EmailAccountStatus | null;
  loading: boolean;
  error: string;
  autoSendEmail: boolean;
}) {
  const defaultAccount = status?.accounts.find((account) => account.is_default) || status?.accounts[0];
  const missingCapabilities = status?.connected && defaultAccount?.scopes
    ? [
      !defaultAccount.scopes.includes("https://www.googleapis.com/auth/gmail.labels") && !defaultAccount.scopes.includes("https://www.googleapis.com/auth/gmail.modify") ? "labels" : "",
      !defaultAccount.scopes.includes("https://www.googleapis.com/auth/gmail.send") ? "auto-send" : "",
    ].filter(Boolean)
    : [];
  const label = defaultAccount?.email
    ? `Email: ${defaultAccount.email}`
    : status?.legacy_configured
      ? "Email: legacy token"
      : "Email: not connected";
  const state = error
    ? error
    : loading
      ? "checking"
      : defaultAccount?.status === "error"
        ? defaultAccount.last_error || "needs reconnect"
        : missingCapabilities.length
          ? `missing ${missingCapabilities.join(", ")} scope`
          : status?.connected || status?.legacy_configured
            ? "ready"
          : "connect mailbox";

  return (
    <div className="email-account-control">
      <div className="email-account-copy">
        <strong>{label}</strong>
        <span>{state}</span>
      </div>
      <button
        className="email-account-button"
        onClick={() => {
          window.location.href = `/api/settings/email-account/connect${autoSendEmail ? "?mode=autosend" : ""}`;
        }}
        type="button"
      >
        {defaultAccount ? "Change" : "Connect"}
      </button>
    </div>
  );
}

function InboxSettingsPanel({
  categories,
  settings,
  onClose,
  onSaved,
}: {
  categories: InboxCategory[];
  settings: InboxSettings;
  onClose: () => void;
  onSaved: (next: { categories: InboxCategory[]; settings: InboxSettings }) => void;
}) {
  const [localCategories, setLocalCategories] = useState(categories);
  const [localSettings, setLocalSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateCategory(index: number, patch: Partial<InboxCategory>) {
    setLocalCategories((current) => current.map((category, i) => i === index ? { ...category, ...patch } : category));
  }

  function updateAutoSend(key: keyof InboxSettings["auto_send"], value: boolean) {
    setLocalSettings((current) => ({ ...current, auto_send: { ...current.auto_send, [key]: value } }));
  }

  async function save() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/settings/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: localSettings, categories: localCategories }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok || !payload.ok) {
      setError(payload.error || "Save failed");
      return;
    }
    onSaved({ categories: payload.categories, settings: payload.settings });
    onClose();
  }

  return (
    <div className="settings-drawer" role="dialog" aria-modal="true" aria-label="Inbox settings">
      <button className="settings-scrim" type="button" onClick={onClose} aria-label="Close inbox settings" />
      <section className="settings-panel">
        <div className="settings-head">
          <div>
            <span className="rail-label">Iris Inbox</span>
            <h2>Settings</h2>
          </div>
          <button className="filter-clear" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="settings-section">
          <label className="settings-toggle">
            <input
              checked={localSettings.draft_first}
              onChange={(event) => setLocalSettings((current) => ({ ...current, draft_first: event.target.checked }))}
              type="checkbox"
            />
            <span>Draft first by default</span>
          </label>
          <div className="settings-toggle-grid">
            {Object.entries(localSettings.auto_send).map(([key, value]) => (
              <label className="settings-toggle compact" key={key}>
                <input
                  checked={value}
                  onChange={(event) => updateAutoSend(key as keyof InboxSettings["auto_send"], event.target.checked)}
                  type="checkbox"
                />
                <span>{key.replace("_", " ")} auto-send</span>
              </label>
            ))}
          </div>
        </div>
        <div className="settings-section">
          <span className="rail-label">Categories</span>
          <div className="category-editor-list">
            {localCategories.map((category, index) => (
              <div className="category-editor-row" key={category.slug}>
                <input
                  aria-label={`${category.name} color`}
                  className="category-color-input"
                  type="color"
                  value={category.color}
                  onChange={(event) => updateCategory(index, { color: event.target.value })}
                />
                <input
                  aria-label={`${category.name} name`}
                  className="category-name-input"
                  value={category.name}
                  onChange={(event) => updateCategory(index, { name: event.target.value, gmail_label_name: `Iris/${event.target.value}` })}
                />
                <label className="settings-toggle mini">
                  <input
                    checked={category.enabled}
                    onChange={(event) => updateCategory(index, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  <span>on</span>
                </label>
              </div>
            ))}
          </div>
        </div>
        {error ? <div className="human-compose-error">{error}</div> : null}
        <button className="human-compose-send-btn settings-save" type="button" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </button>
      </section>
    </div>
  );
}

export function AgentInboxClient({
  data,
  initialRefreshedAt = "",
  loadError = "",
  sourceLabel = "Google Sheets",
  userEmail = "",
}: {
  data: AgentInboxData;
  initialRefreshedAt?: string;
  loadError?: string;
  sourceLabel?: string;
  userEmail?: string;
}) {
  const [dashboardData, setDashboardData] = useState<AgentInboxData>(data);
  const [refreshError, setRefreshError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(initialRefreshedAt);
  const [view, setView] = useState<View>("overview");
  const [darkMode, setDarkMode] = useState(false);
  const [selectedPropertyIndex, setSelectedPropertyIndex] = useState(0);
  const [mobileCardIndex, setMobileCardIndex] = useState<number | null>(null);
  const [propertySort, setPropertySort] = useState<PropertySort>({ key: "source_order", direction: "asc" });
  const [showPropertyReviewOnly, setShowPropertyReviewOnly] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const [selectedThreadKey, setSelectedThreadKey] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [emailAccountStatus, setEmailAccountStatus] = useState<EmailAccountStatus | null>(null);
  const [emailAccountLoading, setEmailAccountLoading] = useState(true);
  const [emailAccountError, setEmailAccountError] = useState("");
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
    setCategoryFilter("");
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

  useEffect(() => {
    let cancelled = false;
    async function loadEmailAccountStatus() {
      try {
        const response = await fetch(`/api/settings/email-account?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Email account check failed with ${response.status}`);
        const payload = await response.json() as EmailAccountStatus;
        if (!cancelled) {
          setEmailAccountStatus(payload);
          setEmailAccountError("");
        }
      } catch (error) {
        if (!cancelled) {
          setEmailAccountError(error instanceof Error ? error.message : "Email account check failed");
        }
      } finally {
        if (!cancelled) setEmailAccountLoading(false);
      }
    }
    loadEmailAccountStatus();
    return () => {
      cancelled = true;
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

  const toggleDark = () => {
    setDarkMode(d => {
      document.documentElement.classList.toggle("dark", !d);
      return !d;
    });
  };

  function handleDraftChanged(key: string, next?: AiDraft) {
    setDashboardData((current) => {
      const drafts = { ...current.drafts };
      if (next) drafts[key] = next;
      else delete drafts[key];
      return { ...current, drafts };
    });
  }

  return (
    <div className={`app-shell${darkMode ? " dark" : ""}`}>
      <Sidebar currentView={view} onViewChange={setView} data={dashboardData} darkMode={darkMode} onToggleDark={toggleDark} />

      <main className="inbox-main">
        <header className="inbox-topbar">
          <span className="inbox-topbar-title">{selectedChannel ? selectedChannelLabel : viewTitle(view)}</span>
          <div className="inbox-topbar-actions">
            <EmailAccountControl
              autoSendEmail={dashboardData.inboxSettings.auto_send.email}
              error={emailAccountError}
              loading={emailAccountLoading}
              status={emailAccountStatus}
            />
            <button className="topbar-login-btn settings-open-btn" type="button" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <SyncIndicator lastUpdated={lastRefreshedAt || null} isLive={!effectiveLoadError} />
            {userEmail ? (
              <a className="topbar-user-btn" href="/api/auth/signout" title={`Signed in as ${userEmail}`}>
                <span className="topbar-user-initial">{userEmail[0].toUpperCase()}</span>
              </a>
            ) : (
              <a className="topbar-login-btn" href="/login">Login</a>
            )}
          </div>
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
              {selectedChannel && selectedChannel !== "voice" ? (
                <div className="category-filter-row" aria-label="Category filters">
                  <button
                    className={!categoryFilter ? "category-pill active" : "category-pill"}
                    onClick={() => setCategoryFilter("")}
                    type="button"
                  >
                    All
                  </button>
                  {dashboardData.inboxCategories.filter((category) => category.enabled).map((category) => {
                    const count = channelThreads.filter(([threadRef]) => dashboardData.threadCategories[threadRef] === category.slug).length;
                    return (
                      <button
                        className={categoryFilter === category.slug ? "category-pill active" : "category-pill"}
                        key={category.slug}
                        onClick={() => setCategoryFilter(category.slug)}
                        style={{ ["--category-color" as string]: category.color }}
                        type="button"
                      >
                        {category.name} <span>{count}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
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
                  categories={dashboardData.inboxCategories}
                  categoryFilter={categoryFilter}
                  onSearchChange={setThreadSearch}
                  onSelectThread={setSelectedThreadKey}
                  properties={dashboardData.properties}
                  search={threadSearch}
                  selectedThreadKey={selectedThreadKey}
                  threadCategories={dashboardData.threadCategories}
                  threads={channelThreads}
                />
              ) : (
                <>
                  <div className="overview-charts">
                    <ActivityChart events={currentEvents} />
                    <ChannelMix events={currentEvents} />
                  </div>
                  <TableRows events={currentEvents} onOpenEvent={openEventThread} />
                </>
              )}
            </section>
            <ContextRail
              activeThreads={selectedChannel === "voice" ? voiceCallThreads.length : selectedChannel ? channelThreads.length : activeThreads}
              categories={dashboardData.inboxCategories}
              currentEvents={currentEvents}
              drafts={dashboardData.drafts}
              latest={latestCurrentEvent}
              onDraftChanged={handleDraftChanged}
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
      {settingsOpen ? (
        <InboxSettingsPanel
          categories={dashboardData.inboxCategories}
          settings={dashboardData.inboxSettings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setDashboardData((current) => ({
              ...current,
              inboxCategories: next.categories,
              inboxSettings: next.settings,
            }));
          }}
        />
      ) : null}
    </div>
  );
}
