import type React from "react";
import { GlowCard } from "@/components/spotlight-card";

const plans = [
  {
    pkg: "PACKAGE 01 · TEAM",
    title: "Install Iris",
    titleItalic: "Lead Desk.",
    description:
      "For operators already investing in inquiries and losing opportunities to slow, fragmented follow-up.",
    bestFor: "3-15 operator teams, portal inquiry buyers, Meta/Google ad teams, and brokerages without reliable response coverage",
    features: [
      "Email, SMS, calls, website chat, and social DM coverage",
      "Shared conversation timeline across every channel",
      "Property data brain from sheets, CRM, IDX export, or enrichment",
      "Human review rules for financing, legal, pricing, and sensitive replies",
      "CRM and calendar routing",
      "Two-week launch with optimization included",
    ],
    cta: "Request a Demo",
    ctaHref: "#book",
    featured: false,
    popular: false,
  },
  {
    pkg: "PACKAGE 02 · GROWTH",
    title: "Expand your",
    titleItalic: "operation.",
    description:
      "A managed omnichannel desk for brokerages, growth teams, and agencies with multiple sources, operators, markets, or client accounts.",
    bestFor: "Brokerages, multi-operator offices, white-label agencies, growth teams",
    features: [
      "Operator routing by market, source, urgency, language, or office",
      "Follow Up Boss, Lofty, kvCORE, GoHighLevel, HubSpot, or custom CRM",
      "Calendar, inquiry source, and property source integrations",
      "Owner visibility for operators, handoffs, and stuck conversations",
      "Ongoing monitoring, prompt tuning, reporting, and expansion",
    ],
    cta: "Map the Growth Build →",
    ctaHref: "#book",
    featured: true,
    popular: true,
  },
] as const;

export function TwoWaysIn() {
  return (
    <section id="plans" className="border-t border-[var(--color-line)] py-24 md:py-32">
      <div className="mx-auto w-[min(1120px,calc(100vw-48px))] sm:w-[min(1120px,calc(100vw-48px))] xl:w-[min(1120px,calc(100vw-80px))]">

        <div className="mb-14 md:mb-16">
          <h2 className="text-[clamp(1.9rem,4vw,3.1rem)] font-bold tracking-[-0.035em] leading-[1.05] text-[var(--color-ink)] max-w-[560px]">
            Install the desk that fits your operation.
          </h2>
          <p className="mt-4 text-[1.0625rem] text-[var(--color-muted)] max-w-[440px] leading-relaxed">
            Both options run the same AI system. The difference is scope, routing complexity, and how many channels you're coordinating.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 auto-rows-fr">
          {plans.map((plan) => (
            <GlowCard
              key={plan.pkg}
              glowColor="purple"
              customSize
              radius={14}
              className="relative flex flex-col p-7 h-full"
              style={{
                "--backdrop": plan.featured ? "#0d0d0e" : "transparent",
                borderColor: plan.featured ? "rgba(196,154,82,0.5)" : "var(--color-line)",
                border: `1px solid ${plan.featured ? "rgba(196,154,82,0.5)" : "var(--color-line)"}`,
              } as React.CSSProperties}
            >
              <div className="flex items-center justify-between gap-3 mb-5">
                <span
                  className="text-[0.625rem] font-mono font-semibold uppercase tracking-[0.14em]"
                  style={{ color: plan.featured ? "rgba(196,154,82,0.8)" : "var(--color-muted)" }}
                >
                  {plan.pkg}
                </span>
                {plan.popular && (
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded-sm text-[0.5625rem] font-bold uppercase tracking-[0.14em]"
                    style={{ border: "1px solid rgba(196,154,82,0.4)", color: "rgba(196,154,82,0.9)" }}
                  >
                    Most Popular
                  </span>
                )}
              </div>

              <h3
                className="text-[1.375rem] font-bold tracking-[-0.02em] leading-[1.2]"
                style={{ color: plan.featured ? "#fff" : "var(--color-ink)" }}
              >
                {plan.title}{" "}
                <em
                  className="not-italic"
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    fontStyle: "italic",
                    color: plan.featured ? "rgba(196,154,82,0.9)" : "var(--color-brand-amber)",
                  }}
                >
                  {plan.titleItalic}
                </em>
              </h3>

              <p
                className="mt-3 text-[0.9375rem] leading-relaxed"
                style={{ color: plan.featured ? "rgba(255,255,255,0.75)" : "var(--color-muted)" }}
              >
                {plan.description}
              </p>

              <div
                className="mt-5 pt-5 border-t"
                style={{ borderColor: plan.featured ? "rgba(255,255,255,0.08)" : "var(--color-line)" }}
              >
                <p className="text-[0.6875rem]" style={{ color: plan.featured ? "rgba(255,255,255,0.5)" : "var(--color-muted)" }}>
                  <span className="font-bold uppercase tracking-[0.1em] mr-2">Best for</span>
                  {plan.bestFor}
                </p>
              </div>

              <ul className="mt-5 grid gap-2.5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[0.875rem]">
                    <svg viewBox="0 0 14 14" className="mt-[2px] size-3.5 shrink-0" fill="none" aria-hidden>
                      <path
                        d="M2.5 7l3 3 6-6"
                        stroke={plan.featured ? "rgba(196,154,82,0.8)" : "var(--color-muted)"}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span style={{ color: plan.featured ? "rgba(255,255,255,0.82)" : "var(--color-muted)" }}>{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href={plan.ctaHref}
                className="mt-8 inline-flex items-center justify-center h-11 rounded-full text-[14px] font-semibold transition-opacity hover:opacity-85 active:scale-[0.97]"
                style={{
                  background: plan.featured ? "rgba(196,154,82,1)" : "var(--color-ink)",
                  color: plan.featured ? "#0f0c08" : "var(--color-bg)",
                  border: "none",
                }}
              >
                {plan.cta}
              </a>
            </GlowCard>
          ))}
        </div>
      </div>
    </section>
  );
}
