"use client";

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
};

const NAV_ITEMS: NavItem[] = [
  { view: "overview", label: "Overview" },
  { view: "email", label: "Email", agent: "Iris" },
  { view: "sms", label: "SMS", agent: "Theo" },
  { view: "whatsapp", label: "WhatsApp", agent: "Theo" },
  { view: "voice", label: "Voice", agent: "Aria" },
  { view: "website_chat", label: "Chat", agent: "Olivia" },
  { view: "properties", label: "Properties" },
];

export function Sidebar({
  currentView,
  onViewChange,
  data,
}: {
  currentView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  data: AgentInboxData | null;
}) {
  const handoffs = data?.metrics.needs_human ?? 0;
  const leads = data?.metrics.lead_count ?? 0;

  return (
    <nav className="sidebar" aria-label="Agent Inbox navigation">
      <div className="sidebar-brand">
        <span className="sidebar-logo" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="var(--accent)" />
            <path d="M4 12.5L12 5l8 7.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 11v7a1 1 0 001 1h3v-4h4v4h3a1 1 0 001-1v-7" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="sidebar-wordmark">Agent Inbox</span>
      </div>

      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.view}>
            <button
              className={`sidebar-nav-item ${currentView === item.view ? "active" : ""}`}
              onClick={() => onViewChange(item.view)}
              type="button"
              aria-current={currentView === item.view ? "page" : undefined}
            >
              <span>{item.label}</span>
              {item.agent ? <span className="sidebar-nav-agent">{item.agent}</span> : null}
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar-metrics" aria-label="Workspace metrics">
        <div className="sidebar-metric">
          <span
            className="sidebar-metric-value"
            style={handoffs > 0 ? { color: "var(--accent)" } : undefined}
          >
            {handoffs.toLocaleString()}
          </span>
          <span className="sidebar-metric-label">Handoffs</span>
        </div>
        <div className="sidebar-metric">
          <span className="sidebar-metric-value">{leads.toLocaleString()}</span>
          <span className="sidebar-metric-label">Leads</span>
        </div>
      </div>
    </nav>
  );
}
