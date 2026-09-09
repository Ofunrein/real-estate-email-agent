"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/reveal";
import { GlowCard } from "@/components/spotlight-card";

const leaks = [
  {
    n: "01",
    title: "Expensive inquiries wait",
    body: "A paid inquiry keeps shopping while your team figures out who owns the response.",
  },
  {
    n: "02",
    title: "Every channel starts over",
    body: "Email, SMS, calls, chats, and DMs live in separate threads, so context gets lost.",
  },
  {
    n: "03",
    title: "No clear next step",
    body: "A conversation may be ready to tour, sell, book, or hand off, but the next step is buried.",
  },
];

type Stat = {
  kind: "response" | "count";
  prefix?: string;
  suffix?: string;
  target: number;
  label: string;
};

const stats: Stat[] = [
  { kind: "response", target: 60, label: "first response target" },
  { kind: "count", prefix: "", suffix: "+", target: 7, label: "channels covered" },
  { kind: "count", prefix: "", suffix: "/7", target: 24, label: "response window" },
];

function useProgress(active: boolean, duration = 1400) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!active) return;
    setProgress(0);
    const start = performance.now();
    let frame = 0;

    const raf = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(raf);
    };

    frame = requestAnimationFrame(raf);
    return () => cancelAnimationFrame(frame);
  }, [active, duration]);

  return progress;
}

function formatResponseTarget(progress: number) {
  if (progress < 0.35) {
    const days = Math.max(1, Math.round(3 - (progress / 0.35) * 2));
    return `${days} days`;
  }

  if (progress < 0.78) {
    const hours = Math.max(1, Math.round(24 - ((progress - 0.35) / 0.43) * 23));
    return `${hours} hrs`;
  }

  const seconds = Math.max(60, Math.round(300 - ((progress - 0.78) / 0.22) * 240));
  return `${seconds} sec`;
}

function StatItem({ kind, prefix, suffix, target, label, active }: Stat & { active: boolean }) {
  const progress = useProgress(active, kind === "response" ? 1800 : 1200);
  const value =
    kind === "response"
      ? formatResponseTarget(progress)
      : `${prefix ?? ""}${Math.round(progress * target)}${suffix ?? ""}`;

  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span className="font-[family-name:var(--font-display)] text-[clamp(2.2rem,4vw,3.5rem)] font-semibold leading-none text-[var(--color-ink-charcoal)] dark:text-white">
        {value}
      </span>
      <span className="text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</span>
    </div>
  );
}

export function ProblemAgitation() {
  const statsRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setActive(true);
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      id="method"
      className="border-b border-[var(--color-line)] bg-[#f1eee6] py-16 dark:bg-[rgb(9_7_13_/_0.76)] md:py-24"
    >
      <div className="mx-auto w-[min(1200px,calc(100vw_-_52px))] sm:w-[min(1200px,calc(100vw_-_32px))]">
        <Reveal variant="up">
          <div className="max-w-2xl">
            <p className="mb-3 text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-purple)]">
              02 — The leak
            </p>
            <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-display-section)] font-semibold leading-[1.05] text-[var(--color-ink-charcoal)]">
              <span className="headline-plain">The leak is not conversation volume.</span>{" "}
              <em className="text-[var(--color-gold-italic)]">It is response continuity.</em>
            </h2>
            <p className="mt-4 text-[length:var(--text-body-lg)] text-[var(--color-muted)]">
              Operators already pay for attention through portals, paid ads, referrals, websites,
              social, and guest or owner inquiry sources. Iris sits between email, SMS, calls,
              website chat, Instagram, Facebook Messenger, WhatsApp, your CRM, calendar, and human
              team so every conversation gets a fast, contextual reply.
            </p>
          </div>
        </Reveal>

        <Reveal variant="scale" delay={0.08}>
          <div
            ref={statsRef}
            className="mt-10 mb-10 grid grid-cols-3 divide-x divide-[var(--color-line)] overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white/60 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.03]"
          >
            {stats.map((s) => (
              <div key={s.label} className="px-4 py-8">
                <StatItem {...s} active={active} />
              </div>
            ))}
          </div>
        </Reveal>

        <div className="grid items-stretch gap-4 md:grid-cols-3">
          {leaks.map((leak, index) => (
            <Reveal key={leak.n} variant="scale" delay={index * 0.1} className="h-full">
              <GlowCard
                glowColor="purple"
                customSize
                className="flex h-full min-h-[280px] flex-col dark:[--color-bg-cream:#111019]"
              >
                <div className="mb-3 grid size-9 place-items-center rounded-lg bg-[var(--color-brand-purple-soft)] text-sm font-bold text-[var(--color-brand-purple)]">
                  {leak.n}
                </div>
                <h3 className="headline-plain text-xl leading-tight text-[var(--color-ink-charcoal)]">
                  {leak.title}
                </h3>
                <p className="mt-2 text-[var(--color-muted)]">{leak.body}</p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
