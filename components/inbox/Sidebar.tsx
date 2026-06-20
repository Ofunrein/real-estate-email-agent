"use client";

import { useMemo } from "react";
import type { AgentInboxData } from "@/lib/inboxData";

export type SidebarView =
  | "overview"
  | "email"
  | "sms"
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "voice"
  | "website_chat"
  | "properties";

// Per-channel brand accent colors (matches Magic Patterns design)
const CH_COLOR: Record<string, string> = {
  overview: "#A78BFA",
  email: "#60A5FA",
  sms: "#2DD4BF",
  voice: "#4ADE80",
  instagram: "#F472B6",
  messenger: "#38BDF8",
  whatsapp: "#4ADE80",
  website_chat: "#FBBF24",
  properties: "#94A3B8",
};

function OverviewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1l1.2 3.7H13l-3.1 2.3 1.2 3.7L8 8.4l-3.1 2.3 1.2-3.7L3 5h3.8L8 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    </svg>
  );
}
function EmailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M1.5 5.5L8 9.5l6.5-4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  );
}
function SmsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 14l3-2h.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="5.5" cy="7" r=".75" fill="currentColor"/>
      <circle cx="8" cy="7" r=".75" fill="currentColor"/>
      <circle cx="10.5" cy="7" r=".75" fill="currentColor"/>
    </svg>
  );
}
function VoiceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v12M5.5 4.5v7M3 6.5v3M10.5 4.5v7M13 6.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}
function InstagramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="11.5" cy="4.5" r=".7" fill="currentColor"/>
    </svg>
  );
}
function MessengerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5C4.13 1.5 1 4.3 1 7.75c0 2.07 1.1 3.9 2.8 5.05v2.2l2.4-1.32A8.2 8.2 0 008 14c3.87 0 7-2.8 7-6.25S11.87 1.5 8 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
      <path d="M5 8.5l2-2.5 1.8 1.4L11 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5.5 7.5A2.5 2.5 0 018 5a2.5 2.5 0 012.5 2.5A2.5 2.5 0 018 10c-.55 0-1.06-.18-1.47-.48L5 10l.5-1.53A2.48 2.48 0 015.5 7.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    </svg>
  );
}
function WebsiteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M1.5 8h13M8 1.5C6.34 3.5 5.5 5.64 5.5 8s.84 4.5 2.5 6.5M8 1.5C9.66 3.5 10.5 5.64 10.5 8s-.84 4.5-2.5 6.5" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  );
}
function PropertiesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 8L8 2.5 14.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3.5 7V13h3V9.5h3V13h3V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

const NAV_ITEMS: { view: SidebarView; label: string; icon: React.ReactNode; channels: string[] }[] = [
  { view: "overview", label: "Overview", icon: <OverviewIcon />, channels: [] },
  { view: "email", label: "Email", icon: <EmailIcon />, channels: ["email"] },
  { view: "sms", label: "SMS", icon: <SmsIcon />, channels: ["sms", "rcs"] },
  { view: "voice", label: "Voice", icon: <VoiceIcon />, channels: ["voice"] },
  { view: "instagram", label: "Instagram", icon: <InstagramIcon />, channels: ["instagram"] },
  { view: "messenger", label: "Messenger", icon: <MessengerIcon />, channels: ["messenger"] },
  { view: "whatsapp", label: "WhatsApp", icon: <WhatsAppIcon />, channels: ["whatsapp"] },
  { view: "website_chat", label: "Website", icon: <WebsiteIcon />, channels: ["web", "website", "website_chat"] },
  { view: "properties", label: "Properties", icon: <PropertiesIcon />, channels: [] },
];

export function Sidebar({
  currentView,
  onViewChange,
  data,
  darkMode,
  onToggleDark,
}: {
  currentView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  data: AgentInboxData | null;
  darkMode: boolean;
  onToggleDark: () => void;
}) {
  const handoffs = data?.metrics.needs_human ?? 0;
  const leads = data?.metrics.lead_count ?? 0;

  const channelCounts = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const event of data.events ?? []) {
      const ch = (event.channel || "").toLowerCase();
      if (!ch) continue;
      const navItem = NAV_ITEMS.find(item => item.channels.includes(ch));
      if (navItem) {
        counts[navItem.view] = (counts[navItem.view] ?? 0) + 1;
      }
    }
    counts.voice = (data.voiceCalls ?? []).length;
    return counts;
  }, [data]);

  return (
    <nav className="sidebar" aria-label="Agent Inbox navigation">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-logo-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="var(--s-accent)"/>
            <path d="M4 12.5L12 5l8 7.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 11v7a1 1 0 001 1h3v-4h4v4h3a1 1 0 001-1v-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="sidebar-wordmark">Iris Inbox</span>
      </div>

      {/* Nav */}
      <div className="sidebar-section-label">NAVIGATION</div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const active = currentView === item.view;
          const count = channelCounts[item.view];
          const color = CH_COLOR[item.view] ?? "#94A3B8";
          return (
            <li key={item.view}>
              <button
                className={`sidebar-nav-item${active ? " active" : ""}`}
                onClick={() => onViewChange(item.view)}
                type="button"
                aria-current={active ? "page" : undefined}
                style={{ "--ch-color": color } as React.CSSProperties}
              >
                <span className="sidebar-nav-icon-wrap">
                  <span className="sidebar-nav-icon">{item.icon}</span>
                </span>
                <span className="sidebar-nav-label">{item.label}</span>
                {count ? <span className="sidebar-nav-count">{count}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Recent */}
      {leads > 0 || handoffs > 0 ? (
        <>
          <div className="sidebar-section-label" style={{ marginTop: "var(--sp-4)" }}>RECENT</div>
          <div className="sidebar-recent">
            {handoffs > 0 && (
              <div className="sidebar-recent-item">
                <span className="sidebar-recent-dot" style={{ background: "var(--s-warn)" }} />
                <span className="sidebar-recent-text">{handoffs} need review</span>
              </div>
            )}
            <div className="sidebar-recent-item">
              <span className="sidebar-recent-dot" style={{ background: "var(--s-success)" }} />
              <span className="sidebar-recent-text">{leads} leads total</span>
            </div>
          </div>
        </>
      ) : null}

      {/* Bottom */}
      <div className="sidebar-footer">
        <div className="sidebar-mode-toggle">
          <button
            className={`sidebar-mode-btn-pill${!darkMode ? " active" : ""}`}
            onClick={() => !darkMode ? null : onToggleDark()}
            type="button"
            aria-label="Light mode"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </button>
          <button
            className={`sidebar-mode-btn-pill${darkMode ? " active" : ""}`}
            onClick={() => darkMode ? null : onToggleDark()}
            type="button"
            aria-label="Dark mode"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
