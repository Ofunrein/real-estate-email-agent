"use client";

import { useCallback, useState } from "react";
import type { SheetRow } from "@/lib/sheetSchema";
import { normalizeLegacyAgentText } from "@/lib/agentIdentity";

type ReviewThread = {
  threadRef: string;
  channel: string;
  to: string;
  events: SheetRow[];
};

function lastInbound(events: SheetRow[]) {
  return [...events].reverse().find(e => e.direction === "inbound");
}

function lastOutbound(events: SheetRow[]) {
  return [...events].reverse().find(e => e.direction === "outbound");
}

function handoffReason(events: SheetRow[]) {
  return [...events].reverse().find(e => e.handoff_reason)?.handoff_reason || "Review before continuing.";
}

function draftedReply(events: SheetRow[]) {
  const last = lastOutbound(events);
  return last ? normalizeLegacyAgentText(last.summary || last.message_text || "") : "";
}

function confidence(events: SheetRow[]): number {
  const last = [...events].reverse().find(e => e.confidence || e.ai_confidence);
  const raw = last?.confidence || last?.ai_confidence;
  if (raw) {
    const n = Number(raw.replace(/[^0-9.]/g, ""));
    if (n > 0 && n <= 1) return Math.round(n * 100);
    if (n > 1 && n <= 100) return Math.round(n);
  }
  return 0;
}

function channelLabel(ch: string) {
  const map: Record<string, string> = { sms: "SMS", email: "Email", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", voice: "Voice", web: "Website", website: "Website", website_chat: "Website" };
  return map[ch.toLowerCase()] ?? ch;
}

function formatTime(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function HumanReviewQueue({ threads }: { threads: ReviewThread[] }) {
  const [idx, setIdx] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());

  const visible = threads.filter(t => !dismissed.has(t.threadRef) && !sent.has(t.threadRef));
  if (!visible.length) return null;

  const safeIdx = Math.min(idx, visible.length - 1);
  const current = visible[safeIdx];
  const inbound = lastInbound(current.events);
  const reason = handoffReason(current.events);
  const draft = draftedReply(current.events);
  const conf = confidence(current.events);
  const lastEvent = current.events[current.events.length - 1];

  function prev() { setIdx(i => Math.max(0, i - 1)); setEditMode(false); }
  function next() { setIdx(i => Math.min(visible.length - 1, i + 1)); setEditMode(false); }

  function startEdit() {
    setEditText(draft);
    setEditMode(true);
  }

  async function approve(body: string) {
    if (!body.trim()) return;
    setSending(true);
    try {
      await fetch(`/api/threads/${encodeURIComponent(current.threadRef)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: current.channel, to: current.to, body: body.trim() }),
      });
      setSent(s => new Set(s).add(current.threadRef));
      setEditMode(false);
      if (safeIdx >= visible.length - 1) setIdx(Math.max(0, visible.length - 2));
    } finally {
      setSending(false);
    }
  }

  function dismiss() {
    setDismissed(d => new Set(d).add(current.threadRef));
    setEditMode(false);
    if (safeIdx >= visible.length - 1) setIdx(Math.max(0, visible.length - 2));
  }

  return (
    <div className="hrq-wrap">
      <div className="hrq-header">
        <div className="hrq-header-left">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="hrq-flag-icon">
            <path d="M3 1.5v13M3 1.5h9l-2 4 2 4H3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="hrq-title">Human review queue</span>
        </div>
        <span className="hrq-count-badge">{visible.length} flagged</span>
      </div>
      <p className="hrq-subtitle">Approve, edit, or dismiss Iris&rsquo;s drafts before they send.</p>

      <div className="hrq-card">
        {/* Thread header */}
        <div className="hrq-thread-head">
          <div className="hrq-thread-info">
            <span className="hrq-thread-id">{current.to || current.threadRef}</span>
            <span className="hrq-thread-meta">{channelLabel(current.channel)} · {formatTime(lastEvent?.event_at)}</span>
          </div>
          <span className="hrq-reason-badge">{reason.length > 28 ? reason.slice(0, 28) + "..." : reason}</span>
        </div>

        {/* Inbound message */}
        {inbound ? (
          <div className="hrq-section">
            <span className="hrq-section-label">Inbound message</span>
            <div className="hrq-inbound-msg">{inbound.message_text || inbound.summary || "No message text recorded."}</div>
          </div>
        ) : null}

        {/* Flag reason */}
        <div className="hrq-flag-reason">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 1.5v13M3 1.5h9l-2 4 2 4H3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>{reason}</span>
        </div>

        {/* Iris draft */}
        {draft ? (
          <div className="hrq-section">
            <div className="hrq-draft-head">
              <div className="hrq-draft-label-wrap">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1l1.1 3.4H13l-2.9 2.1 1.1 3.4L8 7.8l-3.2 2.1 1.1-3.4L3 4.4h3.9L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                </svg>
                <span className="hrq-draft-label">Iris&rsquo;s drafted reply</span>
              </div>
              {conf > 0 ? (
                <div className="hrq-conf-wrap">
                  <span className="hrq-conf-text">Confidence {conf}%</span>
                  <div className="hrq-conf-bar">
                    <div className="hrq-conf-fill" style={{ width: `${conf}%`, background: conf >= 75 ? "#4ADE80" : conf >= 50 ? "#FBBF24" : "#F87171" }} />
                  </div>
                </div>
              ) : null}
            </div>
            {editMode ? (
              <textarea
                className="hrq-edit-area"
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={4}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) approve(editText); }}
              />
            ) : (
              <div className="hrq-draft-text">{draft}</div>
            )}
          </div>
        ) : null}

        {/* Actions */}
        <div className="hrq-actions">
          <button
            className="hrq-btn-approve"
            type="button"
            disabled={sending || (!draft && !editText)}
            onClick={() => approve(editMode ? editText : draft)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 8.5l4 4 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {sending ? "Sending..." : "Approve & send"}
          </button>
          <button className="hrq-btn-icon" type="button" onClick={editMode ? () => setEditMode(false) : startEdit} title={editMode ? "Cancel edit" : "Edit"}>
            {editMode ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l10 0M8 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11 2.5a1.5 1.5 0 012.1 2.1L5.5 12.2l-3 .8.8-3L11 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
          </button>
          <button className="hrq-btn-icon hrq-btn-dismiss" type="button" onClick={dismiss} title="Dismiss">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Pagination */}
        {visible.length > 1 ? (
          <div className="hrq-pagination">
            <button className="hrq-page-btn" type="button" onClick={prev} disabled={safeIdx === 0}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span className="hrq-page-label">{safeIdx + 1} of {visible.length} flagged</span>
            <button className="hrq-page-btn" type="button" onClick={next} disabled={safeIdx === visible.length - 1}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
