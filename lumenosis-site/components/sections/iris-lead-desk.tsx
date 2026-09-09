import Image from "next/image";
import { AtIcon, LetterIcon, ReplyIcon, SignalIcon } from "@/components/icons/editorial";
import { Reveal } from "@/components/reveal";
import { GlowCard } from "@/components/spotlight-card";

const channels = [
  {
    num: "01",
    channel: "Email",
    icon: LetterIcon,
    stat: "timeline",
    kicker: "approved voice",
    body: "Answers inbound email in your approved voice with real property facts — price, beds, baths, links, and photos. Flags legal, financing, and sensitive replies for your review.",
  },
  {
    num: "02",
    channel: "Voice",
    icon: SignalIcon,
    stat: "avg pickup",
    kicker: "12s avg pickup",
    body: "Picks up after-hours and overflow calls, qualifies inquiry type, timeline, and urgency, then summarizes every call and routes showings and valuations when approved.",
  },
  {
    num: "03",
    channel: "SMS",
    icon: ReplyIcon,
    stat: "first text",
    kicker: "<60s first text",
    body: "Sends the first text in under 60 seconds, shares property links and showing windows, runs long-term nurture for leads not ready to move, and honors every opt-out.",
  },
  {
    num: "04",
    channel: "Web + Social",
    icon: AtIcon,
    stat: "coverage",
    kicker: "always on",
    body: "Handles website chat, form fills, Instagram, Facebook Messenger, and WhatsApp. Captures name, phone, intent, and source, then routes urgent conversations into your CRM.",
  },
];

const stats = [
  { value: "<60s", label: "first text" },
  { value: "12s", label: "avg pickup" },
  { value: "24/7", label: "coverage" },
  { value: "1", label: "timeline" },
];

export function IrisLeadDesk() {
  return (
    <section id="agents" className="relative overflow-hidden py-24 md:py-32">
      {/* Ambient amber wash, echoing the demo section's treatment */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[-12rem] top-16 h-[420px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(196,154,82,0.07),rgba(196,154,82,0)_65%)] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-6rem] right-[-10rem] h-[380px] w-[480px] rounded-full bg-[radial-gradient(circle,rgba(196,154,82,0.05),rgba(196,154,82,0)_65%)] blur-3xl"
      />

      <div className="relative mx-auto w-[min(1120px,calc(100vw-48px))] sm:w-[min(1120px,calc(100vw-48px))] xl:w-[min(1120px,calc(100vw-80px))]">
        <div data-motion="iris-header" className="mb-14 md:mb-18">
          <p className="mb-3 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-[var(--color-brand-amber)]">
            The system
          </p>
          <h2 className="text-[clamp(1.9rem,4vw,3.1rem)] font-bold tracking-[-0.035em] leading-[1.05] text-[var(--color-ink)] max-w-[600px]">
            One agent. Every channel.
          </h2>
          <p className="mt-4 text-[1.0625rem] text-[var(--color-muted)] max-w-[520px] leading-relaxed">
            Meet Iris, your front desk. She answers every channel with one shared memory, so your
            leads never repeat themselves and nothing falls through.
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[340px_1fr] lg:gap-14 items-start">
          {/* Iris identity card */}
          <Reveal variant="left" data-motion="iris-card" className="lg:sticky lg:top-32">
            <GlowCard
              glowColor="gold"
              radius={16}
              className="flex flex-col p-7 [--border:2] [--backup-border:rgba(14,14,15,0.14)] dark:[--backdrop:#111013] dark:[--backup-border:rgba(196,154,82,0.18)]"
            >
              <div className="flex items-start justify-between">
                <div className="relative size-20 overflow-hidden rounded-full border-2 border-[var(--color-brand-amber)]/40 shadow-[0_0_24px_rgba(196,154,82,0.18)]">
                  <Image
                    src="/images/agents/iris.png"
                    alt="Iris, the Lumenosis front desk agent"
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-brand-amber-soft)] px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-[var(--color-ink)]">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Online
                </span>
              </div>
              <p className="mt-5 text-[1.375rem] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
                Iris
              </p>
              <p className="mt-1 text-[0.875rem] text-[var(--color-brand-amber)] font-medium">
                Your front desk
              </p>
              <p className="mt-4 text-[0.9375rem] text-[var(--color-muted)] leading-[1.7]">
                Remembers the full conversation across every channel, pulls real property details,
                and hands off to a human the moment a conversation needs one.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-line)]">
                {stats.map((s) => (
                  <div
                    key={s.label}
                    data-stat-cell={s.label}
                    className="bg-[var(--color-bg-cream)] px-4 py-3 dark:bg-[#111013]"
                  >
                    <p className="font-mono text-[1.0625rem] font-medium text-[var(--color-ink)] tabular-nums">
                      {s.value}
                    </p>
                    <p className="mt-0.5 text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--color-muted)]">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            </GlowCard>
          </Reveal>

          {/* Channel rows */}
          <div className="divide-y divide-[var(--color-line)]">
            {channels.map((c, index) => (
              <Reveal key={c.num} variant="up" delay={index * 0.06}>
                <div
                  data-motion="iris-row"
                  data-stat={c.stat}
                  className="group relative grid grid-cols-[3rem_1fr] md:grid-cols-[3rem_180px_1fr] gap-x-5 md:gap-x-8 gap-y-1 py-7 md:py-8 items-start"
                >
                  {/* Hover rail */}
                  <span
                    aria-hidden
                    data-motion="iris-rail"
                    className="absolute left-[-1.25rem] top-1/2 h-0 w-[2px] -translate-y-1/2 rounded-full bg-[var(--color-brand-amber)] transition-all duration-300 ease-out group-hover:h-[calc(100%-3.5rem)]"
                  />
                  <span
                    data-motion="iris-num"
                    className="text-[0.6875rem] font-mono font-medium text-[var(--color-muted)] tracking-[0.06em] pt-1.5 tabular-nums transition-colors duration-300 group-hover:text-[var(--color-brand-amber)]"
                  >
                    {c.num}
                  </span>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <c.icon
                        className="size-[18px] shrink-0 text-[var(--color-ink)] transition-transform duration-300 group-hover:scale-110"
                        aria-hidden
                      />
                      <p className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
                        {c.channel}
                      </p>
                    </div>
                    <p className="pl-7 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-[var(--color-muted)] md:pl-7">
                      {c.kicker}
                    </p>
                  </div>
                  <p className="col-start-2 md:col-start-3 text-[0.9375rem] text-[var(--color-muted)] leading-[1.7] max-w-[560px] mt-1 md:mt-0">
                    {c.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
