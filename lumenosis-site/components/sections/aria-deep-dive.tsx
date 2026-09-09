"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  BathIcon,
  BedIcon,
  DoorIcon,
  LensIcon,
  type LetterIcon,
  PinIcon,
  RouteIcon,
  RuleIcon,
  StopwatchIcon,
} from "@/components/icons/editorial";
import { Reveal } from "@/components/reveal";
import { GlowCard } from "@/components/spotlight-card";

type EmailMessage = {
  id: string;
  from: "lead" | "iris";
  name: string;
  email: string;
  time: string;
  body: string;
  label?: string;
  listing?: boolean;
  valuation?: boolean;
};

type ConversationLine = {
  id: string;
  from: "lead" | "ai";
  name: string;
  text: string;
  detail?: string;
};

const IDLE_WAVEFORM = Array.from({ length: 40 }, (_, i) =>
  Number((14 + Math.abs(Math.sin(i * 0.38) * 22 + Math.sin(i * 0.85) * 14)).toFixed(4)),
);
const WAVEFORM_BAR_KEYS = IDLE_WAVEFORM.map((_, i) => `waveform-bar-${i}`);

const emailThread: EmailMessage[] = [
  {
    id: "email-1",
    from: "lead",
    name: "Emily Rivera",
    email: "emily.rivera@example.com",
    time: "9:12 AM",
    body: "Hi, is 1842 Oak Ridge Lane still available? We are moving from Austin and want something close to Barton Creek Elementary. We can tour after 5:30 this week.",
  },
  {
    id: "email-2",
    from: "iris",
    name: "Iris",
    email: "assistant@lumenosis.com",
    time: "9:13 AM",
    label: "Property details matched",
    listing: true,
    body: "Yes, Oak Ridge Modern is still active. The next private showing windows are Wednesday at 5:45 PM and Thursday at 6:10 PM.",
  },
  {
    id: "email-3",
    from: "lead",
    name: "Emily Rivera",
    email: "emily.rivera@example.com",
    time: "9:16 AM",
    body: "Financing. We are pre-approved up to 900k, but we probably need to sell our Round Rock condo before closing.",
  },
  {
    id: "email-4",
    from: "iris",
    name: "Iris",
    email: "assistant@lumenosis.com",
    time: "9:17 AM",
    label: "Tour booked, valuation opened",
    valuation: true,
    body: "Perfect. I booked your Wednesday 5:45 PM tour. Since you need to sell the Round Rock condo first, start here and we will prepare the comps before your call.",
  },
];

const theoThread: ConversationLine[] = [
  {
    id: "sms-1",
    from: "lead",
    name: "Portal inquiry",
    detail: "9:21 AM",
    text: "Hi, saw the property at 412 Oak Ridge. Still available?",
  },
  {
    id: "sms-2",
    from: "ai",
    name: "Iris",
    detail: "9:21 AM",
    text: "Hey! Yes, it is: 3 bed, 2 bath, $529k. Are you pre-approved or already working with someone?",
  },
  {
    id: "sms-3",
    from: "lead",
    name: "Portal inquiry",
    detail: "9:22 AM",
    text: "Pre-approved, looking to move in 60 days.",
  },
  {
    id: "sms-4",
    from: "ai",
    name: "Iris",
    detail: "9:22 AM",
    text: "Perfect timing. I have Tuesday 4pm or Thursday 10am for a showing. Which works?",
  },
  {
    id: "sms-5",
    from: "lead",
    name: "Portal inquiry",
    detail: "9:23 AM",
    text: "Tuesday at 4.",
  },
  {
    id: "sms-6",
    from: "ai",
    name: "Iris",
    detail: "9:23 AM",
    text: "Done! Booked Tuesday 4pm. You'll get a confirmation text. See you there!",
  },
];

const listingStats = [
  { label: "Price", value: "$865,000" },
  { label: "Beds", value: "4" },
  { label: "Baths", value: "3" },
  { label: "Sq ft", value: "2,420" },
];

const microFeatures = [
  {
    icon: StopwatchIcon,
    title: "Fast first touch",
    body: "Every new inquiry gets a useful reply before the conversation goes cold.",
  },
  {
    icon: RouteIcon,
    title: "Routed next step",
    body: "Showings, valuation calls, operator handoffs, and follow-ups land with the right owner.",
  },
  {
    icon: LensIcon,
    title: "Shared memory",
    body: "Email, SMS, calls, website chat, and social DMs use the same conversation timeline.",
  },
  {
    icon: DoorIcon,
    title: "Property aware",
    body: "Replies use your sheet, database, enrichment, CRM, or property source before guessing.",
  },
];

function useRevealedCount(total: number, delayMs: number) {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const id = window.setInterval(() => {
      setCount((current) => (current >= total ? 1 : current + 1));
    }, delayMs);
    return () => window.clearInterval(id);
  }, [delayMs, total]);

  return count;
}

function TypewriterText({ text, active }: { text: string; active: boolean }) {
  const [chars, setChars] = useState(active ? 0 : text.length);

  useEffect(() => {
    if (!active) {
      setChars(text.length);
      return;
    }

    setChars(0);
    let next = 0;
    const step = Math.max(1, Math.ceil(text.length / 96));
    const id = window.setInterval(() => {
      next = Math.min(text.length, next + step);
      setChars(next);
      if (next >= text.length) {
        window.clearInterval(id);
      }
    }, 58);

    return () => window.clearInterval(id);
  }, [active, text]);

  return (
    <>
      {text.slice(0, chars)}
      {active && chars < text.length ? <span className="ml-0.5 animate-pulse">|</span> : null}
    </>
  );
}

function SectionBadge({
  icon: Icon,
  avatarSrc,
  avatarAlt,
  title,
  subtitle,
}: {
  icon?: typeof LetterIcon;
  avatarSrc?: string;
  avatarAlt?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-[#2e2e30] bg-[#1c1c1f] text-[var(--color-brand-violet)]">
        {avatarSrc ? (
          <span className="relative size-8 overflow-hidden rounded-xl">
            <Image
              src={avatarSrc}
              alt={avatarAlt ?? ""}
              fill
              sizes="32px"
              className="object-cover"
            />
          </span>
        ) : Icon ? (
          <Icon className="size-4" aria-hidden />
        ) : null}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-white">{subtitle}</p>
      </div>
    </div>
  );
}

function InlineListingCard() {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-white/12 bg-white text-neutral-950 shadow-[0_14px_34px_rgba(0,0,0,0.22)]">
      <div className="grid gap-0 sm:grid-cols-[0.92fr_1.08fr]">
        <div className="relative min-h-[172px] sm:min-h-full">
          <Image
            src="https://ap.rdcpix.com/574f42a37829888fdbdf1cf4d48faa27l-m3739095458rd-w960_h720.webp"
            alt="Oak Ridge Modern property preview"
            fill
            sizes="(max-width: 768px) 100vw, 260px"
            className="object-cover"
          />
        </div>
        <div className="p-4">
          <p className="font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight">
            Oak Ridge Modern
          </p>
          <p className="mt-1 text-sm text-neutral-600">1842 Oak Ridge Lane, Austin TX</p>
          <p className="mt-3 text-2xl font-bold text-[var(--color-brand-violet)]">$865,000</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm text-neutral-600">
            <span className="rounded-xl bg-neutral-100 px-3 py-2 font-semibold">4 bed</span>
            <span className="rounded-xl bg-neutral-100 px-3 py-2 font-semibold">3 bath</span>
            <span className="rounded-xl bg-neutral-100 px-3 py-2 font-semibold">2,420 sq ft</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TypingDots({ align = "left" }: { align?: "left" | "right" }) {
  return (
    <div
      className={`flex w-fit items-center gap-1.5 rounded-[18px] border border-[#2e2e30] bg-[#1c1c1f] px-4 py-2.5 ${
        align === "right" ? "ml-auto" : "mr-auto"
      }`}
      role="status"
      aria-label="Typing"
    >
      <span className="size-1.5 animate-[typing-dot_1.35s_ease-in-out_infinite] rounded-full bg-white/72" />
      <span className="size-1.5 animate-[typing-dot_1.35s_ease-in-out_infinite] rounded-full bg-white/72 [animation-delay:160ms]" />
      <span className="size-1.5 animate-[typing-dot_1.35s_ease-in-out_infinite] rounded-full bg-white/72 [animation-delay:320ms]" />
    </div>
  );
}

function ValuationLinkCard() {
  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-brand-violet)]/40 bg-[var(--color-brand-violet)]/15 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-brand-violet)]">
        Seller signal detected
      </p>
      <p className="mt-2 text-base font-semibold text-white">Book your free property valuation</p>
      <p className="mt-2 text-sm leading-relaxed text-white">
        A 15-minute prep call gives Martin the condo comps, likely range, and timing notes before
        the showing.
      </p>
    </div>
  );
}

function IrisEmailDemo() {
  const shown = useRevealedCount(emailThread.length, 11500);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const visibleMessages = emailThread.slice(0, shown);
  const latestMessage = visibleMessages[visibleMessages.length - 1];

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
    if (!isAtBottom) {
      userScrolledRef.current = true;
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        userScrolledRef.current = false;
      }, 3000);
    }
  };

  useEffect(() => {
    void shown;
    if (!userScrolledRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [shown]);

  return (
    <GlowCard
      glowColor="gold"
      customSize
      className="p-0 border border-white/[0.08] [--backdrop:#0e1010]"
    >
      <div className="overflow-hidden rounded-[inherit] grid min-h-0 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="flex min-h-0 flex-col border-b border-[var(--color-line)] p-4 sm:p-5 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] pb-4">
            <SectionBadge
              avatarSrc="/images/agents/iris.png"
              avatarAlt="Iris"
              title="Iris email desk"
              subtitle="Live property inquiry"
            />
            <div className="rounded-full border border-[var(--color-brand-violet)]/50 bg-[#221c10] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
              {latestMessage?.from === "iris" ? "Typing reply" : "Reading inquiry"}
            </div>
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-[#2e2e32] bg-[#0a0a0b] p-3 text-sm shadow-[0_18px_44px_rgba(3,7,5,0.28)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white">Subject</p>
                <p className="mt-1 font-semibold text-white">
                  Re: Oak Ridge Modern showing request
                </p>
              </div>
              <span className="rounded-full bg-[#2d183b] px-3 py-1 text-xs font-semibold text-white">
                CRM synced
              </span>
            </div>

            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="mt-3 flex h-[420px] flex-col gap-3 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-[var(--color-brand-violet)]/40 scrollbar-track-transparent [scrollbar-color:#cb6ce6_#0a0a0b] [scrollbar-width:thin]"
            >
              {visibleMessages.map((message) => {
                const isLatest = latestMessage?.id === message.id;
                const isIris = message.from === "iris";

                return (
                  <article
                    key={message.id}
                    className={[
                      "rounded-2xl border p-3 shadow-sm transition-all duration-300",
                      isIris
                        ? "border-[var(--color-brand-violet)]/45 bg-[#1c1c1f]"
                        : "border-[#2e2e32] bg-[#131315]",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative size-9 shrink-0 overflow-hidden rounded-full border border-[#3d3d40] bg-[#1c1c1f]">
                        <Image
                          src={isIris ? "/images/agents/iris.png" : "/images/agents/olivia.png"}
                          alt={isIris ? "Iris" : "Inquiry profile"}
                          fill
                          sizes="36px"
                          className="object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {message.name}
                            </p>
                            <p className="truncate text-xs text-white">{message.email}</p>
                          </div>
                          <span className="shrink-0 text-xs text-white">{message.time}</span>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-white">
                          <TypewriterText text={message.body} active={isIris && isLatest} />
                        </p>
                        {message.listing ? <InlineListingCard /> : null}
                        {message.valuation ? <ValuationLinkCard /> : null}
                        {message.label ? (
                          <p className="mt-3 inline-flex rounded-full bg-[#2a1e0a] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                            {message.label}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 bg-[#0f1010] p-4 sm:p-5">
          <div className="relative min-h-[140px] overflow-hidden rounded-[28px] border border-[#2e2e32] bg-[#080809] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
            <Image
              src="https://ap.rdcpix.com/574f42a37829888fdbdf1cf4d48faa27l-m3739095458rd-w960_h720.webp"
              alt="Modern home property preview"
              fill
              sizes="(max-width: 1024px) 100vw, 440px"
              className="object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white">
                Matched property
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
                Oak Ridge Modern
              </p>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#2e2e32] bg-[#181818] p-4">
            <div className="flex items-start gap-3">
              <PinIcon className="mt-1 size-[18px] shrink-0 text-white/85" aria-hidden />
              <div>
                <p className="font-semibold text-white">1842 Oak Ridge Lane</p>
                <p className="text-sm text-white">Austin, TX 78746</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {listingStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-[#2e2e32] bg-[#0f1010] p-3"
                >
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white">{stat.label}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 text-sm text-white">
              <p className="flex items-center gap-2">
                <BedIcon className="size-[18px] text-white/85" aria-hidden />
                New primary suite and walk-in closet
              </p>
              <p className="flex items-center gap-2">
                <BathIcon className="size-[18px] text-white/85" aria-hidden />
                Three updated bathrooms
              </p>
              <p className="flex items-center gap-2">
                <RuleIcon className="size-[18px] text-white/85" aria-hidden />
                Seller prefers closing before July 15
              </p>
            </div>
          </div>
        </div>
      </div>
    </GlowCard>
  );
}

function AriaPhoneDemo() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [callComplete, setCallComplete] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bars, setBars] = useState<number[]>(IDLE_WAVEFORM);

  const animateBars = () => {
    const t = Date.now();

    // Get real audio energy if available, but floor it so bars always move when playing
    const energy = 0.45;

    const newBars = Array.from({ length: 40 }, (_, i) => {
      const p1 = Math.sin(t * 0.002 + i * 0.28) * 0.5 + 0.5;
      const p2 = Math.sin(t * 0.0035 + i * 0.55) * 0.5 + 0.5;
      const p3 = Math.sin(t * 0.0015 + i * 0.18) * 0.5 + 0.5;
      const combined = p1 * 0.5 + p2 * 0.3 + p3 * 0.2;
      return Math.max(8, Math.min(95, combined * energy * 90 + 6));
    });

    setBars(newBars);
    rafRef.current = requestAnimationFrame(animateBars);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      cancelAnimationFrame(rafRef.current);
      setBars(IDLE_WAVEFORM);
      setPlaying(false);
    } else {
      audio
        .play()
        .then(() => {
          setPlaying(true);
          animateBars();
        })
        .catch(() => {});
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onLoad = () => setDuration(audio.duration);
    const onEnded = () => {
      setPlaying(false);
      setCallComplete(true);
      cancelAnimationFrame(rafRef.current);
      // Reset bars to static idle waveform
      setBars(IDLE_WAVEFORM);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoad);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoad);
      audio.removeEventListener("ended", onEnded);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const seekFromClientX = (clientX: number, rect: DOMRect) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
  };

  return (
    <div className="flex flex-col gap-5 w-full p-6">
      {/* Header */}
      <div className="text-center">
        <div className="relative size-14 overflow-hidden rounded-full mx-auto mb-3">
          <Image
            src="/images/agents/iris.png"
            alt="Iris AI"
            fill
            sizes="56px"
            className="object-cover"
          />
        </div>
        <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-white">
          Iris AI
        </p>
        <div
          className={`mt-1.5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-all duration-500 ${
            callComplete
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-white/15 bg-white/5 text-white/90"
          }`}
        >
          {callComplete ? (
            <svg viewBox="0 0 16 16" className="size-3 fill-current" aria-hidden="true">
              <path d="M13.5 3.5L6 11 2.5 7.5 1 9l5 5 9-9z" />
            </svg>
          ) : (
            <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
          {callComplete ? "Handoff routed" : "Recording call"}
        </div>
      </div>

      {/* Audio player */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            className="grid size-14 shrink-0 place-items-center rounded-full bg-[var(--color-brand-violet)] text-white shadow-[0_12px_32px_rgba(160,120,64,0.32)] transition-transform hover:scale-105 active:scale-95 sm:size-16"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="size-5 fill-current sm:size-6" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="ml-0.5 size-5 fill-current sm:size-6"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <div>
            <p className="text-sm font-semibold text-white">Oak Ridge inbound call</p>
            <p className="text-xs text-white/90">Availability, tour time, valuation handoff.</p>
          </div>
        </div>

        {/* Real-time waveform */}
        <div className="flex items-center gap-[2px] h-14 w-full">
          {bars.map((h, i) => (
            <div
              key={WAVEFORM_BAR_KEYS[i]}
              className={`flex-1 rounded-full transition-all duration-75 ${
                i / 40 < progress
                  ? "bg-[var(--color-brand-violet)]"
                  : "bg-[var(--color-brand-violet)]/30"
              }`}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>

        {/* Progress bar — clickable and draggable */}
        <div
          className="group relative flex h-10 cursor-pointer items-center touch-none"
          role="slider"
          aria-label="Seek call recording"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.round(duration))}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          onKeyDown={(e) => {
            const audio = audioRef.current;
            if (!audio || !duration) return;

            let next = currentTime;
            if (e.key === "ArrowLeft") next = Math.max(0, currentTime - 5);
            else if (e.key === "ArrowRight") next = Math.min(duration, currentTime + 5);
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = duration;
            else return;

            e.preventDefault();
            audio.currentTime = next;
          }}
          onPointerDown={(e) => {
            if (!duration) return;
            const container = e.currentTarget;
            const rect = container.getBoundingClientRect();
            container.setPointerCapture(e.pointerId);
            seekFromClientX(e.clientX, rect);
          }}
          onPointerMove={(e) => {
            if (!duration || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
            seekFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onClick={(e) => {
            if (!duration) return;
            seekFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
          }}
        >
          <div className="relative h-2 w-full rounded-full bg-white/15">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-brand-violet)] shadow-[0_0_18px_rgba(160,120,64,0.38)]"
              style={{ width: `${progress * 100}%` }}
            />
            <div
              className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--color-brand-violet)] opacity-100 shadow-[0_0_0_5px_rgba(160,120,64,0.18),0_8px_18px_rgba(0,0,0,0.28)] transition-transform group-hover:scale-110 sm:size-6"
              style={{ left: `${progress * 100}%` }}
            />
          </div>
        </div>
        <div className="flex justify-between text-xs text-white/50 mt-1">
          <span>{fmt(currentTime)}</span>
          <span>{duration > 0 ? fmt(duration) : "4:41"}</span>
        </div>
      </div>

      {/* Feature bullets */}
      <div className="grid gap-2">
        {["Property details provided", "Questions answered", "Handoff routed automatically"].map(
          (f) => (
            <div key={f} className="flex items-center gap-2 text-sm text-white/80">
              <span className="size-4 grid place-items-center rounded-full bg-[var(--color-brand-violet)]/20 text-[var(--color-brand-violet)] text-xs">
                ✓
              </span>
              {f}
            </div>
          ),
        )}
      </div>

      {/* Hidden audio */}
      <audio ref={audioRef} src="/aria-oak-ridge-call.mp3" preload="metadata">
        <track
          kind="captions"
          src="/aria-oak-ridge-call.vtt"
          srcLang="en"
          label="English captions"
          default
        />
      </audio>
    </div>
  );
}

type ChatStep = { type: "message"; index: number } | { type: "typing" };

// Timeline: each entry has the step to show and when (ms from start)
const theoTimeline: Array<{ step: ChatStep; showAt: number }> = [
  { step: { type: "message", index: 0 }, showAt: 0 }, // lead msg
  { step: { type: "typing" }, showAt: 1800 }, // Theo typing
  { step: { type: "message", index: 1 }, showAt: 3900 }, // Theo reply (hides typing)
  { step: { type: "message", index: 2 }, showAt: 6600 }, // lead msg
  { step: { type: "typing" }, showAt: 7800 }, // Theo typing
  { step: { type: "message", index: 3 }, showAt: 9600 }, // Theo reply
  { step: { type: "message", index: 4 }, showAt: 12300 }, // lead msg
  { step: { type: "typing" }, showAt: 13350 }, // Theo typing
  { step: { type: "message", index: 5 }, showAt: 15000 }, // Theo reply
];
const LOOP_DURATION = 19500;

const getTheoStatus = (lastVisibleIndex: number | undefined) => {
  if (lastVisibleIndex === undefined || lastVisibleIndex === 0)
    return { dot: "amber", text: "Qualifying inquiry" };
  if (lastVisibleIndex <= 2) return { dot: "amber", text: "Checking availability" };
  if (lastVisibleIndex <= 4) return { dot: "amber", text: "Scheduling showing" };
  // index 5 = final Theo reply "Done! Booked..."
  return { dot: "green", text: "Handoff routed", check: true };
};

function TheoSmsDemo() {
  const [elapsed, setElapsed] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      setElapsed((Date.now() - start) % LOOP_DURATION);
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  // Determine which steps are currently visible
  const activeSteps = theoTimeline.filter((entry) => entry.showAt <= elapsed);
  const lastActive = activeSteps[activeSteps.length - 1];
  const showTyping = lastActive?.step.type === "typing";

  // Collect message indices to show
  const visibleIndices = activeSteps
    .filter((e) => e.step.type === "message")
    .map((e) => (e.step as { type: "message"; index: number }).index);

  const visibleLines = visibleIndices.map((i) => theoThread[i]).filter(Boolean);
  const latestMsgIndex = visibleIndices[visibleIndices.length - 1];

  const status = getTheoStatus(latestMsgIndex);

  const handleTheoScroll = () => {
    const el = transcriptRef.current;
    if (!el) return;
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
    if (!isAtBottom) {
      userScrolledRef.current = true;
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        userScrolledRef.current = false;
      }, 3000);
    }
  };

  useEffect(() => {
    void elapsed;
    if (!userScrolledRef.current && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [elapsed]);

  return (
    <div className="mx-auto w-full max-w-[360px] rounded-[38px] border border-[#2e2e30] bg-[#080809] p-2.5 shadow-[0_34px_120px_rgba(0,0,0,0.44)]">
      <div className="flex h-[540px] flex-col overflow-hidden rounded-[30px] border border-[#252527] bg-[#0d0e0f] p-4">
        <div className="mx-auto mb-4 mt-1 h-5 w-20 rounded-full bg-black" />
        <div className="text-center">
          <div className="relative mx-auto size-14 overflow-hidden rounded-full border border-[var(--color-brand-violet)]/60 mb-2">
            <Image
              src="/images/agents/iris.png"
              alt="Iris AI"
              fill
              sizes="56px"
              className="object-cover"
            />
          </div>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
            Iris AI
          </p>
          <div
            className={`mt-2 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-all duration-500 ${
              status.dot === "green"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-[var(--color-gold-italic)]/45 bg-[#241d16] text-white"
            }`}
          >
            {status.check ? (
              <svg
                viewBox="0 0 16 16"
                className="size-3 fill-current text-emerald-400"
                aria-hidden="true"
              >
                <path d="M13.5 3.5L6 11 2.5 7.5 1 9l5 5 9-9z" />
              </svg>
            ) : (
              <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
            )}
            {status.text}
          </div>
        </div>

        <div className="my-4 h-px bg-[#2e2e30]" />

        <div
          ref={transcriptRef}
          onScroll={handleTheoScroll}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-[var(--color-brand-violet)]/40 scrollbar-track-transparent [scrollbar-color:#cb6ce6_#0d0e0f] [scrollbar-width:thin]"
        >
          {visibleLines.map((line) => {
            const isTheo = line.from === "ai";

            return (
              <div key={line.id} className="flex flex-col">
                {isTheo && (
                  <p className="mb-1 self-end text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                    IRIS · AI
                  </p>
                )}
                {!isTheo && (
                  <p className="mb-1 self-start text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                    PORTAL INQUIRY
                  </p>
                )}
                <div
                  className={[
                    "max-w-[88%] rounded-[22px] px-4 py-3 text-sm leading-relaxed shadow-[0_12px_36px_rgba(0,0,0,0.18)]",
                    isTheo
                      ? "self-end bg-[#1e1508] text-white"
                      : "self-start bg-[#1c1c1f] text-white",
                  ].join(" ")}
                >
                  {line.text}
                </div>
              </div>
            );
          })}
          {showTyping ? <TypingDots align="right" /> : null}
        </div>
      </div>
    </div>
  );
}

export function AriaDeepDive() {
  return (
    <section
      id="aria"
      className="bg-[#0a0e0c] py-20 md:py-28 border-t border-b border-white/[0.07] relative overflow-hidden"
    >
      <div
        data-motion="demo-glow"
        className="absolute left-1/2 top-0 h-[460px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(196,154,82,0.1),rgba(196,154,82,0)_62%)] blur-3xl"
      />
      <div
        data-motion="demo-glow"
        className="absolute right-[-14rem] top-24 h-[460px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(196,154,82,0.07),rgba(196,154,82,0)_64%)] blur-3xl"
      />

      <div className="relative mx-auto grid w-[min(1480px,calc(100vw_-_32px))] sm:w-[min(1480px,calc(100vw_-_32px))] gap-9 lg:grid-cols-[0.58fr_1.42fr] lg:items-start px-4 sm:px-0">
        <Reveal variant="left" data-motion="demo-copy" className="lg:sticky lg:top-32">
          <div>
            <h2 className="text-[clamp(2.4rem,4.6vw,4.2rem)] font-bold tracking-[-0.04em] leading-[1.02] text-white">
              Context across every channel.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/90">
              Iris remembers the full conversation, pulls real property details, and coordinates the
              channel layers so email, SMS, calls, website chat, and DMs all move toward a showing,
              valuation, or human handoff.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 auto-rows-fr">
            {microFeatures.map(({ icon: Icon, title, body }, index) => (
              <Reveal key={title} variant="scale" delay={index * 0.06} className="h-full">
                <GlowCard
                  glowColor="gold"
                  customSize
                  radius={12}
                  className="flex flex-col gap-0 p-4 h-full [--backdrop:rgba(18,12,28,0.28)] [--backup-border:rgba(160,120,64,0.15)]"
                >
                  <Icon className="size-6 text-white/90" aria-hidden />
                  <p className="mt-4 text-[1rem] font-semibold text-white">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-white/90">{body}</p>
                </GlowCard>
              </Reveal>
            ))}
          </div>
        </Reveal>

        {/* Bento grid: TOP=email full-width, BOTTOM=phone left + call right */}
        <div className="flex flex-col gap-6">
          {/* TOP: Email card — full width */}
          <Reveal variant="right" data-motion="demo-panel" className="min-h-[420px] w-full">
            <IrisEmailDemo />
          </Reveal>

          {/* BOTTOM: Phone left + Call right — equal halves */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Reveal variant="left" delay={0.06} data-motion="demo-panel" className="h-full">
              <GlowCard
                glowColor="gold"
                customSize
                className="flex min-h-[560px] items-center justify-center border border-white/10 [--backdrop:#0e1010]"
              >
                <TheoSmsDemo />
              </GlowCard>
            </Reveal>
            <Reveal variant="scale" delay={0.12} data-motion="demo-panel" className="h-full">
              <GlowCard
                glowColor="gold"
                customSize
                className="flex min-h-[620px] items-center justify-center border border-white/10 [--backdrop:#0e1010]"
              >
                <AriaPhoneDemo />
              </GlowCard>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
