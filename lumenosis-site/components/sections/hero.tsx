"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { RotatingText } from "@/components/rotating-text";

const HERO_IMAGE_ALT =
  "Modern hillside home overlooking a valley, wildflower meadow in the foreground";
const HERO_IMAGE_QUALITY = 95;
const RESPONSE_STEPS = ["3 days", "12 hours", "60 minutes", "< 60 seconds"];
const CHANNEL_MAX = 7;

function useCountUp(to: number, durationMs = 1200) {
  const [val, setVal] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    const steps = to;
    const interval = durationMs / steps;
    let current = 0;
    const id = setInterval(() => {
      current += 1;
      setVal(current);
      if (current >= to) clearInterval(id);
    }, interval);
    return () => clearInterval(id);
  }, [started, to, durationMs]);

  return { val, trigger: () => setStarted(true) };
}

function useResponseCycle(durationMs = 800) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    if (idx >= RESPONSE_STEPS.length - 1) return;
    const fadeOut = setTimeout(() => setVisible(false), durationMs - 150);
    const next = setTimeout(() => {
      setIdx((i) => i + 1);
      setVisible(true);
    }, durationMs);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(next);
    };
  }, [started, idx, durationMs]);

  return { label: RESPONSE_STEPS[idx], visible, trigger: () => setStarted(true) };
}

export function Hero() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsTriggered, setStatsTriggered] = useState(false);

  const response = useResponseCycle(1100);
  const channels = useCountUp(CHANNEL_MAX, 1800);
  const hours = useCountUp(24, 1600);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Trigger stat animations when section enters view
  useEffect(() => {
    if (statsTriggered || reduceMotion) return;
    const el = statsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStatsTriggered(true);
          response.trigger();
          channels.trigger();
          hours.trigger();
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsTriggered, reduceMotion]);

  return (
    <section
      id="top"
      className="relative min-h-[100dvh] flex flex-col justify-center overflow-hidden"
    >
      {/* Full-bleed image with no vignette or drop shadow. */}
      <div data-motion="hero-media" className="absolute inset-0 z-0">
        <div className="absolute inset-0">
          <Image
            src="/images/hero-hillside-day.webp"
            alt={HERO_IMAGE_ALT}
            fill
            priority
            quality={HERO_IMAGE_QUALITY}
            sizes="100vw"
            className="object-cover object-[58%_center] opacity-100 transition-opacity duration-300 dark:opacity-0"
          />
          <Image
            src="/images/hero-hillside-dusk.webp"
            alt=""
            aria-hidden
            fill
            priority
            quality={HERO_IMAGE_QUALITY}
            sizes="100vw"
            className="object-cover object-[58%_center] opacity-0 transition-opacity duration-300 dark:opacity-100"
          />
          <div className="absolute inset-y-0 left-0 w-[min(800px,72vw)] bg-gradient-to-r from-white/68 via-white/38 to-transparent dark:hidden" />
          <div className="absolute inset-y-0 left-0 hidden w-[min(800px,72vw)] bg-gradient-to-r from-black/68 via-black/38 to-transparent dark:block" />
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto w-[min(1120px,calc(100vw-48px))] xl:w-[min(1120px,calc(100vw-80px))] pt-28 pb-20 lg:pt-36 lg:pb-28">
        <div data-motion="hero-copy" className="max-w-[620px]">
          <h1 className="text-[clamp(1.75rem,3.8vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.04em] text-[var(--color-ink)]">
            <span className="sr-only">
              The AI operations layer for real estate teams, brokerages, property managers,
              short-term rental operators, and investors.
            </span>
            <span aria-hidden="true">
              <span className="block whitespace-nowrap">AI operations for</span>
              <span className="block text-[var(--color-brand-amber)] min-h-[1.1em]">
                <RotatingText
                  words={[
                    "real estate teams",
                    "brokerages",
                    "property managers",
                    "short-term rentals",
                    "investors",
                  ]}
                  intervalMs={2200}
                  minWidth="min(100%, 17ch)"
                />
              </span>
            </span>
          </h1>

          <p className="mt-6 text-[1.0625rem] leading-[1.65] text-[var(--color-muted)] max-w-[460px]">
            Close more deals while Iris handles calls, emails, follow-ups, and the busy work.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#book"
              className="inline-flex items-center px-6 h-11 rounded-full text-[14px] font-semibold bg-[var(--color-ink)] text-[var(--color-bg)] hover:opacity-85 transition-opacity active:scale-[0.97]"
            >
              Request a Demo
            </a>
            <a
              href="#agents"
              className="inline-flex items-center px-6 h-11 rounded-full text-[14px] font-medium border border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-line)] transition-colors"
            >
              See how it works
            </a>
          </div>

          {/* Animated stats */}
          <div ref={statsRef} className="mt-10 flex flex-wrap gap-7">
            {/* Stat 1: response time — cycles from days → hours → minutes → seconds */}
            <div className="min-w-[130px]">
              <p
                className="text-[1.25rem] font-semibold tracking-[-0.025em] text-[var(--color-ink)] transition-opacity duration-150"
                style={{ opacity: response.visible ? 1 : 0 }}
              >
                {reduceMotion ? "< 60 seconds" : response.label}
              </p>
              <p className="text-[0.8125rem] text-[var(--color-muted)] mt-0.5">first response</p>
            </div>

            {/* Stat 2: channel count — counts up 1→7 */}
            <div>
              <p className="text-[1.25rem] font-semibold tracking-[-0.025em] text-[var(--color-ink)] tabular-nums">
                {reduceMotion ? "7+" : `${channels.val}${channels.val >= CHANNEL_MAX ? "+" : ""}`}
              </p>
              <p className="text-[0.8125rem] text-[var(--color-muted)] mt-0.5">channels covered</p>
            </div>

            {/* Stat 3: 24/7 — counts up to 24 */}
            <div>
              <p className="text-[1.25rem] font-semibold tracking-[-0.025em] text-[var(--color-ink)] tabular-nums">
                {reduceMotion ? "24/7" : `${hours.val}/7`}
              </p>
              <p className="text-[0.8125rem] text-[var(--color-muted)] mt-0.5">
                no nights or weekends
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
