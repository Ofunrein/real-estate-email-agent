"use client";

import React from "react";
import {
  Activity,
  Building2,
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  Clock3,
  Database,
  FileText,
  Globe2,
  Inbox,
  Image as ImageIcon,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Moon,
  Phone,
  Search,
  Settings,
  Sun,
  UserRound,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { useInboxModel } from "@/components/inbox-mui/InboxDataContext";
import { useReplayKey } from "@/components/inbox-mui/hooks/useReplayKey";
import { displayForChannelConnection, useChannelConnectionStatus, type ConnectionStatus } from "@/components/inbox-mui/hooks/useChannelConnectionStatus";
import { useColorMode } from "@/components/inbox-mui/theme/ColorModeContext";
import { CalendarOsView } from "@/components/inbox-mui/components/CalendarOsView";
import type {
  ActivityEvent,
  Call,
  ChannelId,
  EmailMessage,
  EmailThread,
  MessageChannelId,
  Property,
  PropertyCard,
  SmsMessage,
  SmsThread,
  VoiceContact,
} from "@/components/inbox-mui/data/inboxData";
import type { InboxSettings } from "@/lib/inboxSettings";

type UnifiedMessage = (EmailMessage | SmsMessage) & { body?: string };
type UnifiedThread = {
  id: string;
  channel: MessageChannelId;
  contact: string;
  name: string;
  time: string;
  preview: string;
  messageCount: number;
  category?: string;
  needsReview?: boolean;
  reviewReason?: string;
  messages: UnifiedMessage[];
  meta?: string;
  sendTo?: string;
  subject?: string;
  voiceCalls?: Call[];
};
type DashboardViewId = ChannelId | "overview" | "settings";
type VoiceProvider = "deepgram" | "cartesia";
type VoiceAttachment = { url: string; filename: string; transcript?: string; kind?: "voice-note" | "file" };
type VoicePreset = { id: string; label: string; provider: VoiceProvider; gender: string; style: string; cloned?: boolean };

type MetricCard = {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ size?: number }>;
  tone: "ok" | "warn" | "info";
  help: string;
};
type SettingsChannelKey = keyof InboxSettings["auto_send"];
type SettingsConnection = {
  id: string;
  channel: MessageChannelId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  accent: string;
  detail: string;
  envOnly?: boolean;
  urls: Array<{ label: string; href: string }>;
};

const MESSAGE_CHANNELS: MessageChannelId[] = ["email", "sms", "voice", "instagram", "messenger", "whatsapp", "website"];
const CHANNEL_ACCENT: Record<MessageChannelId, string> = {
  email: "var(--iris-c-email)",
  sms: "var(--iris-c-sms)",
  voice: "var(--iris-c-voice)",
  instagram: "var(--iris-c-instagram)",
  messenger: "var(--iris-c-messenger)",
  whatsapp: "var(--iris-c-whatsapp)",
  website: "var(--iris-c-website)",
};
const CHANNEL_ICON: Record<MessageChannelId, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  email: Mail,
  sms: MessageCircle,
  voice: Phone,
  instagram: InstagramGlyph,
  messenger: MessengerGlyph,
  whatsapp: WhatsAppGlyph,
  website: Globe2,
};
const CHANNEL_LABEL: Record<MessageChannelId, string> = {
  email: "Email",
  sms: "SMS",
  voice: "Voice",
  instagram: "Instagram",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  website: "Website",
};
const AUTO_SEND_SETTINGS: Array<[SettingsChannelKey, string]> = [
  ["email", "Email"],
  ["sms", "SMS"],
  ["whatsapp", "WhatsApp"],
  ["messenger", "Messenger"],
  ["instagram", "Instagram"],
  ["website_chat", "Website"],
];
const CHANNEL_ENABLE_SETTINGS: Array<[SettingsChannelKey, string]> = AUTO_SEND_SETTINGS;
const SETTINGS_CONNECTIONS: SettingsConnection[] = [
  { id: "email", channel: "email", label: "Gmail / Outlook", icon: Mail, accent: CHANNEL_ACCENT.email, detail: "Event-driven mailbox OAuth. Calendar sync is connected separately.", urls: [{ label: "Gmail OAuth", href: "/api/settings/email-account/connect" }, { label: "Outlook OAuth", href: "/api/settings/email-account/outlook-connect" }] },
  { id: "sms", channel: "sms", label: "SMS", icon: MessageCircle, accent: CHANNEL_ACCENT.sms, detail: "Twilio number and webhook environment.", envOnly: true, urls: [{ label: "Twilio settings", href: "/settings#sms" }] },
  { id: "voice", channel: "voice", label: "Voice", icon: Phone, accent: CHANNEL_ACCENT.voice, detail: "Vapi number, assistant, recording proxy, and call webhooks.", envOnly: true, urls: [{ label: "Voice settings", href: "/settings#voice" }] },
  { id: "instagram", channel: "instagram", label: "Instagram DMs", icon: InstagramGlyph, accent: CHANNEL_ACCENT.instagram, detail: "Meta direct account with message send permissions.", urls: [{ label: "Connect Instagram", href: "/api/channels/meta/connect?channel=instagram&use_sdk=1" }] },
  { id: "messenger", channel: "messenger", label: "Messenger", icon: MessengerGlyph, accent: CHANNEL_ACCENT.messenger, detail: "Facebook Page messaging with direct Meta webhooks.", urls: [{ label: "Connect Messenger", href: "/api/channels/meta/connect?channel=messenger&use_sdk=1" }] },
  { id: "whatsapp", channel: "whatsapp", label: "WhatsApp", icon: WhatsAppGlyph, accent: CHANNEL_ACCENT.whatsapp, detail: "Meta Cloud WhatsApp number and direct webhooks.", envOnly: true, urls: [{ label: "WhatsApp settings", href: "/settings#whatsapp" }] },
  { id: "website", channel: "website", label: "Website chat", icon: Globe2, accent: CHANNEL_ACCENT.website, detail: "Website widget/webhook routes for Olivia and Iris handoff.", envOnly: true, urls: [{ label: "Widget settings", href: "/settings#website" }] },
];
const VOICE_PROFILE_STORAGE_KEY = "iris.operator.voiceProfiles";
const VOICE_SELECTED_STORAGE_KEY = "iris.operator.selectedVoiceId";
const VOICE_PRESETS: VoicePreset[] = [
  { id: "aura-2-thalia-en", label: "Thalia", provider: "deepgram", gender: "female", style: "clear energetic" },
  { id: "aura-2-andromeda-en", label: "Andromeda", provider: "deepgram", gender: "female", style: "expressive support" },
  { id: "aura-2-helena-en", label: "Helena", provider: "deepgram", gender: "female", style: "caring friendly" },
  { id: "aura-2-iris-en", label: "Iris", provider: "deepgram", gender: "female", style: "cheerful approachable" },
  { id: "aura-2-luna-en", label: "Luna", provider: "deepgram", gender: "female", style: "friendly natural" },
  { id: "aura-2-hera-en", label: "Hera", provider: "deepgram", gender: "female", style: "confident" },
  { id: "aura-2-athena-en", label: "Athena", provider: "deepgram", gender: "female", style: "professional" },
  { id: "aura-2-stella-en", label: "Stella", provider: "deepgram", gender: "female", style: "bright clear" },
  { id: "aura-2-orion-en", label: "Orion", provider: "deepgram", gender: "male", style: "calm" },
  { id: "aura-2-arcas-en", label: "Arcas", provider: "deepgram", gender: "male", style: "warm conversational" },
  { id: "aura-2-apollo-en", label: "Apollo", provider: "deepgram", gender: "male", style: "polished" },
  { id: "aura-2-zeus-en", label: "Zeus", provider: "deepgram", gender: "male", style: "authoritative" },
  { id: "aura-asteria-en", label: "Asteria (v1)", provider: "deepgram", gender: "female", style: "warm legacy" },
  { id: "aura-luna-en", label: "Luna (v1)", provider: "deepgram", gender: "female", style: "friendly legacy" },
  { id: "aura-orion-en", label: "Orion (v1)", provider: "deepgram", gender: "male", style: "calm legacy" },
];

export function IrisDashboard() {
  const model = useInboxModel();
  const { mode, toggle } = useColorMode();
  const [activeNav, setActiveNav] = React.useState<DashboardViewId>("overview");
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [hoverBucket, setHoverBucket] = React.useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [mobileListOpen, setMobileListOpen] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);

  const threads = React.useMemo(() => {
    const all: UnifiedThread[] = [
      ...model.emailThreads.map(normalizeEmailThread),
      ...model.smsThreads.map((thread) => normalizeSmsThread(thread, "sms")),
      ...model.textThreads.instagram.map((thread) => normalizeSmsThread(thread, "instagram")),
      ...model.textThreads.messenger.map((thread) => normalizeSmsThread(thread, "messenger")),
      ...model.textThreads.whatsapp.map((thread) => normalizeSmsThread(thread, "whatsapp")),
      ...model.textThreads.website.map((thread) => normalizeSmsThread(thread, "website")),
      ...model.voiceContacts.map(normalizeVoiceContact),
    ];
    return all.sort((a, b) => Date.parse(b.time || "") - Date.parse(a.time || ""));
  }, [model.emailThreads, model.smsThreads, model.textThreads, model.voiceContacts]);

  const filteredThreads = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((thread) => {
      const byChannel = activeNav === "all" || activeNav === "overview" || thread.channel === activeNav;
      const searchable = [
        thread.name,
        thread.contact,
        thread.preview,
        thread.subject,
        thread.meta,
        thread.category,
        ...thread.messages.flatMap((message) => [
          messageSubject(message),
          message.body,
          message.html,
          message.media?.map((item) => `${item.label || ""} ${item.alt || ""} ${item.transcript || ""}`).join(" "),
        ]),
      ].filter(Boolean).join(" ");
      return byChannel && (!q || searchable.toLowerCase().includes(q));
    });
  }, [activeNav, query, threads]);

  const activeThread = React.useMemo(
    () => filteredThreads.find((thread) => thread.id === activeThreadId) || filteredThreads[0] || threads[0] || null,
    [activeThreadId, filteredThreads, threads],
  );

  React.useEffect(() => {
    if (activeThread && activeThread.id !== activeThreadId) setActiveThreadId(activeThread.id);
  }, [activeThread, activeThreadId]);

  const metricCards: MetricCard[] = [
    { label: "Need review", value: model.metrics.needReview, icon: CircleAlert, tone: "warn", help: "Flagged for human approval" },
    { label: "Leads total", value: model.metrics.leadsTotal, icon: UsersRound, tone: "info", help: "Active buyer/seller leads" },
    { label: "Conversations handled", value: model.metrics.events, icon: MessageCircle, tone: "info", help: `${model.metrics.threads} threads tracked` },
    { label: "AI reply rate", value: `${Math.round((model.metrics.aiReplies / Math.max(1, model.metrics.inbound)) * 100)}%`, icon: Activity, tone: "info", help: `${model.metrics.aiReplies} AI replies` },
    { label: "Qualified", value: model.metrics.qualifiedLeads, icon: UsersRound, tone: "ok", help: "Verified qualified leads" },
    { label: "Appointments", value: model.metrics.appointments, icon: CalendarDays, tone: "ok", help: "Booked showings/callbacks" },
    { label: "Transfers", value: model.metrics.liveTransfers, icon: Phone, tone: "ok", help: "Completed handoffs" },
    { label: "Media understood", value: `${Math.round((model.metrics.mediaTranscripts / Math.max(1, model.metrics.mediaItems)) * 100)}%`, icon: ImageIcon, tone: "info", help: `${model.metrics.mediaTranscripts}/${model.metrics.mediaItems} media transcribed` },
  ];
  const sideMetrics = metricCards.slice(0, 4);
  const spark = model.sparkline.length ? model.sparkline.slice(-14) : Array.from({ length: 14 }, () => 0);
  const maxSpark = Math.max(1, ...spark);
  const hoverValue = hoverBucket === null ? null : spark[hoverBucket];
  const hoverEvents = hoverBucket === null ? [] : model.activityEvents.filter((_, index) => index % spark.length === hoverBucket).slice(0, 3);
  const showActivityRail = activeNav !== "overview";

  const navItems = [
    { id: "overview" as DashboardViewId, label: "Overview", icon: ActivityGlyph, count: model.metrics.events, accent: "var(--iris-accent)" },
    { id: "all" as DashboardViewId, label: "Inbox", icon: Inbox, count: threads.length, accent: "var(--iris-accent)" },
    ...MESSAGE_CHANNELS.map((id) => ({ id: id as DashboardViewId, label: CHANNEL_LABEL[id], icon: CHANNEL_ICON[id], count: threads.filter((thread) => thread.channel === id).length, accent: CHANNEL_ACCENT[id] })),
    { id: "calendar" as DashboardViewId, label: "Appointments", icon: CalendarDays, count: model.metrics.appointments, accent: "var(--iris-success)" },
    { id: "contacts" as DashboardViewId, label: "Contacts", icon: UsersRound, count: model.metrics.leadsTotal, accent: "var(--iris-info)" },
    { id: "properties" as DashboardViewId, label: "Properties", icon: Building2, count: model.properties.length, accent: "var(--iris-warning)" },
    { id: "imports" as DashboardViewId, label: "CRM / Imports", icon: Workflow, count: model.reviewQueue.length, accent: "var(--iris-c-messenger)" },
    { id: "ops" as DashboardViewId, label: "Ops log", icon: Database, count: model.metrics.events, accent: "var(--iris-text-muted)" },
    { id: "settings" as DashboardViewId, label: "Settings", icon: Settings, count: 0, accent: "var(--iris-text-muted)" },
  ];

  const openEventThread = React.useCallback((event: ActivityEvent) => {
    const eventKeys = [event.id, event.eventId, event.threadId, event.threadRef, event.actor].map(looseKey).filter(Boolean);
    const target = threads.find((thread) => {
      if (thread.channel !== event.channel) return false;
      const threadKeys = [thread.id, thread.contact, thread.sendTo, thread.meta, thread.name].map(looseKey).filter(Boolean);
      const directMatch = threadKeys.some((key) => eventKeys.includes(key));
      const messageMatch = thread.messages.some((message) => [message.id, message.eventId].map(looseKey).some((key) => key && eventKeys.includes(key)));
      return directMatch || messageMatch;
    });
    if (target) {
      setActiveNav(target.channel);
      setActiveThreadId(target.id);
    } else {
      setActiveNav("all");
      setQuery(event.actor || event.threadRef || event.body || "");
    }
    setMobileListOpen(false);
    setContextOpen(false);
  }, [threads]);

  const updateGlobalSearch = React.useCallback((value: string) => {
    setQuery(value);
    if (value.trim() && !["all", ...MESSAGE_CHANNELS].includes(activeNav as MessageChannelId | "all")) {
      setActiveNav("all");
    }
  }, [activeNav]);

  const renderMain = () => {
    if (activeNav === "overview") return <OverviewPanel model={model} spark={spark} maxSpark={maxSpark} hoverBucket={hoverBucket} hoverValue={hoverValue} hoverEvents={hoverEvents} setHoverBucket={setHoverBucket} metricCards={metricCards} onOpenEvent={openEventThread} />;
    if (activeNav === "properties") return <PropertiesPanel properties={model.properties} propertyHealth={model.propertyHealth} />;
    if (activeNav === "calendar") return <AppointmentsPanel events={model.activityEvents} metrics={model.metrics} />;
    if (activeNav === "contacts") return <ContactsPanel threads={threads} />;
    if (activeNav === "imports") return <ImportsPanel reviewQueue={model.reviewQueue} />;
    if (activeNav === "ops") return <OpsPanel events={model.activityEvents} channelQuality={model.channelQuality} />;
    if (activeNav === "settings") return <SettingsPanel model={model} />;
    return (
      <>
        <section className={`iris-thread-col ${mobileListOpen ? "is-open" : ""}`}>
          <div className="iris-thread-head"><div><p className="iris-eyebrow">Unified inbox</p><h2>{activeNav === "all" ? "All conversations" : CHANNEL_LABEL[activeNav as MessageChannelId]}</h2></div><span className="iris-live-pill"><span />Live</span></div>
          <label className="iris-search"><Search size={15} /><input value={query} onChange={(event) => updateGlobalSearch(event.target.value)} placeholder="Search conversations..." /></label>
          <div className="iris-filter-row">{(["all", ...MESSAGE_CHANNELS] as ChannelId[]).map((id) => <button key={id} className={activeNav === id ? "is-active" : ""} onClick={() => setActiveNav(id)}>{id === "all" ? "All" : CHANNEL_LABEL[id as MessageChannelId]}</button>)}</div>
          <div className="iris-thread-list">
            {filteredThreads.map((thread) => <ThreadCard key={`${thread.channel}-${thread.id}`} thread={thread} active={activeThread?.id === thread.id} onClick={() => { setActiveThreadId(thread.id); setMobileListOpen(false); }} />)}
            {!filteredThreads.length && <div className="iris-empty">No conversations in this filter.</div>}
          </div>
        </section>
        <ConversationPanel thread={activeThread} onBack={() => setMobileListOpen(true)} contextOpen={contextOpen} onToggleContext={() => setContextOpen((open) => !open)} properties={model.properties} />
        <button className={`iris-context-scrim ${contextOpen ? "is-open" : ""}`} onClick={() => setContextOpen(false)} aria-label="Close lead profile" />
        <ContextPanel open={contextOpen} thread={activeThread} events={model.activityEvents} metrics={model.metrics} properties={model.properties} onClose={() => setContextOpen(false)} />
      </>
    );
  };

  return (
    <div className="iris-redesign-shell">
      <header className="iris-topbar">
        <button className="iris-round hide-desktop" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
        <button className="iris-account-chip"><img src="/iris-design/iris-mark.png" alt="" /><span>Austin Realty</span><em>Workspace</em></button>
        <span className="iris-live-pill"><span />Live</span>
        <div className="iris-topbar-spacer" />
        <label className="iris-top-search"><Search size={15} /><input value={query} onFocus={() => { if (query.trim()) setActiveNav("all"); }} onChange={(event) => updateGlobalSearch(event.target.value)} placeholder="Search people, messages, HTML, media..." /></label>
        <button className="iris-round" onClick={toggle} aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{mode === "dark" ? <Moon size={18} /> : <Sun size={18} />}</button>
        <button className="iris-round" onClick={() => setActiveNav("settings")} aria-label="Settings"><Settings size={17} /></button>
        <button className="iris-round" onClick={() => signOut({ callbackUrl: "/login" })} aria-label="Log out"><LogOut size={17} /></button>
        <button className="iris-user-chip" onClick={() => setActiveNav("settings")}><span>MO</span><b>Martin</b></button>
      </header>
      <div className={`iris-dashboard-grid ${showActivityRail ? "" : "no-activity-rail"}`}>
        <aside className={`iris-side-col ${mobileNavOpen ? "is-open" : ""}`}>
          <div className="iris-brand-lockup"><img src="/iris-design/iris-mark.png" alt="Iris" /><div><strong>Iris</strong><span>Austin Realty</span></div><button className="iris-round hide-desktop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={16} /></button></div>
          <nav className="iris-nav-list">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={activeNav === item.id ? "is-active" : ""} onClick={() => { setActiveNav(item.id); setMobileNavOpen(false); }}><span style={{ color: item.accent }}><Icon size={16} /></span><b>{item.label}</b>{Boolean(item.count) && <em>{compactMetric(item.count)}</em>}</button>; })}</nav>
          <div className="iris-agent-card"><img src="/iris-design/iris-avatar.png" alt="Iris avatar" /><div><strong>Iris</strong><span>Active across {MESSAGE_CHANNELS.length} channels</span></div></div>
        </aside>
        <button className={`iris-scrim ${mobileNavOpen ? "is-open" : ""}`} onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />
        <main className={`iris-main ${["overview", "properties", "calendar", "contacts", "imports", "ops", "settings"].includes(activeNav) ? "is-wide" : ""}`}>{renderMain()}</main>
        {showActivityRail && <ActivityRail metricCards={sideMetrics} spark={spark} maxSpark={maxSpark} hoverBucket={hoverBucket} hoverValue={hoverValue} hoverEvents={hoverEvents} events={model.activityEvents} setHoverBucket={setHoverBucket} onOpenEvent={openEventThread} />}
      </div>
    </div>
  );
}

function normalizeEmailThread(thread: EmailThread): UnifiedThread {
  return { id: thread.id, channel: "email", contact: thread.contact, name: thread.name || thread.contact, time: thread.time, preview: thread.preview, messageCount: thread.messageCount, category: thread.category, needsReview: thread.needsReview, reviewReason: thread.reviewReason, messages: thread.messages, meta: thread.contact, sendTo: thread.contact, subject: thread.messages.find((message) => message.subject)?.subject || `Re: ${thread.contact}` };
}
function normalizeSmsThread(thread: SmsThread, channel: MessageChannelId): UnifiedThread {
  return { id: thread.id, channel, contact: thread.contact, name: thread.contact, time: thread.time, preview: thread.preview, messageCount: thread.messageCount, category: thread.category, needsReview: Boolean(thread.unreadCount || thread.fallbackUsed), reviewReason: thread.fallbackUsed ? "Fallback route used" : undefined, messages: thread.messages, meta: thread.replyTo || thread.contact, sendTo: thread.replyTo || thread.contact };
}
function normalizeVoiceContact(contact: VoiceContact): UnifiedThread {
  const messages: UnifiedMessage[] = contact.calls.flatMap((call) => call.turns.map((turn, index) => ({ id: `${call.id}-${index}`, eventId: call.id, direction: turn.speaker === "Iris" ? "iris" : "inbound", time: call.time, body: turn.text })));
  return { id: contact.id, channel: "voice", contact: contact.phone || contact.contact, name: contact.contact, time: contact.time, preview: contact.summary, messageCount: messages.length || contact.callCount, category: contact.tag?.toLowerCase().includes("hot") ? "hot-lead" : "nurture", messages, meta: contact.phone || `${contact.callCount} calls`, sendTo: contact.phone, voiceCalls: contact.calls };
}

function ThreadCard({ thread, active, onClick }: { thread: UnifiedThread; active: boolean; onClick: () => void }) {
  const Icon = CHANNEL_ICON[thread.channel];
  return <button className={`iris-thread-card ${active ? "is-active" : ""}`} onClick={onClick}><span className="iris-avatar-token">{initials(thread.name)}<span className="iris-channel-badge" style={{ color: CHANNEL_ACCENT[thread.channel] }}><Icon size={12} /></span></span><span className="iris-thread-copy"><span className="iris-thread-top"><strong>{thread.name}</strong><em>{thread.time || "now"}</em></span><span className="iris-thread-preview">{clampText(thread.preview)}</span><span className="iris-thread-tags"><b className={thread.needsReview ? "warn" : "active"}>{thread.needsReview ? "Needs review" : "Iris active"}</b><b>{thread.category || "lead"}</b>{thread.channel === "voice" && <b>Recording</b>}{thread.messages.some((message) => message.media?.length) && <b>media</b>}</span></span></button>;
}

function ActivityRail({ metricCards, spark, maxSpark, hoverBucket, hoverValue, hoverEvents, events, setHoverBucket, onOpenEvent }: { metricCards: MetricCard[]; spark: number[]; maxSpark: number; hoverBucket: number | null; hoverValue: number | null; hoverEvents: ActivityEvent[]; events: ActivityEvent[]; setHoverBucket: React.Dispatch<React.SetStateAction<number | null>>; onOpenEvent: (event: ActivityEvent) => void }) {
  const total = spark.reduce((sum, value) => sum + value, 0);
  return <aside className="iris-activity-col"><div className="iris-metrics-grid">{metricCards.map((card) => <MetricCardView key={card.label} card={card} />)}</div><section className="iris-activity-chart-card" onMouseLeave={() => setHoverBucket(null)}><div className="iris-section-head"><div><h3>Activity</h3><p>{hoverBucket === null ? `Last ${spark.length} buckets` : `${activityBucketLabel(hoverBucket, spark.length)} activity`}</p></div><span>{hoverBucket === null ? compactMetric(total) : `${hoverValue ?? 0} touches`}</span></div><ActivityBars spark={spark} maxSpark={maxSpark} hoverBucket={hoverBucket} setHoverBucket={setHoverBucket} /><div className="iris-chart-insight">{hoverBucket === null ? <>Peak {compactMetric(maxSpark)} touches. Hover any bar for daily touches.</> : <><b>{hoverValue ?? 0}</b> touches on {activityBucketLabel(hoverBucket, spark.length)}. {hoverEvents[0]?.body ? clampText(hoverEvents[0].body) : "No event attached."}</>}</div></section><section className="iris-recent-card"><div className="iris-section-head"><div><h3>Recent activity</h3><p>Inbound, sends, bookings, transfers, media, CRM</p></div></div><ActivityList events={events.slice(0, 10)} sparkLength={spark.length} setHoverBucket={setHoverBucket} onOpenEvent={onOpenEvent} /></section></aside>;
}

function ConversationPanel({ thread, onBack, contextOpen, onToggleContext, properties }: { thread: UnifiedThread | null; onBack: () => void; contextOpen: boolean; onToggleContext: () => void; properties: Property[] }) {
  const [selectedProperty, setSelectedProperty] = React.useState<PropertyCard | Property | null>(null);
  if (!thread) return <section className="iris-convo-col"><div className="iris-empty big">No active conversation.</div></section>;
  const Icon = CHANNEL_ICON[thread.channel];
  const isVoiceThread = thread.channel === "voice" && Boolean(thread.voiceCalls?.length);
  return <section className="iris-convo-col"><div className="iris-convo-head"><button className="iris-round hide-desktop" onClick={onBack} aria-label="Back to conversations"><ChevronLeft size={17} /></button><button type="button" className="iris-lead-profile-button" onClick={onToggleContext} aria-expanded={contextOpen} aria-label={`${contextOpen ? "Close" : "Open"} lead profile for ${thread.name}`}><span className="iris-avatar-token large">{initials(thread.name)}<span className="iris-channel-badge" style={{ color: CHANNEL_ACCENT[thread.channel] }}><Icon size={13} /></span></span><span className="iris-lead-profile-copy"><strong>{thread.name}</strong><em>{CHANNEL_LABEL[thread.channel]} · {thread.meta || thread.contact}</em></span></button><TakeoverHeaderControl thread={thread} contextOpen={contextOpen} onToggleContext={onToggleContext} /><button className="iris-round iris-context-trigger" onClick={onToggleContext} aria-label={`${contextOpen ? "Close" : "Open"} lead profile`}><UserRound size={17} /></button></div>{isVoiceThread ? <VoiceCallTimeline calls={thread.voiceCalls || []} /> : <MessageTimeline thread={thread} onOpenProperty={setSelectedProperty} />}<ManualReplyComposer thread={thread} /><PropertyDetailModal property={selectedProperty} onClose={() => setSelectedProperty(null)} /></section>;
}

function TakeoverHeaderControl({ thread, contextOpen, onToggleContext }: { thread: UnifiedThread; contextOpen: boolean; onToggleContext: () => void }) {
  const [takenOver, setTakenOver] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => { const controller = new AbortController(); setTakenOver(false); fetch(`/api/threads/${encodeURIComponent(thread.id)}/takeover?channel=${encodeURIComponent(thread.channel)}`, { signal: controller.signal }).then((res) => res.json()).then((data) => setTakenOver(Boolean(data?.isActive))).catch(() => undefined); return () => controller.abort(); }, [thread.id]);
  React.useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; channel?: MessageChannelId; active?: boolean }>).detail;
      if (detail?.threadId === thread.id && (!detail.channel || detail.channel === thread.channel)) setTakenOver(Boolean(detail.active));
    };
    window.addEventListener("iris-takeover-state", onState);
    return () => window.removeEventListener("iris-takeover-state", onState);
  }, [thread.id]);
  const setState = async (action: "take" | "release") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/takeover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, channel: thread.channel }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "Takeover failed.");
      const active = action === "take";
      setTakenOver(active);
      window.dispatchEvent(new CustomEvent("iris-takeover-state", { detail: { threadId: thread.id, channel: thread.channel, active } }));
    } finally {
      setLoading(false);
    }
  };
  return <><button type="button" className={`iris-status-pill ${contextOpen ? "is-open" : ""} ${takenOver ? "is-paused" : ""}`} onClick={onToggleContext} aria-expanded={contextOpen}><img src="/iris-design/iris-avatar.png" alt="" /><span><b>{takenOver ? "Human takeover" : "Iris active"}</b><em>{takenOver ? "AI paused" : "auto-replying"}</em></span><i /></button><button className="iris-soft-btn" onClick={() => setState(takenOver ? "release" : "take")} disabled={loading}>{takenOver ? "Hand back to Iris" : "Take over"}</button></>;
}

function MessageTimeline({ thread, onOpenProperty }: { thread: UnifiedThread; onOpenProperty: (card: PropertyCard | Property) => void }) {
  return <div className="iris-message-scroll"><div className="iris-date-divider">Latest conversation</div>{thread.messages.slice(-12).map((message, index) => { const outbound = isOutbound(message); const cards = "cards" in message ? message.cards : undefined; const hasHtml = Boolean(message.html); const plainBody = message.body && (!hasHtml || message.body.trim() !== message.html?.trim()) ? message.body : ""; const suppressSeparateMedia = hasHtml && messageLooksLikeListingHtml(message); const suppressBodyForMedia = Boolean(message.media?.length && mediaContextOnly(plainBody)); return <div key={message.id || `${thread.id}-${index}`} className={`iris-message-row ${outbound ? "out" : "in"}`}>{outbound && <img className="iris-message-avatar" src="/iris-design/iris-avatar.png" alt="Iris" />}<div className="iris-message-stack"><span className="iris-message-label">{messageLabel(message, thread)} · {message.time}</span>{!suppressBodyForMedia && (plainBody || hasHtml || messageSubject(message)) && <div className={`iris-bubble ${hasHtml ? "has-html" : ""}`}>{messageSubject(message) && <strong>{messageSubject(message)}</strong>}{hasHtml ? <EmailHtmlBlock html={message.html || ""} /> : <p>{clampText(plainBody || messageSubject(message))}</p>}</div>}{message.media?.length && !suppressSeparateMedia ? <MediaStrip media={message.media} /> : null}{cards?.length ? cards.map((card) => <PropertyListingCard key={`${message.id}-${card.address}`} card={card} onOpen={onOpenProperty} />) : null}</div></div>; })}</div>;
}

function VoiceCallTimeline({ calls }: { calls: Call[] }) {
  return <div className="iris-message-scroll iris-voice-scroll"><div className="iris-date-divider">Voice transcript</div>{calls.map((call) => <VoiceCallCard key={call.id} call={call} />)}</div>;
}
function VoiceCallCard({ call }: { call: Call }) {
  const [rawOpen, setRawOpen] = React.useState(false);
  const recordingUrl = voiceRecordingUrl(call.recordingUrl);
  return <article className="iris-voice-call-card"><div className="iris-voice-call-head"><span><Phone size={15} />{call.time} · {call.duration || "recorded"}</span><b>{voiceOutcomeLabel(call.outcome)}</b></div><div className="iris-voice-transcript">{call.turns.map((turn, index) => <div key={`${call.id}-${index}`} className={`iris-voice-turn ${turn.speaker === "Iris" ? "iris" : "lead"}`}><strong>{turn.speaker === "Iris" ? "Iris" : "Lead"}</strong><p>{turn.text}</p></div>)}</div>{call.report && <div className="iris-voice-report"><strong>Call report</strong><span>{call.report}</span></div>}<div className="iris-recording-player"><strong>Recording</strong>{recordingUrl ? <audio controls preload="metadata" src={recordingUrl} /> : <span>No recording available for this call.</span>}{call.recordingUrl && <a href={call.recordingUrl} target="_blank" rel="noreferrer">Open recording</a>}</div><button type="button" className="iris-raw-toggle" onClick={() => setRawOpen((open) => !open)}>{rawOpen ? "Hide raw transcript" : "Raw transcript"}</button>{rawOpen && <pre className="iris-raw-transcript">{call.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n")}</pre>}</article>;
}

function ManualReplyComposer({ thread }: { thread: UnifiedThread }) {
  const model = useInboxModel();
  const [takenOver, setTakenOver] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [drafting, setDrafting] = React.useState(false);
  const [generatingVoice, setGeneratingVoice] = React.useState(false); const [previewingVoice, setPreviewingVoice] = React.useState(false); const [voicePreview, setVoicePreview] = React.useState<VoiceAttachment | null>(null); const [recordingVoice, setRecordingVoice] = React.useState(false); const [recordingSeconds, setRecordingSeconds] = React.useState(0); const mediaRecorderRef = React.useRef<MediaRecorder | null>(null); const recordingChunksRef = React.useRef<Blob[]>([]); const recordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null); const [cloningVoice, setCloningVoice] = React.useState(false);
  const [calling, setCalling] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [voiceText, setVoiceText] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [attachments, setAttachments] = React.useState<VoiceAttachment[]>([]);
  const [voiceProfiles, setVoiceProfiles] = React.useState<VoicePreset[]>(VOICE_PRESETS);
  const [selectedVoiceId, setSelectedVoiceId] = React.useState(loadSelectedVoiceId);
  const [showVoiceTools, setShowVoiceTools] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cloneInputRef = React.useRef<HTMLInputElement>(null);
  const settingsKey = inboxSettingsKey(thread.channel); const channelOn = settingsKey ? model.inboxSettings.channels_enabled[settingsKey] !== false : true; const replyTarget = replyTargetForThread(thread); const canSend = thread.channel !== "website" && Boolean(replyTarget || thread.channel === "email"); const callTarget = /\+?\d[\d\s().-]{7,}/.test(replyTarget || thread.contact) ? (replyTarget || thread.contact) : ""; const canCall = Boolean(callTarget);
  const caps = channelCapabilities(thread, canSend, canCall);
  const selectedVoice = voiceProfiles.find((voice) => voice.id === selectedVoiceId) || VOICE_PRESETS[0];

  React.useEffect(() => setVoiceProfiles([...VOICE_PRESETS, ...loadSavedVoiceProfiles()]), []);
  React.useEffect(() => saveSelectedVoiceId(selectedVoiceId), [selectedVoiceId]);
  React.useEffect(() => { const controller = new AbortController(); setTakenOver(false); setStatus(""); fetch(`/api/threads/${encodeURIComponent(thread.id)}/takeover?channel=${encodeURIComponent(thread.channel)}`, { signal: controller.signal }).then((res) => res.json()).then((data) => setTakenOver(Boolean(data?.isActive))).catch(() => undefined); return () => controller.abort(); }, [thread.id]);
  React.useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; channel?: MessageChannelId; active?: boolean }>).detail;
      if (detail?.threadId === thread.id && (!detail.channel || detail.channel === thread.channel)) setTakenOver(Boolean(detail.active));
    };
    window.addEventListener("iris-takeover-state", onState);
    return () => window.removeEventListener("iris-takeover-state", onState);
  }, [thread.id]);

  const setTakeoverState = async (action: "take" | "release") => { setLoading(true); setStatus(""); try { const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/takeover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, channel: thread.channel }) }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(data.error || (action === "take" ? "Could not take over thread." : "Could not hand back to Iris.")); const active = action === "take"; setTakenOver(active); window.dispatchEvent(new CustomEvent("iris-takeover-state", { detail: { threadId: thread.id, channel: thread.channel, active } })); setStatus(active ? "Human takeover active. Iris is paused for this thread." : "Handed back to Iris. AI replies can resume."); return true; } catch (error) { setStatus(error instanceof Error ? error.message : (action === "take" ? "Could not take over thread." : "Could not hand back to Iris.")); return false; } finally { setLoading(false); } }; const takeOver = async () => setTakeoverState("take"); const releaseToIris = async () => setTakeoverState("release");
  const generateDraft = async () => { setDrafting(true); setStatus(""); try { const latestInbound = [...thread.messages].reverse().find((item) => item.direction === "inbound"); const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: thread.channel, latestMessage: latestInbound?.body || thread.preview }) }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(data.error || "Could not draft reply."); const draftBody = data?.draft?.body || data?.output?.draft || ""; setMessage(draftBody); setVoiceText(draftBody.slice(0, 600)); setStatus(data?.draft?.gmail_draft_id ? "AI draft ready and synced to Gmail draft." : "AI draft ready for review."); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not draft reply."); } finally { setDrafting(false); } };
  const upload = async (files: FileList | null) => { if (!files?.length) return; setLoading(true); setStatus(""); try { const uploaded: VoiceAttachment[] = []; for (const file of Array.from(files)) { const body = new FormData(); body.set("file", file); const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/upload`, { method: "POST", body }); const data = await res.json().catch(() => ({})); if (!res.ok || !data.ok) throw new Error(data.error || `Could not upload ${file.name}`); uploaded.push({ url: data.url, filename: data.filename || file.name, kind: "file" }); } setAttachments((current) => [...current, ...uploaded]); setStatus(`${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"} ready.`); } catch (error) { setStatus(error instanceof Error ? error.message : "Upload failed."); } finally { setLoading(false); if (fileInputRef.current) fileInputRef.current.value = ""; } };
  const generateVoiceNote = async () => { const text = (voiceText || message).trim().slice(0, 600); if (!text || !selectedVoice) { setStatus("Add voice note text first."); return; } setGeneratingVoice(true); setStatus(""); try { const res = await fetch("/api/media/voice-note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: selectedVoice.provider, model: selectedVoice.provider === "deepgram" ? selectedVoice.id : undefined, voiceId: selectedVoice.provider === "cartesia" ? selectedVoice.id : undefined, text, threadRef: thread.id, channel: thread.channel, smsCompatible: ["sms", "whatsapp"].includes(thread.channel) }) }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(data.error || "Could not generate voice note."); setAttachments((current) => [...current, { url: data.url, filename: data.filename || "voice-note.mp3", transcript: text, kind: "voice-note" }]); setStatus(`Generated ${selectedVoice.label} voice note. Review, then send.`); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not generate voice note."); } finally { setGeneratingVoice(false); } };
  const startVoiceRecording = async () => {
    if (recordingVoice) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Microphone recording is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        setRecordingVoice(false);
        const contentType = recorder.mimeType || "audio/webm";
        const blob = new Blob(recordingChunksRef.current, { type: contentType });
        if (!blob.size) {
          setStatus("No microphone audio recorded.");
          return;
        }
        const filename = `recorded-voice-note-${Date.now()}.webm`;
        const file = new File([blob], filename, { type: contentType });
        const localPreviewUrl = URL.createObjectURL(blob);
        setVoicePreview({ url: localPreviewUrl, filename, kind: "voice-note" });
        setStatus("Recording captured. Uploading voice note…");
        try {
          const body = new FormData();
          body.set("file", file);
          const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/upload`, { method: "POST", body });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok) throw new Error(data.error || "Could not upload recorded voice note.");
          const attachment = { url: data.url, filename: data.filename || filename, kind: "voice-note" as const, transcript: "Recorded microphone voice note" };
          setAttachments((current) => [...current, attachment]);
          setVoicePreview({ url: data.url, filename: attachment.filename, kind: "voice-note" });
          setStatus("Recorded voice note uploaded and attached. Review, then send.");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Recorded voice note upload failed.");
        }
      };
      recorder.start();
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
      setRecordingVoice(true);
      setStatus("Recording microphone…");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Microphone permission denied.");
    }
  }; const stopVoiceRecording = () => { mediaRecorderRef.current?.stop(); }; const previewVoice = async () => { setPreviewingVoice(true); setStatus(""); setVoicePreview(null); try { const text = (voiceText || message || "Hi, this is Iris from Austin Realty. I can send the listing details, answer quick questions, or help book a showing when you are ready.").trim().slice(0, 600); const res = await fetch("/api/media/voice-note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: selectedVoice.provider, voiceId: selectedVoice.provider === "deepgram" ? selectedVoice.id : undefined, referenceId: selectedVoice.provider === "cartesia" ? selectedVoice.id : undefined, text, threadRef: thread.id, channel: thread.channel, smsCompatible: ["sms", "whatsapp"].includes(thread.channel) }) }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(data.error || "Could not preview voice."); setVoicePreview({ url: data.url, filename: data.filename || "voice-preview.mp3", kind: "voice-note" }); setStatus(`Preview ready: ${selectedVoice.label}.`); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not preview voice."); } finally { setPreviewingVoice(false); } }; const resetClonedVoices = () => { saveVoiceProfiles([]); setVoiceProfiles([...VOICE_PRESETS]); setSelectedVoiceId(VOICE_PRESETS[0]?.id || "aura-2-thalia-en"); setVoicePreview(null); setStatus("Cloned voices reset. Provider voices restored."); }; const cloneVoice = async (files: FileList | null) => { if (!files?.length) return; setCloningVoice(true); setStatus(""); try { const body = new FormData(); body.set("title", `Cloned voice ${new Date().toLocaleDateString()}`); body.set("file", files[0]); const res = await fetch("/api/media/voice-clone", { method: "POST", body }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(data.error || "Could not clone voice."); const saved = loadSavedVoiceProfiles(); const profile: VoicePreset = { id: data.voiceId, label: data.title || "Cloned voice", provider: "cartesia", gender: "custom", style: data.state || "cloned", cloned: true }; const nextSaved = [profile, ...saved.filter((voice) => voice.id !== profile.id)].slice(0, 12); saveVoiceProfiles(nextSaved); setVoiceProfiles([...VOICE_PRESETS, ...nextSaved]); setSelectedVoiceId(profile.id); setStatus("Cloned voice saved. Select it, generate a voice note, then approve send."); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not clone voice."); } finally { setCloningVoice(false); if (cloneInputRef.current) cloneInputRef.current.value = ""; } };
  const callLead = async () => { if (!canCall || calling) return; setCalling(true); setStatus(""); try { const res = await fetch("/api/voice/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: callTarget, leadName: thread.name, callReason: "Dashboard manual call", leadContext: thread.messages.slice(-6).map((item) => `${item.direction}: ${item.body || item.html || ""}`).join("\n") || thread.preview, sourceThreadId: thread.id, channel: thread.channel }) }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(data.error || "Could not start call."); setStatus(data.callId ? `Call started: ${data.callId}` : "Call started."); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not start call."); } finally { setCalling(false); } };
  const send = async () => { const body = message.trim(); if ((!body && !attachments.length) || sending || !canSend) return; if (!takenOver) { const active = await takeOver(); if (!active) return; } setSending(true); setStatus(""); try { const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: thread.channel, to: replyTarget || thread.contact, subject: thread.subject, body, mediaUrls: attachments.map((attachment) => attachment.url), mediaTranscripts: attachments.filter((attachment) => attachment.transcript).map((attachment) => ({ url: attachment.url, text: attachment.transcript })) }) }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(data.error || "Message did not send."); setMessage(""); setVoiceText(""); setAttachments([]); setTakenOver(true); window.dispatchEvent(new CustomEvent("iris-takeover-state", { detail: { threadId: thread.id, channel: thread.channel, active: true } })); setStatus("Sent."); } catch (error) { setStatus(error instanceof Error ? error.message : "Message did not send."); } finally { setSending(false); } };

  return <div className="iris-composer"><div className="iris-draft-head"><span><img src="/iris-design/iris-avatar.png" alt="" />{takenOver ? "Manual reply" : thread.channel === "voice" ? "Voice actions" : "Iris draft"}</span><em>{!channelOn ? "channel disabled in settings" : canSend ? `${channelOn ? "via" : "manual via"} ${CHANNEL_LABEL[thread.channel]}` : thread.channel === "voice" ? "call controls" : "reply target missing"}</em></div>{caps.textReply && <textarea value={message} onChange={(event) => setMessage(event.target.value)} onPaste={(event) => upload(event.clipboardData.files)} placeholder={canSend ? (!channelOn ? "AI disabled in Settings. Manual takeover/send still available." : "Write reply or generate an AI draft.") : "Cannot send from thread until provider recipient is available."} disabled={!canSend || sending} />}{showVoiceTools && caps.voiceNote && <div className="iris-voice-tools"><div className="iris-voice-row"><label>Voice</label><select value={selectedVoiceId} onChange={(event) => setSelectedVoiceId(event.target.value)}>{voiceProfiles.map((voice) => <option key={`${voice.provider}-${voice.id}`} value={voice.id}>{voice.label} · {voice.provider}{voice.cloned ? " · cloned" : ""}</option>)}</select></div><textarea value={voiceText} onChange={(event) => setVoiceText(event.target.value.slice(0, 600))} placeholder="Voice note script. Defaults to reply draft. 600 char max." /><div className="iris-voice-actions"><input ref={cloneInputRef} type="file" accept="audio/*,video/webm" hidden onChange={(event) => cloneVoice(event.target.files)} /><button type="button" onClick={recordingVoice ? stopVoiceRecording : startVoiceRecording}>{recordingVoice ? `Stop recording (${recordingSeconds}s)` : "Record mic"}</button><button type="button" onClick={previewVoice} disabled={previewingVoice}>{previewingVoice ? "Previewing…" : "Preview voice"}</button><button type="button" onClick={generateVoiceNote} disabled={generatingVoice || !canSend}>{generatingVoice ? "Generating…" : "Generate voice note"}</button><button type="button" onClick={() => cloneInputRef.current?.click()} disabled={cloningVoice}>{cloningVoice ? "Cloning…" : "Clone voice"}</button><button type="button" onClick={resetClonedVoices}>Reset clones</button><span>Deepgram provider voices + saved Cartesia clones. Preview never sends.</span></div>{voicePreview && <div className="iris-voice-preview"><strong>{selectedVoice.label} preview</strong><audio controls src={voicePreview.url} /><a href={voicePreview.url} target="_blank" rel="noreferrer">Open audio</a></div>}</div>}{attachments.length > 0 && <div className="iris-attachment-row">{attachments.map((attachment) => <span key={attachment.url}>{attachment.kind === "voice-note" ? "Voice " : ""}{attachment.filename}</span>)}</div>}{status && <p className="iris-composer-status">{status}</p>}<div className="iris-composer-actions"><input ref={fileInputRef} type="file" multiple hidden onChange={(event) => upload(event.target.files)} />{caps.attach && <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || !canSend}>Attach media</button>}<button type="button" onClick={takenOver ? releaseToIris : takeOver} disabled={loading}>{takenOver ? "Hand back to Iris" : "Take over"}</button>{caps.call && <button type="button" onClick={callLead} disabled={calling}>{calling ? "Calling…" : "Call lead"}</button>}{caps.draft && <button type="button" onClick={generateDraft} disabled={drafting || !canSend}>{drafting ? "Drafting…" : "AI draft"}</button>}{caps.voiceNote && <button type="button" onClick={() => { setShowVoiceTools((open) => !open); if (!voiceText) setVoiceText(message.slice(0, 600)); }}>Voice note</button>}{caps.textReply && <button type="button" className="primary" onClick={send} disabled={!canSend || sending || (!message.trim() && !attachments.length)}>{sending ? "Sending…" : "Send reply"}</button>}</div></div>;
}

function OverviewPanel({ model, spark, maxSpark, hoverBucket, hoverValue, hoverEvents, setHoverBucket, metricCards, onOpenEvent }: { model: ReturnType<typeof useInboxModel>; spark: number[]; maxSpark: number; hoverBucket: number | null; hoverValue: number | null; hoverEvents: ActivityEvent[]; setHoverBucket: React.Dispatch<React.SetStateAction<number | null>>; metricCards: MetricCard[]; onOpenEvent: (event: ActivityEvent) => void }) {
  const total = spark.reduce((sum, value) => sum + value, 0);
  return <section className="iris-wide-panel iris-overview-panel"><PanelTitle icon={ActivityGlyph} title="Overview" subtitle="Agent activity, actual outcomes, channel quality, and recent movement" /><div className="iris-overview-grid"><div className="iris-overview-main"><div className="iris-metrics-grid iris-overview-metrics">{metricCards.map((card, index) => <MetricCardView key={card.label} card={card} spark={spark.map((v, i) => Math.max(0, v - ((index + i) % 3)))} />)}</div><section className="iris-activity-chart-card iris-overview-chart" onMouseLeave={() => setHoverBucket(null)}><div className="iris-section-head"><div><h3>Activity · 14 days</h3><p>{hoverBucket === null ? `Peak ${model.metrics.peakDay || "recent"} · ${compactMetric(model.metrics.peakCount || maxSpark)} touches` : `${activityBucketLabel(hoverBucket, spark.length)} touch count`}</p></div><span>{hoverBucket === null ? `${compactMetric(total)} touches` : `${hoverValue ?? 0} touches`}</span></div><ActivityBars spark={spark} maxSpark={maxSpark} hoverBucket={hoverBucket} setHoverBucket={setHoverBucket} big /><div className="iris-chart-insight">{hoverBucket === null ? <>Live overview across inbound, Iris replies, human reviews, bookings, transfers, retries, media, and CRM events. Hover a bar to replay daily touches like Inbox MUI.</> : <><b>{hoverValue ?? 0}</b> touches on {activityBucketLabel(hoverBucket, spark.length)}. {hoverEvents[0]?.body ? clampText(hoverEvents[0].body) : "No detailed event attached."}</>}</div></section><section className="iris-quality-grid">{model.channelQuality.map((item) => <div key={item.channel}><strong>{item.label}</strong><span>{item.quality}% quality</span><em>{item.replies}/{item.inbound} replies · {item.media} media · {item.review} review</em></div>)}</section></div><section className="iris-recent-card iris-overview-feed"><div className="iris-section-head"><div><h3>Recent activity</h3><p>Inbound, sends, bookings, transfers, media, CRM</p></div></div><ActivityList events={model.activityEvents.slice(0, 14)} sparkLength={spark.length} setHoverBucket={setHoverBucket} onOpenEvent={onOpenEvent} /></section></div></section>;
}

function MetricCardView({ card, spark }: { card: MetricCard; spark?: number[] }) {
  const Icon = card.icon;
  return <article className={`iris-metric-card tone-${card.tone}`}><span><Icon size={15} /></span><p>{card.label}</p><strong>{compactMetric(card.value)}</strong><em>{card.help}</em>{spark && <MiniTrend spark={spark} />}</article>;
}
function MiniTrend({ spark }: { spark: number[] }) {
  const { ref, playKey } = useReplayKey(true);
  const max = Math.max(1, ...spark);
  const points = spark.map((value, index) => ({
    x: (index / Math.max(1, spark.length - 1)) * 100,
    y: 24 - Math.max(2, (value / max) * 22),
  }));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = `${line} L 100 26 L 0 26 Z`;
  return (
    <div ref={ref} key={playKey} className="iris-mini-trend-wrap" aria-hidden="true">
      <svg className="iris-mini-trend" viewBox="0 0 100 26" preserveAspectRatio="none">
        <path className="iris-mini-trend-fill" d={area} />
        <path className="iris-mini-trend-line" d={line} />
      </svg>
    </div>
  );
}
function ActivityBars({ spark, maxSpark, hoverBucket, setHoverBucket, big = false }: { spark: number[]; maxSpark: number; hoverBucket: number | null; setHoverBucket: React.Dispatch<React.SetStateAction<number | null>>; big?: boolean }) {
  const { ref, playKey } = useReplayKey(true);
  return <div ref={ref} key={playKey} className={`iris-bars ${big ? "big" : ""}`} role="img" aria-label="Agent activity bar chart">{spark.map((value, index) => { const hot = hoverBucket === index; const neighbor = hoverBucket !== null && Math.abs(hoverBucket - index) === 1; return <button key={`${index}-${value}`} className={`${hot ? "is-hot" : ""} ${neighbor ? "is-neighbor" : ""}`} style={{ height: `${Math.max(8, (value / maxSpark) * 100)}%`, animationDelay: `${index * 35}ms` }} onMouseEnter={() => setHoverBucket(index)} onFocus={() => setHoverBucket(index)} aria-label={`${activityBucketLabel(index, spark.length)}: ${value} touches`}><span className="iris-bar-tooltip">{value} touches</span><small>{activityBucketLabel(index, spark.length, true)}</small></button>; })}</div>;
}
function ActivityList({ events, sparkLength, setHoverBucket, onOpenEvent }: { events: ActivityEvent[]; sparkLength: number; setHoverBucket: React.Dispatch<React.SetStateAction<number | null>>; onOpenEvent: (event: ActivityEvent) => void }) {
  return <div className="iris-activity-list">{events.map((event, index) => { const Icon = eventIcon(event); return <button key={event.id || `${event.threadId}-${index}`} onClick={() => onOpenEvent(event)} onMouseEnter={() => setHoverBucket(index % sparkLength)} onFocus={() => setHoverBucket(index % sparkLength)}><span className={`iris-event-dot kind-${event.kind}`}><Icon size={13} /></span><span><strong>{eventKindLabel(event)}</strong><em>{event.actor} · {CHANNEL_LABEL[event.channel]} · {event.time}</em><b>{clampText(event.body)}</b></span><i>{event.status || (event.kind === "inbound" ? "Inbound" : "Done")}</i></button>; })}{!events.length && <div className="iris-empty">No activity events loaded.</div>}</div>;
}

function PropertiesPanel({ properties, propertyHealth }: { properties: Property[]; propertyHealth: { score: number; total: number; clean: string; missingCore: number; duplicateGroups: number } }) { const [selectedProperty, setSelectedProperty] = React.useState<Property | null>(null); return <section className="iris-wide-panel"><PanelTitle icon={Building2} title="Properties" subtitle={`${propertyHealth.clean} · ${propertyHealth.total || properties.length} active rows`} /><div className="iris-wide-grid">{properties.map((property) => <PropertyListingCard key={property.id || property.address} card={property} onOpen={(card) => setSelectedProperty(card as Property)} />)}</div>{!properties.length && <div className="iris-empty big">No property inventory loaded.</div>}<PropertyDetailModal property={selectedProperty} onClose={() => setSelectedProperty(null)} /></section>; }
function SettingsPanel({ model }: { model: ReturnType<typeof useInboxModel> }) {
  const { status, error, refresh } = useChannelConnectionStatus(true);
  const [draftFirst, setDraftFirst] = React.useState(model.inboxSettings.draft_first);
  const [autoSend, setAutoSend] = React.useState<InboxSettings["auto_send"]>({ ...model.inboxSettings.auto_send });
  const [channelsEnabled, setChannelsEnabled] = React.useState<InboxSettings["channels_enabled"]>({ ...model.inboxSettings.channels_enabled });
  const [categoriesEnabled, setCategoriesEnabled] = React.useState<Record<string, boolean>>(() => Object.fromEntries(model.leadCategories.map((category) => [category.id, category.enabled !== false])));
  const [saving, setSaving] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [calendarSyncing, setCalendarSyncing] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [voiceProfiles, setVoiceProfiles] = React.useState<VoicePreset[]>(VOICE_PRESETS);
  const [selectedVoiceId, setSelectedVoiceId] = React.useState(loadSelectedVoiceId);
  const [voiceText, setVoiceText] = React.useState("Hi, this is Iris with Austin Realty. I can send matching homes here or book a showing.");
  const [voiceStatus, setVoiceStatus] = React.useState("");
  const [voiceSampleUrl, setVoiceSampleUrl] = React.useState("");
  const [generatingVoice, setGeneratingVoice] = React.useState(false);
  const [cloningVoice, setCloningVoice] = React.useState(false);
  const cloneInputRef = React.useRef<HTMLInputElement>(null);
  const selectedVoice = voiceProfiles.find((voice) => voice.id === selectedVoiceId) || VOICE_PRESETS[0];

  React.useEffect(() => {
    setDraftFirst(model.inboxSettings.draft_first);
    setAutoSend({ ...model.inboxSettings.auto_send });
    setChannelsEnabled({ ...model.inboxSettings.channels_enabled });
    setCategoriesEnabled(Object.fromEntries(model.leadCategories.map((category) => [category.id, category.enabled !== false])));
  }, [model.inboxSettings, model.leadCategories]);
  React.useEffect(() => setVoiceProfiles([...VOICE_PRESETS, ...loadSavedVoiceProfiles()]), []);
  React.useEffect(() => saveSelectedVoiceId(selectedVoiceId), [selectedVoiceId]);

  const setAuto = (key: keyof InboxSettings["auto_send"], value: boolean) => setAutoSend((current) => ({ ...current, [key]: value }));
  const setEnabled = (key: keyof InboxSettings["channels_enabled"], value: boolean) => setChannelsEnabled((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/inbox", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: { draft_first: draftFirst, auto_send: autoSend, channels_enabled: channelsEnabled }, categories: model.leadCategories.map((category, index) => ({ slug: category.slug || category.id.replace(/-/g, "_"), name: category.label, color: category.color, sort_order: (index + 1) * 10, enabled: categoriesEnabled[category.id] !== false, gmail_label_name: category.gmailLabelName || `Iris/${category.label}`, auto_rules: { ...(category.autoRules || {}), tier: category.tier || "status" } })) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `Settings save failed (${res.status})`);
      setMessage("Settings saved. Refresh data if you need the counts to reload.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings did not save.");
    } finally {
      setSaving(false);
    }
  };
  const syncConnections = async () => {
    setSyncing(true);
    setMessage("");
    try {
      await refresh({ sync: true, force: true });
      setMessage("Connections refreshed from providers.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection refresh failed.");
    } finally {
      setSyncing(false);
    }
  };
  const syncCalendars = async () => {
    setCalendarSyncing(true);
    setMessage("");
    try {
      const res = await fetch("/api/calendar/sync/full", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data?.summary?.errors?.join("; ") || data.error || "Calendar sync failed.");
      setMessage(`Calendar sync complete. ${data.summary?.connections || 0} connections, ${data.summary?.itemsWritten || 0} events written.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calendar sync failed.");
    } finally {
      setCalendarSyncing(false);
    }
  };
  const generateVoicePreview = async () => {
    const text = voiceText.trim().slice(0, 600);
    if (!text || !selectedVoice) { setVoiceStatus("Add preview text first."); return; }
    setGeneratingVoice(true);
    setVoiceStatus("");
    setVoiceSampleUrl("");
    try {
      const res = await fetch("/api/media/voice-note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: selectedVoice.provider, model: selectedVoice.provider === "deepgram" ? selectedVoice.id : undefined, voiceId: selectedVoice.provider === "cartesia" ? selectedVoice.id : undefined, text, threadRef: "voice-settings-preview" }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "Could not generate voice preview.");
      setVoiceSampleUrl(data.url || "");
      setVoiceStatus(`Generated ${selectedVoice.label} preview.`);
    } catch (error) {
      setVoiceStatus(error instanceof Error ? error.message : "Could not generate voice preview.");
    } finally {
      setGeneratingVoice(false);
    }
  };
  const cloneVoice = async (files: FileList | null) => {
    if (!files?.length) return;
    setCloningVoice(true);
    setVoiceStatus("");
    try {
      const body = new FormData();
      body.set("title", `Austin Realty cloned voice ${new Date().toLocaleDateString()}`);
      body.set("file", files[0]);
      const res = await fetch("/api/media/voice-clone", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "Could not clone voice.");
      const profile: VoicePreset = { id: data.voiceId, label: data.title || "Cloned voice", provider: "cartesia", gender: "custom", style: data.state || "cloned", cloned: true };
      const saved = [profile, ...loadSavedVoiceProfiles().filter((voice) => voice.id !== profile.id)].slice(0, 12);
      saveVoiceProfiles(saved);
      setVoiceProfiles([...VOICE_PRESETS, ...saved]);
      setSelectedVoiceId(profile.id);
      setVoiceStatus("Cloned voice saved. Select it and generate a preview before using in replies.");
    } catch (error) {
      setVoiceStatus(error instanceof Error ? error.message : "Could not clone voice.");
    } finally {
      setCloningVoice(false);
      if (cloneInputRef.current) cloneInputRef.current.value = "";
    }
  };

  return <section className="iris-wide-panel"><PanelTitle icon={Settings} title="Settings" subtitle="Workspace, channels, OAuth redirects, voice, and takeover controls" /><div className="iris-settings-stack"><section className="iris-settings-card iris-settings-card-wide"><div className="iris-settings-card-head"><div><strong>Channel connections</strong><span>Product path: Google Calendar and Outlook Calendar sync through Composio. Gmail uses native OAuth; Outlook mail uses real-time Composio triggers. Social channels use direct Meta webhooks.</span></div><button type="button" onClick={syncConnections} disabled={syncing}>{syncing ? "Refreshing…" : "Refresh"}</button></div>{error && <p className="iris-settings-warning">{error}</p>}<div className="iris-connection-grid">{SETTINGS_CONNECTIONS.map((item) => <ConnectionTile key={item.id} item={item} status={status} />)}</div></section><section className="iris-settings-card"><strong>Calendar sync</strong><span>Connect Google or Outlook through Composio, then sync all calendars and events into the dashboard.</span><div className="iris-settings-actions"><a href="/api/calendar/connect/google">Connect Google Calendar</a><a href="/api/calendar/connect/outlook">Connect Outlook Calendar</a><button type="button" onClick={syncCalendars} disabled={calendarSyncing}>{calendarSyncing ? "Syncing…" : "Sync all calendars"}</button></div></section><section className="iris-settings-card iris-settings-card-wide"><strong>Voice generation</strong><span>Cheapest default is Deepgram Aura. Use Cartesia only for cloned voices or when the chosen custom voice is needed.</span><div className="iris-voice-settings-grid"><label><b>Voice</b><select value={selectedVoiceId} onChange={(event) => setSelectedVoiceId(event.target.value)}>{voiceProfiles.map((voice) => <option key={`${voice.provider}-${voice.id}`} value={voice.id}>{voice.label} · {voice.provider}{voice.cloned ? " · cloned" : ""} · {voice.style}</option>)}</select></label><label><b>Preview script</b><textarea value={voiceText} onChange={(event) => setVoiceText(event.target.value.slice(0, 600))} /></label></div><div className="iris-settings-actions"><input ref={cloneInputRef} type="file" accept="audio/*,video/webm" hidden onChange={(event) => cloneVoice(event.target.files)} /><button type="button" onClick={generateVoicePreview} disabled={generatingVoice}>{generatingVoice ? "Generating…" : "Generate preview"}</button><button type="button" onClick={() => cloneInputRef.current?.click()} disabled={cloningVoice}>{cloningVoice ? "Cloning…" : "Upload clone sample"}</button>{voiceStatus && <em>{voiceStatus}</em>}</div>{voiceSampleUrl && <audio controls preload="metadata" src={voiceSampleUrl} />}</section><section className="iris-settings-card iris-settings-card-wide"><strong>Reply automation</strong><span>Choose one mode per client. Sensitive, uncertain, and compliance messages always stop for human review.</span><div className="iris-reply-mode-grid"><button type="button" className={draftFirst ? "is-selected" : ""} onClick={() => setDraftFirst(true)}><b>Draft first</b><em>Human approves every reply</em></button><button type="button" className={!draftFirst ? "is-selected" : ""} onClick={() => setDraftFirst(false)}><b>Auto-send</b><em>Safe replies send instantly</em></button></div><div className="iris-settings-actions"><button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>{message && <em>{message}</em>}</div></section><section className="iris-settings-card iris-settings-card-wide"><strong>Inbox workflow</strong><span>Statuses answer who acts next. Topic tags describe the conversation. All enabled labels sync to Gmail.</span><div className="iris-workflow-groups">{([['Workflow status', 'One active status per conversation', model.leadCategories.filter((category) => category.tier !== 'topic')], ['Topic tags', 'Stackable intent and reporting filters', model.leadCategories.filter((category) => category.tier === 'topic')]] as const).map(([title, detail, categories]) => <div key={title}><div className="iris-workflow-head"><b>{title}</b><em>{detail}</em></div><div className="iris-workflow-list">{categories.map((category) => <label key={category.id} className="iris-workflow-row"><i style={{ background: category.color }} /><span><b>{category.label}</b><em>{category.gmailLabelName || `Iris/${category.label}`}</em></span><input aria-label={`${category.label} enabled`} type="checkbox" checked={categoriesEnabled[category.id] !== false} onChange={(event) => setCategoriesEnabled((current) => ({ ...current, [category.id]: event.target.checked }))} /></label>)}</div></div>)}</div></section><section className="iris-settings-card"><strong>Auto-send per channel</strong><span>Controls whether Iris can send without review when draft-first is off.</span><div className="iris-toggle-grid">{AUTO_SEND_SETTINGS.map(([key, label]) => <SettingsToggle key={key} label={label} help="Auto-send" checked={autoSend[key] !== false} onChange={(value) => setAuto(key, value)} />)}</div></section><section className="iris-settings-card"><strong>Channel availability</strong><span>Turn off AI handling for any inbound channel. Voice provider status stays separate.</span><div className="iris-toggle-grid">{CHANNEL_ENABLE_SETTINGS.map(([key, label]) => <SettingsToggle key={key} label={label} help="AI available" checked={channelsEnabled[key] !== false} onChange={(value) => setEnabled(key, value)} />)}</div></section><section className="iris-settings-card"><strong>Session</strong><span>Leave dashboard and return to login.</span><button type="button" onClick={() => signOut({ callbackUrl: "/login" })}>Log out</button></section></div></section>;
}
function ConnectionTile({ item, status }: { item: SettingsConnection; status: ConnectionStatus | null }) {
  const display = displayForChannelConnection(status, item.channel, "", "");
  const channelStatus = status?.channels?.[item.channel];
  const raw = display.connection || channelStatus?.connections?.[0];
  const ready = item.envOnly ? Boolean(channelStatus?.connected || raw?.status === "connected") : display.ready || Boolean(channelStatus?.connected);
  const detail = display.value && display.value !== "Not connected" ? display.value : raw?.health_reason || item.detail;
  return <div className={`iris-connection-tile ${ready ? "is-ready" : ""}`}><div><span style={{ color: item.accent }}><item.icon size={16} /></span><strong>{item.label}</strong><em>{ready ? "Ready" : "Setup needed"}</em></div><p>{detail}</p><div>{item.urls.map((url) => <a key={url.href} href={url.href}>{url.label}</a>)}</div></div>;
}

function SettingsToggle({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className={`iris-toggle ${checked ? "is-on" : ""}`}><span><b>{label}</b><em>{help}</em></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}
function AppointmentsPanel({ events, metrics }: { events: ActivityEvent[]; metrics: { appointments: number; liveTransfers: number } }) { const appointmentEvents = events.filter((event) => /appoint|book|showing|tour|transfer/i.test(`${event.intent} ${event.body}`)); return <section className="iris-wide-panel"><PanelTitle icon={CalendarDays} title="Appointments & transfers" subtitle="Live Calendar OS view synced from connected Google and Outlook calendars" /><div className="iris-mini-metrics"><div><span>Booked appointments</span><b>{metrics.appointments}</b></div><div><span>Qualified transfers</span><b>{metrics.liveTransfers}</b></div></div><div className="iris-appointments-calendar-shell"><CalendarOsView /></div><ActivityTable events={appointmentEvents} empty="No booked appointment or transfer events loaded." /></section>; }
function ContactsPanel({ threads }: { threads: UnifiedThread[] }) { return <section className="iris-wide-panel"><PanelTitle icon={UsersRound} title="Contacts" subtitle="Unified identity across email, SMS, social, voice, and web" /><div className="iris-table-card">{threads.slice(0, 16).map((thread) => <div key={`${thread.channel}-${thread.id}`}><span className="iris-avatar-token">{initials(thread.name)}</span><b>{thread.name}</b><em>{CHANNEL_LABEL[thread.channel]}</em><p>{thread.preview}</p></div>)}</div></section>; }
function ImportsPanel({ reviewQueue }: { reviewQueue: Array<{ id: string; contact: string; reason: string; intent: string; receivedAt: string }> }) { return <section className="iris-wide-panel"><PanelTitle icon={Workflow} title="CRM & imports" subtitle="GHL-style lead capture, review queue, and CRM sync surface" /><div className="iris-crm-cloud">{["GHL / HighLevel", "Follow Up Boss", "kvCORE", "Lofty", "HubSpot", "Salesforce", "Pipedrive", "CSV", "Other"].map((crm) => <span key={crm}>{crm}</span>)}</div><div className="iris-table-card">{reviewQueue.slice(0, 12).map((item) => <div key={item.id}><span className="iris-event-dot kind-note"><CircleAlert size={13} /></span><b>{item.contact}</b><em>{item.intent}</em><p>{item.reason} · {item.receivedAt}</p></div>)}</div></section>; }
function OpsPanel({ events, channelQuality }: { events: ActivityEvent[]; channelQuality: Array<{ channel: MessageChannelId; label: string; inbound: number; replies: number; media: number; review: number; quality: number }> }) { return <section className="iris-wide-panel"><PanelTitle icon={Database} title="Ops log / audit" subtitle="Webhook events, AI actions, sends, retries, media, and quality" /><div className="iris-quality-grid">{channelQuality.map((item) => <div key={item.channel}><strong>{item.label}</strong><span>{item.quality}% quality</span><em>{item.replies}/{item.inbound} replies · {item.media} media · {item.review} review</em></div>)}</div><ActivityTable events={events} empty="No ops events loaded." /></section>; }
function ActivityTable({ events, empty }: { events: ActivityEvent[]; empty: string }) { return <div className="iris-ops-table">{events.slice(0, 18).map((event) => <div key={event.id}><span>{event.time}</span><b>{eventKindLabel(event)}</b><em>{CHANNEL_LABEL[event.channel]}</em><p>{event.actor}</p><i>{event.status || "Recorded"}</i></div>)}{!events.length && <div className="iris-empty big">{empty}</div>}</div>; }
function PanelTitle({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ size?: number }>; title: string; subtitle: string }) { return <div className="iris-panel-title"><span><Icon size={20} /></span><div><h1>{title}</h1><p>{subtitle}</p></div></div>; }
function ContextPanel({ open, thread, events, metrics, properties, onClose }: { open: boolean; thread: UnifiedThread | null; events: ActivityEvent[]; metrics: { appointments: number; liveTransfers: number; qualifiedLeads: number }; properties: Property[]; onClose: () => void }) { const relevantEvents = events.filter((event) => !thread || event.threadId === thread.id || event.threadRef === thread.id).slice(0, 4); return <aside className={`iris-context-col ${open ? "is-open" : ""}`}><button className="iris-round iris-context-close" onClick={onClose} aria-label="Close lead profile"><X size={16} /></button><div className="iris-context-person"><span className="iris-avatar-token large">{initials(thread?.name || "Austin Realty")}</span><div><strong>{thread?.name || "No lead selected"}</strong><span>{thread?.category || "Lead profile"}</span></div></div><span className="iris-hot-chip">Qualification live</span><div className="iris-context-grid"><div><span>Appointments</span><b>{metrics.appointments}</b></div><div><span>Transfers</span><b>{metrics.liveTransfers}</b></div><div><span>Qualified</span><b>{metrics.qualifiedLeads}</b></div><div><span>Inventory</span><b>{properties.length}</b></div></div><section><h3>Next follow-up</h3><div className="iris-follow-card"><Clock3 size={18} /><div><strong>Cadence guarded</strong><span>Stops on reply, opt-out, booked, or human takeover.</span></div></div></section><section><h3>Latest signals</h3><div className="iris-mini-feed">{relevantEvents.length ? relevantEvents.map((event) => <p key={event.id}><b>{eventKindLabel(event)}</b><span>{clampText(event.body)}</span></p>) : <p><span>No matched events yet. Waiting for webhook.</span></p>}</div></section></aside>; }

function MediaStrip({ media }: { media: NonNullable<UnifiedMessage["media"]> }) {
  const items = media.filter(Boolean);
  if (!items.length) return null;
  return <div className={`iris-media-strip ${items.length > 1 ? "is-carousel" : ""}`}>{items.map((item, index) => {
    const targetUrl = item.linkUrl || item.url || "";
    const thumb = mediaThumb(item);
    const caption = cleanMediaCaption(item.transcript || item.alt || item.label || "");
    const label = mediaLabel(item.label || item.alt || item.kind || "media");
    const host = linkHost(targetUrl);
const isAudio = (item.kind || "") === "audio" || isAudioMediaUrl(targetUrl || item.url);
 if (isAudio) return <VoiceNotePlayer key={`${item.url}-${index}`} url={targetUrl || item.url} label={label} caption={caption} />;
     return <a key={`${item.url}-${index}`} href={targetUrl || item.url} target="_blank" rel="noreferrer" className={`iris-media-card ${thumb ? "has-thumb" : "caption-only"}`} aria-label={`Open ${label}${host ? ` on ${host}` : ""}`}>
      {thumb && <span className="iris-media-visual"><img src={thumb} alt={caption || label} loading="lazy" onError={(event) => { event.currentTarget.closest(".iris-media-card")?.classList.add("is-missing-thumb"); }} /></span>}
      <span className="iris-media-copy"><b>{label}</b>{host && <small>{host}</small>}{caption && <em>{caption}</em>}</span>
    </a>;
  })}</div>;
}
function VoiceNotePlayer({ url, label, caption }: { url: string; label: string; caption: string }) {
 const audioRef = React.useRef<HTMLAudioElement>(null);
 const [playing, setPlaying] = React.useState(false);
 const [duration, setDuration] = React.useState(0);
 const toggle = async () => {
 const audio = audioRef.current;
 if (!audio) return;
 if (playing) { audio.pause(); setPlaying(false); return; }
 await audio.play();
 setPlaying(true);
 };
 return <div className={`iris-voice-note-bubble ${playing ? "is-playing" : ""}`}><button type="button" onClick={toggle} aria-label={`${playing ? "Pause" : "Play"} ${label}`}><span className="iris-voice-play">{playing ? "Ⅱ" : "▶"}</span><span className="iris-waveform" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ height: `${34 + ((i * 17) % 52)}%` }} />)}</span><span className="iris-voice-duration">{formatVoiceDuration(duration)}</span></button><audio ref={audioRef} src={url} preload="metadata" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} /><a href={url} target="_blank" rel="noreferrer">{label}</a>{caption && <em>{caption}</em>}</div>;
}

function mediaThumb(item: NonNullable<UnifiedMessage["media"]>[number]) {
  if (item.thumbnailUrl) return item.thumbnailUrl;
  if ((item.kind || "") === "image" && renderableImageUrl(item.url)) return item.url;
  const target = item.linkUrl || item.url || "";
  if (isInstagramMediaUrl(target)) return `/api/media/instagram-preview?url=${encodeURIComponent(target)}`;
  return undefined;
}
function isAudioMediaUrl(value: string) { return /\.(?:aac|caf|m4a|mp3|mpeg|oga|ogg|opus|wav|webm)(?:$|[?#])/i.test(value || "") || /(?:audio|voice-note|voice_note)/i.test(value || ""); }
function formatVoiceDuration(value: number) { if (!Number.isFinite(value) || value <= 0) return "0:07"; const seconds = Math.max(1, Math.round(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function renderableImageUrl(value: string) {
  return /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(value) || /(?:lookaside\.fbsbx\.com|fbcdn\.net|cdninstagram\.com)/i.test(value);
}
function isInstagramMediaUrl(value: string) {
  return /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv|stories)\//i.test(value.trim());
}
function cleanMediaCaption(value: string) {
  return String(value || "")
    .replace(/^Attachment context:\s*/i, "")
    .replace(/Treat it as context for the current real estate conversation;?.*$/i, "")
    .replace(/if content is inaccessible,? ask one short clarifying question instead of ignoring it\.?/i, "")
    .replace(/\s+Attachment\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mediaLabel(value: string) {
  const label = String(value || "media").trim();
  if (/instagram.*reel/i.test(label)) return "Instagram reel";
  if (/instagram.*post/i.test(label)) return "Instagram post";
  return label;
}

function linkHost(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function PropertyListingCard({ card, onOpen }: { card: PropertyCard | Property; onOpen?: (card: PropertyCard | Property) => void }) { const address = card.address; const price = card.price; const broker = "broker" in card ? card.broker : undefined; const open = () => onOpen?.(card); return <article className="iris-property-card"><button type="button" className="iris-property-photo" onClick={open} aria-label={`Open ${address} listing details`}><img src={propertyImage(card)} alt={address} /><span>Available</span><b>94% match</b><strong>{price}</strong></button><div className="iris-property-body"><h4>{address}</h4><p>{propertyFacts(card) || broker || "Austin Realty listing"}</p>{"blurb" in card && card.blurb && <em>{card.blurb}</em>}<div><button type="button">Book showing</button><button type="button" onClick={open}>View listing</button></div></div></article>; }
function PropertyDetailModal({ property, onClose }: { property: PropertyCard | Property | null; onClose: () => void }) { if (!property) return null; const listingUrl = property.listingUrl; return <div className="iris-modal-backdrop" role="dialog" aria-modal="true" aria-label="Property details" onClick={onClose}><article className="iris-property-modal" onClick={(event) => event.stopPropagation()}><button className="iris-round" onClick={onClose} aria-label="Close property details"><X size={16} /></button><img src={propertyImage(property)} alt={property.address} /><div><span className="iris-eyebrow">Austin Realty listing</span><h2>{property.address}</h2><strong>{property.price}</strong><p>{propertyFacts(property) || ("broker" in property ? property.broker : "Available property")}</p>{"blurb" in property && property.blurb && <em>{property.blurb}</em>}<div className="iris-modal-actions">{listingUrl ? <a href={listingUrl} target="_blank" rel="noreferrer">Open listing</a> : <button type="button" disabled>No listing URL</button>}<button type="button" onClick={onClose}>Close</button></div></div></article></div>; }
function EmailHtmlBlock({ html }: { html: string }) { const clean = React.useMemo(() => sanitizeEmailHtml(html), [html]); return <div className="iris-email-html" dangerouslySetInnerHTML={{ __html: clean }} />; }
function sanitizeEmailHtml(raw = "") { if (!raw) return ""; if (typeof window === "undefined") return raw; try { const DOMPurify = require("dompurify"); return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ["script", "iframe", "object", "embed"], FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"] }); } catch { return raw; } }
function replyTargetForThread(thread: UnifiedThread) { const candidates = [thread.sendTo, thread.contact, thread.meta].map((value) => String(value || "").trim()).filter(Boolean); if (thread.channel === "email") return candidates.find((value) => /@/.test(value)) || candidates[0] || ""; if (thread.channel === "sms" || thread.channel === "whatsapp") return candidates.find((value) => /\d/.test(value)) || candidates[0] || ""; if (thread.channel === "instagram" || thread.channel === "messenger") return candidates.find((value) => !/@/.test(value)) || candidates[0] || ""; return candidates[0] || ""; } function channelCapabilities(thread: UnifiedThread, canSend: boolean, canCall: boolean) {
  const textChannel = thread.channel !== "voice";
  const mediaChannel = ["email", "sms", "instagram", "messenger", "whatsapp"].includes(thread.channel);
  const voiceNoteChannel = ["email", "sms", "instagram", "messenger", "whatsapp"].includes(thread.channel);
  return {
    textReply: textChannel,
    attach: canSend && mediaChannel,
    draft: canSend && textChannel,
    voiceNote: canSend && voiceNoteChannel,
    call: canCall && ["sms", "whatsapp", "voice"].includes(thread.channel),
  };
}

function inboxSettingsKey(channel: MessageChannelId): SettingsChannelKey | null {
  if (channel === "voice") return null;
  if (channel === "website") return "website_chat";
  return channel;
}

function looseKey(value: unknown) {
  return String(value || "").toLowerCase().replace(/^@/, "").replace(/[^\d+a-z@._-]/g, "").trim();
}

function activityBucketLabel(index: number, total: number, short = false) {
  const labels = short ? ["M", "T", "W", "T", "F", "S", "S"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return labels[index % labels.length] || `${short ? "" : "Bucket "}${index + 1}/${total}`;
}

function messageLooksLikeListingHtml(message: UnifiedMessage) { return Boolean(message.html && /(<img|view listing|property details|bed|bath|sqft|listing)/i.test(message.html)); }
function mediaContextOnly(value: string) { const raw = String(value || "").trim(); if (/^Attachment context:/i.test(raw)) return true; const text = cleanMediaCaption(raw); if (!text) return true; return /^attachment( context)?:?$/i.test(text) || /^sent attachment/i.test(text); }
function voiceOutcomeLabel(outcome: Call["outcome"]) { return outcome.replace(/-/g, " "); }
function voiceRecordingUrl(url?: string) { if (!url) return ""; return /^https:\/\/(?:storage|recordings)\.vapi\.ai\//i.test(url) ? url : `/api/media/audio?url=${encodeURIComponent(url)}`; }
function loadSavedVoiceProfiles(): VoicePreset[] { if (typeof window === "undefined") return []; try { const parsed = JSON.parse(window.localStorage.getItem(VOICE_PROFILE_STORAGE_KEY) || "[]") as VoicePreset[]; return Array.isArray(parsed) ? parsed.filter((voice) => voice?.id && voice?.provider) : []; } catch { return []; } }
function saveVoiceProfiles(profiles: VoicePreset[]) { if (typeof window === "undefined") return; window.localStorage.setItem(VOICE_PROFILE_STORAGE_KEY, JSON.stringify(profiles)); }
function loadSelectedVoiceId() { if (typeof window === "undefined") return VOICE_PRESETS[0]?.id || "aura-asteria-en"; return window.localStorage.getItem(VOICE_SELECTED_STORAGE_KEY) || VOICE_PRESETS[0]?.id || "aura-asteria-en"; }
function saveSelectedVoiceId(id: string) { if (typeof window !== "undefined" && id) window.localStorage.setItem(VOICE_SELECTED_STORAGE_KEY, id); }
function initials(name: string) { const clean = name.replace(/[^a-z0-9\s@._-]/gi, " ").trim(); if (!clean) return "AR"; const parts = clean.split(/[\s@._-]+/).filter(Boolean); return (parts[0]?.[0] || "A").concat(parts[1]?.[0] || parts[0]?.[1] || "R").toUpperCase(); }
function clampText(value = "", fallback = "No message yet") { const text = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); return text || fallback; }
function compactMetric(value: number | string | undefined) { if (value === undefined || value === null || value === "") return "0"; if (typeof value === "string") return value; if (value > 999) return `${(value / 1000).toFixed(value > 9999 ? 0 : 1)}k`; return String(value); }
function eventKindLabel(event: ActivityEvent) { if (event.kind === "ai_reply") return "Iris sent"; if (event.kind === "voice") return "Voice call"; if (event.kind === "note") return "System note"; return "Inbound"; }
function eventIcon(event: ActivityEvent) { if (event.body.toLowerCase().includes("book")) return CalendarDays; if (event.body.toLowerCase().includes("transfer")) return Phone; if (event.status === "Review") return CircleAlert; return CHANNEL_ICON[event.channel] || MessageCircle; }
function isOutbound(message: UnifiedMessage) { return message.direction === "iris" || message.direction === "owner"; }
function messageSubject(message: UnifiedMessage) { return "subject" in message ? message.subject : undefined; }
function messageLabel(message: UnifiedMessage, active: UnifiedThread) { if (message.direction === "iris") return "Iris sent"; if (message.direction === "owner") return "Owner sent"; return `${active.name || "Contact"} sent`; }
function propertyImage(card?: PropertyCard | Property) { return card?.photo || ""; }
function propertyFacts(card: PropertyCard | Property) { const beds = "beds" in card ? card.beds : undefined; const baths = "baths" in card ? card.baths : undefined; const sqft = "sqft" in card ? card.sqft : undefined; return [beds && `${beds} bed`, baths && `${baths} bath`, sqft && `${sqft} sqft`].filter(Boolean).join(" · "); }
function ActivityGlyph({ size = 16 }: { size?: number; strokeWidth?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M6.5 15V9.5M12 15V5M17.5 15v-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/></svg>; }
function InstagramGlyph({ size = 16 }: { size?: number; strokeWidth?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="4.2" width="15.6" height="15.6" rx="4.4" stroke="currentColor" strokeWidth="1.9"/><circle cx="12" cy="12" r="3.45" stroke="currentColor" strokeWidth="1.9"/><circle cx="16.5" cy="7.6" r="1.2" fill="currentColor"/></svg>; }
function MessengerGlyph({ size = 16 }: { size?: number; strokeWidth?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.8c-5 0-8.8 3.35-8.8 7.72 0 2.48 1.22 4.65 3.18 6.07v2.92l2.9-1.6c.84.22 1.75.34 2.72.34 5 0 8.8-3.35 8.8-7.73S17 3.8 12 3.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m7.7 12.85 2.75-2.95 2.1 2.05 3.65-3.04" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function WhatsAppGlyph({ size = 16 }: { size?: number; strokeWidth?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.2 19.7 5.35 16.1a8.2 8.2 0 1 1 2.65 2.5L4.2 19.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9.1 8.55c.18-.38.33-.43.63-.43h.5c.17 0 .38.05.5.38l.63 1.5c.1.25.08.44-.08.65l-.42.52c-.13.16-.14.3-.02.5.42.74 1.14 1.52 2.15 2.1.23.13.4.12.56-.06l.62-.72c.17-.2.39-.25.64-.15l1.53.7c.3.13.38.31.34.55-.08.55-.57 1.42-1.15 1.64-.7.27-2.42-.15-4.18-1.52-1.88-1.47-3.15-3.6-3.1-4.55.03-.45.54-1.45.85-1.61Z" fill="currentColor"/></svg>; }
