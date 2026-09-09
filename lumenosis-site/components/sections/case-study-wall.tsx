"use client";

import { useMemo, useState } from "react";
import { Reveal } from "@/components/reveal";
import { GlowCard } from "@/components/spotlight-card";
import { caseStudies } from "@/content/case-studies";

type CaseStudyCard = (typeof caseStudies)[number] & {
  attribution?: string;
  metric?: string;
};

const categoryLabels: Record<string, string> = {
  booking: "Booking",
  revenue: "Revenue",
  speed: "Speed",
  volume: "Volume",
  cost: "Cost",
  quality: "Quality",
};

export function CaseStudyWall() {
  const [activeCategory, setActiveCategory] = useState("all");

  const categories = useMemo(
    () => Array.from(new Set(caseStudies.map((study) => study.category))),
    [],
  );

  const visibleStudies =
    activeCategory === "all"
      ? caseStudies
      : caseStudies.filter((study) => study.category === activeCategory);

  return (
    <section
      id="results"
      className="border-b border-[var(--color-line)] bg-[#f1eee6] py-16 dark:bg-transparent md:py-24"
    >
      <div className="mx-auto w-[min(1200px,calc(100vw_-_40px))] sm:w-[min(1200px,calc(100vw_-_32px))]">
        <Reveal variant="up">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.14fr)_minmax(0,0.86fr)] lg:items-end">
            <div>
              <span className="mb-3 inline-block text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-purple)]">
                07 · Results
              </span>
              <h2 className="headline-plain max-w-[980px] text-[clamp(2.65rem,4.85vw,5.05rem)] text-[var(--color-ink-charcoal)]">
                Real outcomes from managed deployments.
              </h2>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                aria-pressed={activeCategory === "all"}
                onClick={() => setActiveCategory("all")}
                className={`rounded-[var(--radius-pill)] border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-purple)] focus-visible:ring-offset-2 ${
                  activeCategory === "all"
                    ? "border-[var(--color-brand-purple)] bg-[var(--color-brand-purple)] text-white"
                    : "border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-brand-purple)] hover:text-[var(--color-ink-charcoal)] dark:bg-white/[0.06] dark:text-white dark:hover:text-white"
                }`}
              >
                All Results
              </button>
              {categories.map((category) => {
                const isActive = activeCategory === category;

                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveCategory(category)}
                    className={`rounded-[var(--radius-pill)] border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-purple)] focus-visible:ring-offset-2 ${
                      isActive
                        ? "border-[var(--color-brand-purple)] bg-[var(--color-brand-purple)] text-white"
                        : "border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-brand-purple)] hover:text-[var(--color-ink-charcoal)] dark:bg-white/[0.06] dark:text-white dark:hover:text-white"
                    }`}
                  >
                    {categoryLabels[category] ?? category}
                  </button>
                );
              })}
            </div>
          </div>
        </Reveal>

        <div className="mt-10 columns-1 gap-4 sm:columns-2 lg:columns-3">
          {visibleStudies.map((study, index) => {
            const card = study as CaseStudyCard;
            const result = card.result ?? card.metric ?? "Result";
            const attribution =
              card.attribution ?? [card.name, card.role, card.location].filter(Boolean).join(", ");

            return (
              <Reveal
                key={`${card.name}-${card.quote}`}
                variant={index % 3 === 0 ? "left" : index % 3 === 1 ? "scale" : "right"}
                delay={(index % 6) * 0.05}
                className="mb-4 break-inside-avoid"
              >
                <GlowCard
                  glowColor="purple"
                  customSize
                  className="overflow-hidden rounded-2xl p-5 [--backdrop:#ffffff] [--backup-border:var(--color-line)] [--size:200] dark:[--backdrop:#14101c] dark:[--backup-border:rgba(203,108,230,0.25)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <p className="font-[family-name:var(--font-display)] text-[clamp(1.8rem,3vw,2.55rem)] font-semibold leading-none text-[var(--color-ink-charcoal)] dark:text-white">
                      {result}
                    </p>
                    <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--color-brand-purple-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-brand-purple)]">
                      {card.tag ?? categoryLabels[card.category] ?? card.category}
                    </span>
                  </div>

                  <blockquote className="mt-5 text-[var(--text-body-lg)] leading-snug text-[var(--color-ink-charcoal)]">
                    &ldquo;{card.quote}&rdquo;
                  </blockquote>

                  <p className="mt-5 text-sm font-semibold text-[var(--color-ink-charcoal)]">
                    {attribution}
                  </p>
                </GlowCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
