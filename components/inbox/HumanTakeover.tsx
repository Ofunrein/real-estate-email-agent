"use client";

import { useEffect, useRef, useState } from "react";

type Channel = "sms" | "whatsapp" | "messenger" | "instagram" | "email";

type DraftPayload = {
  body: string;
  category_slug: string;
  confidence: number;
  reason: string;
  next_action: string;
  safe_to_auto_send: boolean;
  needs_human: boolean;
};

export function HumanTakeover({
  threadRef,
  channel,
  to,
  subject,
  gmailThreadId,
  messageId,
  references,
}: {
  threadRef: string;
  channel: Channel;
  to: string;
  subject?: string;
  gmailThreadId?: string;
  messageId?: string;
  references?: string;
}) {
  const [isActive, setIsActive] = useState(false);
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendNotice, setSendNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const base = `/api/threads/${encodeURIComponent(threadRef)}`;

  // Load current takeover state on mount / thread change.
  useEffect(() => {
    let live = true;
    fetch(`${base}/takeover`)
      .then((r) => r.json())
      .then((d) => live && setIsActive(Boolean(d.isActive)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base]);

  async function toggle() {
    const action = isActive ? "release" : "take";
    const res = await fetch(`${base}/takeover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, channel }),
    });
    const d = await res.json();
    if (d.ok) setIsActive(Boolean(d.isActive));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    const d = await (await fetch(`${base}/upload`, { method: "POST", body: form })).json();
    setUploading(false);
    if (d.ok) setMediaUrls((p) => [...p, d.url]);
    else setError(d.error || "Upload failed");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send() {
    if (channel === "messenger" || channel === "instagram") {
      setError("Reply from the ManyChat inbox for this social DM.");
      return;
    }
    if (!body.trim() && mediaUrls.length === 0) return;
    setSending(true);
    setError("");
    setSendNotice("");
    const d = await (
      await fetch(`${base}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, to, body: body.trim(), mediaUrls, subject, threadId: gmailThreadId, messageId, references }),
      })
    ).json();
    setSending(false);
    if (d.ok) {
      setBody("");
      setMediaUrls([]);
      if (channel === "email") {
        setSendNotice(d.fallbackReason || (d.threaded === false ? "Sent as a fresh email from the active mailbox." : `Sent from ${d.mailboxEmail || "active mailbox"}.`));
      }
    } else {
      setError(d.error || "Send failed");
    }
  }

  async function generateDraft() {
    setDrafting(true);
    setError("");
    const response = await fetch(`${base}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    const payload = await response.json();
    setDrafting(false);
    if (payload.ok && payload.draft) {
      setDraft(payload.draft);
      setBody(payload.draft.body || "");
      return;
    }
    setError(payload.error || "Draft failed");
  }

  const channelLabel = channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : channel === "messenger" ? "Messenger" : channel === "instagram" ? "Instagram" : "Email";
  const isSocialDm = channel === "messenger" || channel === "instagram";

  return (
    <div className="human-takeover-bar">
      <div className="human-takeover-header">
        <div className="human-takeover-status">
          <span className={`takeover-dot${isActive ? " active" : ""}`} />
          <span className="takeover-label">{isActive ? "You have control — AI paused" : "AI active"}</span>
        </div>
        <button className={`takeover-toggle-btn ${isActive ? "release" : "take"}`} onClick={toggle} type="button">
          {isActive ? "Release to AI" : "Take over"}
        </button>
      </div>

      {isActive && isSocialDm ? (
        <div className="human-compose">
          <div className="human-compose-error">AI is paused. Reply from ManyChat so the social inbox stays the sender of record.</div>
        </div>
      ) : null}

      {isActive && !isSocialDm && (
        <div className="human-compose">
          <div className="ai-draft-toolbar">
            <button className="ai-draft-button" onClick={generateDraft} type="button" disabled={drafting}>
              {drafting ? "Drafting..." : draft ? "Refresh AI draft" : "Generate AI draft"}
            </button>
            {draft ? (
              <div className="ai-draft-meta">
                <span>{draft.category_slug.replaceAll("_", " ")}</span>
                <span>{Math.round(draft.confidence * 100)}%</span>
                <span>{draft.safe_to_auto_send ? "safe if enabled" : "review first"}</span>
              </div>
            ) : null}
          </div>
          {draft?.reason ? <div className="ai-draft-reason">{draft.reason}</div> : null}
          <textarea
            className="human-compose-textarea"
            placeholder={`Reply as ${channelLabel}…`}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
          />
          {mediaUrls.length > 0 && (
            <div className="human-compose-attachments">
              {mediaUrls.map((url, i) => (
                <span className="human-compose-attachment" key={url}>
                  <span>{url.split("/").pop()}</span>
                  <button type="button" aria-label="Remove" onClick={() => setMediaUrls((p) => p.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {sendNotice && <div className="human-compose-notice">{sendNotice}</div>}
          {error && <div className="human-compose-error">{error}</div>}
          <div className="human-compose-actions">
            <input ref={fileRef} type="file" accept="image/*,video/mp4,application/pdf" style={{ display: "none" }} onChange={onFile} />
            <button className="human-compose-attach-btn" type="button" onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach media">
              {uploading ? "…" : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>
            <button className="human-compose-send-btn" type="button" onClick={send} disabled={sending || (!body.trim() && mediaUrls.length === 0)}>
              {sending ? "Sending…" : `Send via ${channelLabel}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
