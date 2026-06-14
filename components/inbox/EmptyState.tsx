import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  email: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 7 10-7" />
    </svg>
  ),
  sms: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  whatsapp: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  voice: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 1v4M8 5v2M16 5v2M6 9v6M18 9v6M10 3v8M14 3v8" />
    </svg>
  ),
  website_chat: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8M8 8h4" />
    </svg>
  ),
  properties: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 12l9-9 9 9M5 10v9h4v-5h6v5h4v-9" />
    </svg>
  ),
};

const LABELS: Record<string, string> = {
  email:        "No email conversations yet",
  sms:          "No SMS conversations yet",
  whatsapp:     "No WhatsApp conversations yet",
  voice:        "No voice calls yet",
  website_chat: "No website chats yet",
  properties:   "No properties loaded",
};

export function EmptyState({ channel, label }: { channel: string; label?: string }) {
  const icon = ICONS[channel] ?? ICONS.email;
  const text = label ?? LABELS[channel] ?? "Nothing here yet";
  return (
    <div className="bt-empty-state">
      {icon}
      <span style={{ fontSize: "var(--text-sm)" }}>{text}</span>
    </div>
  );
}
