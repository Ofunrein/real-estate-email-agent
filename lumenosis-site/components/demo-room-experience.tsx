"use client";

import { ChevronLeft, ChevronRight, Expand, Mic, SendHorizontal, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Vapi from "@vapi-ai/web";
import type { DemoRoom } from "@/content/demo-rooms";
import { emailBodyHtml } from "@/lib/email-html";

type EmailResult = { subject: string; reply: string; captured: string[]; nextAction: string };
type VoiceConfig = {
  publicKey: string;
  assistantId: string;
  assistantOverrides: Parameters<Vapi["start"]>[1];
  callLimit: number | null;
  remainingCalls: number | null;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function DemoRoomExperience({ room, token }: { room: DemoRoom; token: string }) {
  const presets = [
    `Is ${room.listing.address} still available, and when could I see it?`,
    `Tell me more about the updates, acreage, location, and anything I should verify before touring ${room.listing.address}.`,
    `We need ${room.listing.beds} bedrooms and room for horses. Is this property worth touring?`,
    `I need to sell my current home before buying. Can ${room.prospect.firstName} help me plan both?`,
  ];
  const [message, setMessage] = useState(presets[0]);
  const [emailResult, setEmailResult] = useState<EmailResult | null>(null);
  const [emailError, setEmailError] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const vapi = useRef<Vapi | null>(null);
  const [leads, setLeads] = useState(120);
  const [lossRate, setLossRate] = useState(20);
  const [qualifiedRate, setQualifiedRate] = useState(45);
  const [appointmentRate, setAppointmentRate] = useState(35);
  const [closeRate, setCloseRate] = useState(12);
  const [commission, setCommission] = useState(9000);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const galleryDialog = useRef<HTMLDialogElement>(null);
  const touchStart = useRef(0);

  const moveGallery = useCallback(
    (direction: number) =>
      setGalleryIndex((current) =>
        current === null
          ? null
          : (current + direction + room.listing.images.length) % room.listing.images.length,
      ),
    [room.listing.images.length],
  );

  useEffect(() => {
    if (galleryIndex === null) return;
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGalleryIndex(null);
      if (e.key === "ArrowLeft") moveGallery(-1);
      if (e.key === "ArrowRight") moveGallery(1);
    };
    galleryDialog.current?.showModal();
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", keydown);
    };
  }, [galleryIndex, moveGallery]);

  const event = useCallback(
    (name: string, durationSeconds?: number) =>
      fetch(`/api/demo/${token}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: name, durationSeconds }),
        keepalive: true,
      }).catch(() => undefined),
    [token],
  );

  useEffect(() => {
    const viewed = sessionStorage.getItem(`demo-viewed:${token}`);
    void event(viewed ? "repeat_visit" : "viewed");
    sessionStorage.setItem(`demo-viewed:${token}`, "1");
  }, [event, token]);

  useEffect(() => () => {
    vapi.current?.stop();
    vapi.current = null;
  }, []);

  const recovered = useMemo(() => {
    const value =
      leads *
      (lossRate / 100) *
      (qualifiedRate / 100) *
      (appointmentRate / 100) *
      (closeRate / 100) *
      commission;
    return { low: value * 0.6, high: value };
  }, [appointmentRate, closeRate, commission, leads, lossRate, qualifiedRate]);

  async function runEmailDemo() {
    setSending(true);
    setEmailError("");
    setEmailResult(null);
    try {
      const response = await fetch(`/api/demo/${token}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Iris is unavailable");
      setEmailResult(payload);
      void event("email_completed");
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Iris is unavailable");
    } finally {
      setSending(false);
    }
  }

  async function loadVoiceDemo() {
    setVoiceError("");
    const response = await fetch(`/api/demo/${token}/voice`);
    const payload = await response.json();
    if (!response.ok) {
      setVoiceError(payload.error || "Voice demo is unavailable");
      return;
    }
    setVoiceConfig(payload);
    setVoiceConsent(true);
  }

  async function startVoiceDemo() {
    if (!voiceConfig) return;
    setVoiceConsent(false);
    setVoiceError("");
    setVoiceStatus("connecting");
    try {
      const { default: VapiClient } = await import("@vapi-ai/web");
      const client = new VapiClient(voiceConfig.publicKey);
      vapi.current = client;
      client.on("call-start", () => {
        setVoiceStatus("connected");
        void event("voice_started");
      });
      client.on("call-end", () => {
        setVoiceStatus("idle");
        void event("voice_completed");
      });
      client.on("error", () => {
        setVoiceStatus("idle");
        setVoiceError("Voice connection failed. Check microphone access and try again.");
      });
      await client.start(voiceConfig.assistantId, voiceConfig.assistantOverrides);
    } catch {
      setVoiceStatus("idle");
      setVoiceError("Voice connection failed. Check microphone access and try again.");
    }
  }

  function endVoiceDemo() {
    vapi.current?.stop();
    setVoiceStatus("idle");
  }

  const bookingUrl =
    process.env.NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL || "https://lumenosis.com/#book";

  return (
    <main
      id="top"
      className="min-h-screen bg-[var(--color-bg-cream)] text-[var(--color-ink-charcoal)] [overflow-wrap:anywhere] [&_.grid>*]:min-w-0"
    >
      <header className="border-b border-[var(--color-line)] bg-[var(--color-bg-cream)]">
        <div className="mx-auto flex w-[min(1200px,calc(100%-32px))] flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <span className="block text-sm font-semibold tracking-[-0.02em]">
              Built for {room.prospect.businessName}
            </span>
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              Prepared for {room.prospect.fullName} · {room.prospect.role}
            </span>
          </div>
          <span className="font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            Private demo · expires in 14 days
          </span>
        </div>
      </header>

      <section className="mx-auto grid w-[min(1200px,calc(100%-32px))] gap-8 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-12 md:py-24">
        <div>
          <span className="mb-3 inline-block text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-amber)]">
            Built for {room.prospect.businessName}
          </span>
          <h1 className="headline-plain max-w-3xl text-[clamp(2rem,5.5vw,4.5rem)]">
            See how Iris handles every listing inquiry before it goes cold.
          </h1>
          <p className="mt-6 max-w-2xl text-[var(--text-body-lg)] leading-relaxed text-[var(--color-ink-muted)]">
            {room.prospect.firstName}, this demo uses {room.listing.address} as one live example. In
            production, Iris works across your entire property inventory and pulls current details
            from every connected listing source. Nothing in this demo connects to your inbox, phone,
            calendar, or CRM.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            {[
              "Voice AI disclosed",
              "Public facts only",
              "No live-system access",
              "Recording disabled",
            ].map((item) => (
              <span
                key={item}
                className="rounded-[var(--radius-pill)] border border-[var(--color-line)] px-3 py-2"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[var(--radius)] bg-[#151515] text-white shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
          <div className="grid h-56 grid-cols-[2fr_1fr] gap-1 bg-[#242424]">
            {room.listing.images.map((image, index) => (
              <button
                key={image.src}
                type="button"
                onClick={() => setGalleryIndex(index)}
                aria-label={`Open photo ${index + 1} of ${room.listing.images.length}`}
                className={`group relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${index === 0 ? "row-span-2" : ""}`}
              >
                <Image
                  src={image.src}
                  alt={image.alt}
                  width={900}
                  height={600}
                  sizes={
                    index === 0 ? "(min-width: 768px) 32vw, 66vw" : "(min-width: 768px) 16vw, 33vw"
                  }
                  className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                />
                <Expand className="absolute right-3 bottom-3 h-5 w-5 rounded bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            ))}
          </div>
          <div className="p-6">
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] text-[var(--color-brand-amber)]">
              Verified active listing
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-white">{room.listing.address}</h2>
            <p className="mt-2 text-3xl font-semibold text-white">{money(room.listing.price)}</p>
            <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <span>
                <strong className="block text-xl">{room.listing.beds}</strong>Beds
              </span>
              <span>
                <strong className="block text-xl">{room.listing.baths}</strong>Baths
              </span>
              <span>
                <strong className="block text-xl">
                  {room.listing.squareFeet.toLocaleString()}
                </strong>
                Sq ft
              </span>
              <span>
                <strong className="block text-xl">{room.listing.acreage}</strong>Acres
              </span>
            </div>
            <p className="mt-6 text-sm leading-6 text-white/70">{room.listing.summary}</p>
            <p className="mt-4 font-[var(--font-mono)] text-xs text-white/60">
              MLS {room.listing.mls} · {room.listing.propertyType}
              {room.listing.yearBuilt ? ` · built ${room.listing.yearBuilt}` : ""}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[var(--color-dark-section)] py-20 text-white md:py-28">
        <div className="mx-auto w-[min(1200px,calc(100%-32px))]">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-[var(--color-brand-amber)]">Start here</p>
            <h2 className="mt-3 text-[clamp(2.4rem,4.6vw,4.2rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
              Watch Iris work a buyer email.
            </h2>
            <p className="mt-6 max-w-2xl text-[var(--text-body-lg)] leading-relaxed text-white/70">
              Try one property here. The same agent can identify any listing in your inventory,
              answer from its current source data, capture buyer intent, and prepare the next
              action.
            </p>
          </div>
          <article className="mt-12 overflow-hidden rounded-[var(--radius)] bg-[#ece9e1] text-[#151515] shadow-[0_28px_90px_rgba(0,0,0,0.35)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-[#f8f7f3] px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <span className="relative h-8 w-8 overflow-hidden rounded-full border border-black/10 bg-[#151515]">
                  <Image
                    src="/images/agents/iris.png"
                    alt="Iris"
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                </span>
                <div>
                  <span className="block text-sm font-semibold">Iris Inbox</span>
                  <span className="block text-[11px] text-black/50">
                    {room.prospect.businessName}
                  </span>
                </div>
              </div>
              <span className="rounded-full bg-[#e8f0fe] px-3 py-1 text-xs font-medium text-[#174ea6]">
                Live demo
              </span>
            </div>
            <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
              <div className="border-b border-black/10 p-4 sm:p-6 lg:border-r lg:border-b-0 md:p-8">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-gold-italic)]">
                  Buyer inquiry
                </span>
                <h3 className="mt-3 text-3xl font-semibold">Write as the buyer.</h3>
                <div className="mt-6 grid gap-2">
                  <span className="text-xs font-medium text-black/55">
                    Tap a question to fill it in, or write your own below.
                  </span>
                  {presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setMessage(preset)}
                      className="cursor-pointer rounded-[10px] border border-black/15 bg-white/60 px-4 py-3 text-left text-sm leading-5 shadow-sm transition hover:-translate-y-px hover:border-[var(--color-brand-amber)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-amber)]"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <label className="mt-6 block text-sm font-medium" htmlFor="demo-message">
                  Buyer email
                </label>
                <textarea
                  id="demo-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1200}
                  rows={4}
                  placeholder="Type your question about this property here…"
                  className="mt-2 w-full cursor-text rounded-[10px] border-2 border-black/20 bg-white p-4 text-base leading-6 text-[#151515] shadow-inner outline-none transition placeholder:text-black/40 hover:border-black/30 focus:border-[var(--color-brand-amber)] focus:ring-2 focus:ring-[var(--color-brand-amber)]/20"
                />
                <button
                  type="button"
                  disabled={sending || message.trim().length < 2}
                  onClick={runEmailDemo}
                  className="mt-4 flex w-full items-center justify-center gap-3 rounded-[12px] bg-[#151515] px-5 py-4 text-base font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-[transform,background-color] duration-150 hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  <SendHorizontal aria-hidden="true" size={20} strokeWidth={2.4} />
                  {sending ? "Iris is responding…" : "Send to Iris"}
                </button>
                {emailError ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-[10px] bg-red-50 p-3 text-sm text-red-800"
                  >
                    {emailError} Try again in a moment.
                  </p>
                ) : null}
              </div>
              <div className="min-w-0 bg-white p-4 sm:p-6 md:p-8" aria-live="polite">
                {emailResult ? (
                  <>
                    <div className="border-b border-black/10 pb-5">
                      <p className="text-xs font-medium text-black/50">
                        From: {room.prospect.fullName} · {room.prospect.businessName}
                      </p>
                      <p className="mt-1 break-words text-xs text-black/50">
                        To: buyer@example.com
                      </p>
                      <h3 className="mt-4 text-xl font-semibold text-[#151515]">
                        {emailResult.subject}
                      </h3>
                    </div>
                    <div
                      className="mt-6 text-[15px] leading-7 text-[#242424] [&_a]:font-semibold [&_a]:text-[#8a682c] [&_a]:underline [&_p]:mb-4 [&_p:last-child]:mb-0"
                      // Built by emailBodyHtml, which escapes all text before linking.
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by emailBodyHtml
                      dangerouslySetInnerHTML={{ __html: emailBodyHtml(emailResult.reply) }}
                    />
                    <div className="mt-6 overflow-hidden rounded-[12px] border border-black/10 bg-[#f8f7f3]">
                      <button
                        type="button"
                        onClick={() => setGalleryIndex(0)}
                        className="group relative block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-violet)]"
                        aria-label={`Open photo 1 of ${room.listing.images.length}`}
                      >
                        <Image
                          src={room.listing.images[0].src}
                          alt={room.listing.images[0].alt}
                          width={900}
                          height={500}
                          sizes="(min-width: 1024px) 42vw, 90vw"
                          className="h-44 w-full object-cover sm:h-52"
                        />
                        <Expand className="absolute right-3 bottom-3 h-7 w-7 rounded bg-black/60 p-2 text-white" />
                      </button>
                      <div className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xl font-semibold text-[#151515]">
                              {money(room.listing.price)}
                            </p>
                            <p className="mt-1 text-sm font-medium text-[#333]">
                              {room.listing.address}
                            </p>
                          </div>
                          <span className="rounded-full bg-[#e5f3e8] px-3 py-1 text-xs font-semibold text-[#1e6b35]">
                            Active when verified
                          </span>
                        </div>
                        <p className="mt-4 text-sm font-medium text-[#333]">
                          {room.listing.beds} beds · {room.listing.baths} baths ·{" "}
                          {room.listing.squareFeet.toLocaleString()} sq ft · {room.listing.acreage}{" "}
                          acres
                        </p>
                        <p className="mt-3 text-sm leading-6 text-[#666]">{room.listing.summary}</p>
                        <p className="mt-4 text-xs text-[#777]">
                          MLS {room.listing.mls} · Details subject to independent verification
                        </p>
                      </div>
                    </div>
                    <div className="mt-6 border-t border-black/10 pt-5 text-sm leading-6 text-[#555]">
                      <p className="font-semibold text-[#151515]">
                        {room.prospect.fullName} · {room.prospect.role}
                      </p>
                      <p>{room.prospect.businessName}</p>
                      <p className="text-xs text-[#777]">
                        Drafted in the agent&apos;s voice by Iris
                      </p>
                    </div>
                    <div className="mt-8 rounded-[10px] bg-[#f1eee7] p-5 text-sm">
                      <strong className="text-[#151515]">Private notes for the agent</strong>
                      <p className="mt-2 leading-6 text-[#555]">
                        {emailResult.captured.length
                          ? emailResult.captured.join(" · ")
                          : "No new buyer details captured yet"}
                      </p>
                      <p className="mt-3 font-medium leading-6 text-[#151515]">
                        {emailResult.nextAction}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-80 flex-col justify-center">
                    <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.12em] text-black/40">
                      Reply preview
                    </p>
                    <h3 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-[#151515]">
                      A complete reply appears here.
                    </h3>
                    <p className="mt-4 max-w-md leading-7 text-[#666]">
                      Iris answers this example from verified property facts. In production, it
                      searches every connected listing source before replying.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </article>

          <div className="mt-16 grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
            <article className="rounded-[var(--radius)] border border-[var(--color-brand-amber)]/40 bg-[var(--color-brand-amber-soft)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.24)] md:p-8">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-amber)]">
                <span className="h-2 w-2 rounded-full bg-[var(--color-brand-amber)] motion-safe:animate-pulse" />
                Voice channel available
              </div>
              <h2 className="mt-4 text-3xl font-semibold">Call Iris now.</h2>
              <p className="mt-3 text-sm leading-6 text-white/75">
                Ask about this property as a real buyer. Iris answers from the same verified listing
                details and responds in {room.prospect.firstName}&apos;s voice.
              </p>
              {voiceStatus === "idle" ? (
                <button
                  type="button"
                  onClick={voiceConfig ? () => setVoiceConsent(true) : loadVoiceDemo}
                  className="mt-6 flex w-full items-center gap-4 rounded-[12px] bg-[var(--color-brand-amber)] p-4 text-left text-black shadow-[0_10px_30px_rgba(196,154,82,0.24)] transition-[transform,background-color] duration-150 hover:bg-[#d3aa62] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-dark-section)]"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-black text-white">
                    <Mic aria-hidden="true" size={22} strokeWidth={2.4} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-lg">Start private voice demo</strong>
                    <span className="mt-1 block text-sm text-black/70">
                      Browser microphone · 3-minute call
                    </span>
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={endVoiceDemo}
                  disabled={voiceStatus === "connecting"}
                  className="mt-6 w-full rounded-[12px] bg-black p-4 text-center font-semibold text-white disabled:opacity-60"
                >
                  {voiceStatus === "connecting" ? "Connecting..." : "End demo"}
                </button>
              )}
              {voiceConsent ? (
                <div className="mt-6 rounded-[12px] border border-white/20 bg-black/30 p-4">
                  <p className="text-sm leading-6 text-white/80">
                    This is an isolated AI demonstration. Audio is processed to run the conversation. Recording is disabled.
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button type="button" onClick={() => setVoiceConsent(false)} className="rounded-lg border border-white/30 px-4 py-2 text-sm text-white">Cancel</button>
                    <button type="button" onClick={startVoiceDemo} className="rounded-lg bg-[var(--color-brand-amber)] px-4 py-2 text-sm font-semibold text-black">Accept and start</button>
                  </div>
                </div>
              ) : null}
              <p className="mt-4 text-xs leading-5 text-white/55">
                No phone number. Recording disabled. No live calendar or CRM access.
                {voiceConfig?.callLimit === null
                  ? " Admin testing has no call limit."
                  : voiceConfig?.remainingCalls != null
                    ? ` ${voiceConfig.remainingCalls} of ${voiceConfig.callLimit} calls remain on this link today.`
                    : " This link allows 10 calls per 24 hours."}
              </p>
              {voiceError ? (
                <p role="alert" className="mt-4 text-sm text-red-300">
                  {voiceError}
                </p>
              ) : null}
            </article>
            <article className="p-2 md:p-8">
              <h2 className="text-3xl font-semibold">What Iris already knows</h2>
              <div className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {room.listing.highlights.map((item) => (
                  <div
                    key={item}
                    className="border-t border-white/15 pt-4 text-sm leading-6 text-white/75"
                  >
                    {item}
                  </div>
                ))}
                <div className="border-t border-white/15 pt-4 text-sm leading-6 text-white/75">
                  {room.listing.lotSquareFeet.toLocaleString()} sq ft lot · $
                  {room.listing.pricePerSquareFoot}/sq ft · listed {room.listing.listedAt}
                </div>
              </div>
              <p className="mt-8 text-sm leading-6 text-white/50">
                Iris drafts verified facts in {room.prospect.firstName}&apos;s voice. For
                availability, financing, insurance, restrictions, condition, or negotiations, the
                draft says what still needs confirmation instead of guessing.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto w-[min(1200px,calc(100%-32px))] py-16 md:py-24">
        <span className="mb-3 inline-block text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-amber)]">
          Conservative opportunity model
        </span>
        <h2 className="headline-plain max-w-3xl text-[var(--text-display-section)]">
          Use your numbers. No revenue guarantee.
        </h2>
        <div className="mt-8 grid gap-8 rounded-[var(--radius)] bg-[#f8f7f3] p-6 text-[#151515] shadow-[0_20px_60px_rgba(0,0,0,0.16)] lg:grid-cols-[1fr_0.8fr] md:p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              { label: "Inbound leads / month", value: leads, setter: setLeads, min: 1, max: 2000 },
              {
                label: "Lost to slow response %",
                value: lossRate,
                setter: setLossRate,
                min: 1,
                max: 100,
              },
              {
                label: "Qualified %",
                value: qualifiedRate,
                setter: setQualifiedRate,
                min: 1,
                max: 100,
              },
              {
                label: "Appointment %",
                value: appointmentRate,
                setter: setAppointmentRate,
                min: 1,
                max: 100,
              },
              { label: "Close %", value: closeRate, setter: setCloseRate, min: 1, max: 100 },
              {
                label: "Average commission",
                value: commission,
                setter: setCommission,
                min: 100,
                max: 100000,
              },
            ].map(({ label, value, setter, min, max }) => (
              <label key={label} className="text-sm font-medium">
                {label}
                <input
                  type="number"
                  value={value}
                  min={min}
                  max={max}
                  step={min}
                  onChange={(e) => setter(Number(e.target.value))}
                  className="mt-2 w-full rounded-[10px] border border-black/15 bg-white px-3 py-3 text-base text-[#151515] outline-none focus:border-[var(--color-brand-amber)] focus:ring-2 focus:ring-[var(--color-brand-amber)]/20"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-col justify-center rounded-[var(--radius)] bg-[var(--color-dark-section)] p-6 text-white">
            <p className="text-sm text-white/60">Estimated monthly opportunity range</p>
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[clamp(1.5rem,3vw,2.25rem)] font-semibold text-[var(--color-gold-italic)]">
              <span>{money(recovered.low)}</span>
              <span>–</span>
              <span>{money(recovered.high)}</span>
            </p>
            <p className="mt-4 text-sm leading-6 text-white/60">
              Directional estimate from your assumptions. Closings depend on lead quality,
              inventory, pricing, and agent performance.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[var(--color-dark-section)] py-20 text-center text-white md:py-28">
        <div className="mx-auto w-[min(800px,calc(100%-32px))]">
          <h2 className="headline-plain text-[var(--text-display-section)]">
            Want this connected to one real lead source?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-white/70">
            We will review one workflow live, define the guardrails, and scope a controlled pilot.
            Nothing connects before you approve it.
          </p>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => void event("booking_clicked")}
            className="mt-8 inline-block rounded-[var(--radius)] bg-[var(--color-brand-amber)] px-6 py-4 font-semibold text-black"
          >
            Book a 15-minute walkthrough
          </a>
          <div className="mt-10 text-left text-xs text-white/50">
            <p>Verified sources used for this demonstration:</p>
            {room.sources.map((source) => (
              <a
                key={source.url}
                className="mt-2 block underline"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.label} · checked {source.checkedAt}
              </a>
            ))}
          </div>
        </div>
      </section>
      {galleryIndex !== null ? (
        <dialog
          ref={galleryDialog}
          aria-label={`${room.listing.address} photo gallery`}
          className="m-auto h-[min(760px,calc(100dvh-32px))] max-h-none w-[min(1100px,calc(100%-32px))] max-w-none flex-col overflow-hidden rounded-[var(--radius)] border border-white/20 bg-black/85 p-0 text-white shadow-[0_24px_90px_rgba(0,0,0,0.45)] backdrop:bg-black/45 backdrop:backdrop-blur-sm open:flex"
          onCancel={() => setGalleryIndex(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setGalleryIndex(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setGalleryIndex(null);
          }}
          onTouchStart={(e) => {
            touchStart.current = e.changedTouches[0].clientX;
          }}
          onTouchEnd={(e) => {
            const distance = e.changedTouches[0].clientX - touchStart.current;
            if (Math.abs(distance) > 50) moveGallery(distance > 0 ? -1 : 1);
          }}
        >
          <header className="flex items-center justify-between gap-4 bg-black/35 p-4 sm:p-6">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{room.listing.address}</p>
              <p className="mt-1 text-xs text-white/60">
                {galleryIndex + 1} of {room.listing.images.length} · {money(room.listing.price)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGalleryIndex(null)}
              className="rounded-full bg-white/10 p-3 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Close photo gallery"
            >
              <X className="h-6 w-6" />
            </button>
          </header>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16">
            <Image
              src={room.listing.images[galleryIndex].src}
              alt={room.listing.images[galleryIndex].alt}
              width={1600}
              height={1200}
              sizes="100vw"
              priority
              className="max-h-full w-auto max-w-full object-contain"
            />
            {room.listing.images.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => moveGallery(-1)}
                  className="absolute left-4 rounded-full bg-white/90 p-3 text-black shadow-lg hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-6"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="h-7 w-7" />
                </button>
                <button
                  type="button"
                  onClick={() => moveGallery(1)}
                  className="absolute right-4 rounded-full bg-white/90 p-3 text-black shadow-lg hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-6"
                  aria-label="Next photo"
                >
                  <ChevronRight className="h-7 w-7" />
                </button>
              </>
            ) : null}
          </div>
        </dialog>
      ) : null}
    </main>
  );
}
