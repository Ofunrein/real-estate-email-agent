import Image from "next/image";
import { AtIcon, LetterIcon, ReplyIcon, SignalIcon } from "@/components/icons/editorial";
import { Reveal } from "@/components/reveal";
import { GlowCard } from "@/components/spotlight-card";

const stats = [
  { value: "<60s", label: "first text" },
  { value: "12s", label: "avg pickup" },
  { value: "24/7", label: "coverage" },
  { value: "1", label: "timeline" },
];

const channels = [
  {
    channel: "Email",
    icon: LetterIcon,
    body: "Inbound email answered in your approved voice, with real property facts. Sensitive replies flagged for review.",
  },
  {
    channel: "Voice",
    icon: SignalIcon,
    body: "After-hours and overflow calls picked up in 12 seconds on average, qualified, summarized, and routed.",
  },
  {
    channel: "SMS",
    icon: ReplyIcon,
    body: "First text in under 60 seconds. Property links, showing windows, long-term nurture, every opt-out honored.",
  },
  {
    channel: "Web + Social",
    icon: AtIcon,
    body: "Website chat, forms, Instagram, Messenger, and WhatsApp captured and routed into your CRM workflow.",
  },
];

export function IrisLeadDeskSpotlight() {
  return (
    <section id="agents" className="py-24 md:py-32">
      <div className="mx-auto w-[min(1120px,calc(100vw-48px))] sm:w-[min(1120px,calc(100vw-48px))] xl:w-[min(1120px,calc(100vw-80px))]">
        <div className="mb-14 text-center md:mb-16">
          <h2 className="mx-auto text-[clamp(1.9rem,4vw,3.1rem)] font-bold tracking-[-0.035em] leading-[1.05] text-[var(--color-ink)] max-w-[640px]">
            One agent. Every channel.
          </h2>
          <p className="mx-auto mt-4 text-[1.0625rem] text-[var(--color-muted)] max-w-[520px] leading-relaxed">
            Meet Iris, your new front desk. One shared memory across email, calls, texts, chat, and DMs,
            so nothing falls through.
          </p>
        </div>

        {/* Iris hero card */}
        <Reveal variant="scale">
          <GlowCard
            glowColor="gold"
            radius={18}
            className="flex flex-col items-start gap-8 p-8 md:flex-row md:items-center md:p-10 [--border:2] [--backup-border:rgba(14,14,15,0.14)] dark:[--backdrop:#111013] dark:[--backup-border:rgba(196,154,82,0.18)]"
          >
            <div className="relative size-24 shrink-0 overflow-hidden rounded-full border-2 border-[var(--color-brand-amber-soft)] md:size-28">
              <Image
                src="/images/agents/iris.png"
                alt="Iris, the Lumenosis front desk agent"
                fill
                sizes="112px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-[1.5rem] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
                  Iris
                </p>
                <p className="text-[0.875rem] font-medium text-[var(--color-brand-amber)]">
                  Your front desk · 24/7
                </p>
              </div>
              <p className="mt-3 max-w-[560px] text-[0.9375rem] leading-[1.7] text-[var(--color-muted)]">
                Iris remembers every conversation across every channel, answers with real property
                data, and keeps one timeline per lead. When a conversation turns legal, financial,
                or hot, she hands it to a human — with the full context attached.
              </p>
            </div>
            <div className="grid w-full shrink-0 grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-line)] md:w-auto">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="bg-[var(--color-bg-cream)] px-4 py-3 md:min-w-[118px] dark:bg-[#111013]"
                >
                  <p className="font-mono text-[1rem] font-medium text-[var(--color-ink)] tabular-nums">
                    {s.value}
                  </p>
                  <p className="mt-0.5 text-[0.625rem] uppercase tracking-[0.08em] text-[var(--color-muted)]">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </GlowCard>
        </Reveal>

        {/* Channel cards */}
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {channels.map((c, index) => (
            <Reveal key={c.channel} variant="up" delay={index * 0.06} className="h-full">
              <GlowCard
                glowColor="gold"
                radius={14}
                className="flex h-full flex-col p-6 [--border:2] [--backup-border:rgba(14,14,15,0.12)] dark:[--backdrop:#111013] dark:[--backup-border:rgba(196,154,82,0.14)]"
              >
                <c.icon className="size-6 text-[var(--color-ink)]" aria-hidden />
                <p className="mt-4 text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
                  {c.channel}
                </p>
                <p className="mt-2 text-[0.875rem] leading-[1.65] text-[var(--color-muted)]">
                  {c.body}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
