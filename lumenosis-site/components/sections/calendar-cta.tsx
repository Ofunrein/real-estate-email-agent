import { GhlCalendar } from "@/components/ghl-calendar";
import { Reveal } from "@/components/reveal";

export function CalendarCTA() {
  const embedUrl = process.env.NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL ?? "";

  return (
    <section
      id="book"
      className="border-t border-[var(--color-line)] py-16 md:py-20"
    >
      <div className="mx-auto grid min-h-[calc(100svh-96px)] w-[min(1120px,calc(100vw-48px))] sm:w-[min(1120px,calc(100vw-48px))] xl:w-[min(1120px,calc(100vw-80px))] items-center gap-10 md:grid-cols-[0.72fr_1.28fr]">
        <Reveal variant="left">
          <div>
            <h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.04em] leading-[1.05] text-[var(--color-ink)]">
              A 30-minute demo that&apos;s actually useful.
            </h2>
            <ul className="mt-6 grid gap-3 text-[0.9375rem] text-[var(--color-muted)] leading-relaxed">
              <li>We map your inquiry sources, CRM, calendar, and handoff rules.</li>
              <li>We find where conversations wait, repeat, or lose context.</li>
              <li>You leave with an installation path and first-channel priority.</li>
              <li>If we&apos;re not the right fit, we tell you what to fix first.</li>
            </ul>
          </div>
        </Reveal>
        <Reveal variant="right" delay={0.08} className="grid gap-5">
          {embedUrl ? (
            <GhlCalendar embedUrl={embedUrl} title="Lumenosis AI strategy call calendar" />
          ) : (
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg-cream)] p-6 text-[var(--color-muted)] dark:bg-white/[0.04]">
              Calendar embed is configured via NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL env var.
            </div>
          )}
        </Reveal>
      </div>
    </section>
  );
}
