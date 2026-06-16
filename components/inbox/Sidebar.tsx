"use client";

import { useState } from "react";
import type { AgentInboxData } from "@/lib/inboxData";

export type SidebarView =
  | "overview"
  | "email"
  | "sms"
  | "whatsapp"
  | "voice"
  | "website_chat"
  | "properties";

type NavItem = {
  view: SidebarView;
  label: string;
  agent?: string;
  icon: React.ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    view: "overview",
    label: "Overview",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
    ),
  },
  {
    view: "email",
    label: "Email",
    agent: "Iris",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1" y="2.5" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M1 5l6.5 4.5L14 5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    view: "sms",
    label: "SMS",
    agent: "Theo",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M13 1.5H2A1.5 1.5 0 00.5 3v7A1.5 1.5 0 002 11.5h3l2 2 2-2h4a1.5 1.5 0 001.5-1.5V3A1.5 1.5 0 0013 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    view: "whatsapp",
    label: "WhatsApp",
    agent: "Theo",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <circle cx="7.5" cy="7.5" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M5 7.5c0-1.38 1.12-2.5 2.5-2.5S10 6.12 10 7.5 8.88 10 7.5 10c-.52 0-1-.16-1.4-.44L4.5 10l.44-1.6A2.49 2.49 0 015 7.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    view: "voice",
    label: "Voice",
    agent: "Aria",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M9.5 1.5v12M7.5 3.5v8M5.5 5v5M11.5 4v7M3.5 6v3M1.5 7v1M13.5 6v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    view: "website_chat",
    label: "Chat",
    agent: "Olivia",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M7.5 1C3.91 1 1 3.69 1 7c0 1.19.37 2.3 1 3.22V13l2.5-1.5C5.54 11.82 6.49 12 7.5 12c3.59 0 6.5-2.24 6.5-5.5S11.09 1 7.5 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    view: "properties",
    label: "Properties",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M1.5 7.5L7.5 2l6 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M3 6.5V13h3.5V9.5h2V13H12V6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
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
        <span className="sidebar-wordmark">Agent Inbox</span>
      </div>

      {/* Nav */}
      <div className="sidebar-section-label">NAVIGATION</div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.view}>
            <button
              className={`sidebar-nav-item${currentView === item.view ? " active" : ""}`}
              onClick={() => onViewChange(item.view)}
              type="button"
              aria-current={currentView === item.view ? "page" : undefined}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
              {item.agent ? <span className="sidebar-nav-agent">{item.agent}</span> : null}
            </button>
          </li>
        ))}
      </ul>

      {/* Recent activity section */}
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

      {/* Bottom controls */}
      <div className="sidebar-footer">
        <button className="sidebar-mode-btn" onClick={onToggleDark} type="button">
          {darkMode ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
          )}
          <span>{darkMode ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>
    </nav>
  );
}
