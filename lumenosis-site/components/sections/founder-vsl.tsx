"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/reveal";
import { GlowCard } from "@/components/spotlight-card";

export function FounderVSL() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setVisible(true);
      },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="vsl"
      className="border-b border-[var(--color-line)] bg-[#f8f6ef] py-16 dark:bg-transparent md:py-24"
    >
      <div className="mx-auto grid w-[min(1200px,calc(100vw_-_40px))] sm:w-[min(1200px,calc(100vw_-_32px))] items-center gap-10 md:grid-cols-[0.85fr_1.15fr]">
        <Reveal variant="left">
          <div>
            <p className="mb-3 text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-purple)]">
              01 · Watch First
            </p>
            <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-display-section)] font-semibold leading-[1.05] text-[var(--color-ink-charcoal)]">
              <span className="headline-plain">You are already paying for conversations.</span>{" "}
              <em className="text-[var(--color-gold-italic)]">Iris makes sure they get handled.</em>
            </h2>
            <ul className="mt-6 grid gap-3 text-[var(--color-muted)]">
              <li className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-brand-purple)]"
                />
                <span>Fast response only works when every channel shares memory.</span>
              </li>
              <li className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-brand-purple)]"
                />
                <span>
                  Portal inquiries, paid ads, calls, chats, and DMs need one owner and one handoff.
                </span>
              </li>
              <li className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-brand-purple)]"
                />
                <span>This is not an AI ISA. It is a managed response system.</span>
              </li>
              <li className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-brand-purple)]"
                />
                <span>
                  Done right, your operators see replies, qualification, handoffs, and review in one
                  place.
                </span>
              </li>
            </ul>
            <a
              href="#book"
              className="mt-8 inline-flex h-12 items-center justify-center rounded-full bg-[var(--color-brand-charcoal)] px-6 text-sm font-semibold text-white shadow-[0_18px_40px_rgb(25_18_35_/_0.18)] transition hover:-translate-y-0.5 hover:bg-[var(--color-brand-purple)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-purple)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f8f6ef] dark:bg-[var(--color-brand-violet)] dark:text-white dark:shadow-[var(--shadow-glow-violet)] dark:focus-visible:ring-offset-[#08050c]"
            >
              Request Demo
            </a>
          </div>
        </Reveal>
        <Reveal variant="scale">
          <GlowCard
            glowColor="purple"
            customSize
            className="overflow-hidden p-0 [--backdrop:#fffaf0] [--backup-border:rgb(203_108_230_/_0.22)] dark:[--backdrop:#14111d] dark:[--backup-border:rgb(232_196_122_/_0.22)]"
          >
            <div className="rounded-2xl bg-[#fffaf0] p-3 shadow-[0_24px_70px_rgb(25_18_35_/_0.2)] dark:bg-[#14111d]">
              <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[#f4efe2] dark:border-white/10 dark:bg-[#211a2d]">
                <div className="flex h-11 items-center justify-between border-b border-[var(--color-line)] bg-[#fff7e8] px-4 dark:border-white/10 dark:bg-[#1b1626]">
                  <div className="flex items-center gap-2" aria-hidden>
                    <span className="size-3 rounded-full bg-[#ff6b6b]" />
                    <span className="size-3 rounded-full bg-[#e8c47a]" />
                    <span className="size-3 rounded-full bg-[#62c184]" />
                  </div>
                  <span className="h-2 w-12 rounded-full bg-[var(--color-brand-purple)]/25 dark:bg-[var(--color-gold-italic)]/35" />
                </div>

                <div className="relative aspect-video w-full overflow-hidden bg-[#0c0914]">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_40%,rgb(120_60_160_/_0.35),transparent_60%),radial-gradient(ellipse_at_20%_80%,rgb(232_196_122_/_0.12),transparent_50%)]" />
                  <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgb(12_9_18_/_0.88),transparent)] p-5 text-white sm:p-7">
                    <p className="max-w-[26rem] font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight sm:text-4xl">
                      The 7-minute case for a managed front desk.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Play overview video"
                    className="group absolute inset-0 grid place-items-center text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-purple)]"
                  >
                    <span
                      className={`grid place-items-center rounded-full border border-white/35 bg-[var(--color-brand-purple)] shadow-[0_12px_36px_rgb(203_108_230_/_0.45)] size-14 sm:size-16 group-hover:scale-110 group-hover:shadow-[0_16px_60px_rgb(203_108_230_/_0.75)] group-hover:border-white/60 group-hover:bg-[var(--color-brand-violet)] ${visible ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
                      style={{
                        transition:
                          "opacity 0.4s, transform 0.35s ease, box-shadow 0.35s ease, border-color 0.35s ease, background-color 0.35s ease",
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="ml-0.5 size-5 group-hover:scale-110 transition-transform duration-300"
                        fill="currentColor"
                        aria-hidden
                      >
                        <title>Play overview</title>
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 bg-[#fff7e8] px-4 py-3 dark:bg-[#1b1626]">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)] dark:text-white/50">
                    <span className="rounded-full bg-[var(--color-brand-violet-soft)] px-2.5 py-1 text-[9px] font-bold text-[var(--color-brand-violet)]">
                      FEATURED
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </GlowCard>
        </Reveal>
      </div>
    </section>
  );
}
