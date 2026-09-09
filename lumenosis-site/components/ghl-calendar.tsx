import { GlowCard } from "@/components/spotlight-card";

export function GhlCalendar({ embedUrl, title }: { embedUrl: string; title: string }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-[34px] bg-[radial-gradient(60%_70%_at_15%_10%,rgba(203,108,230,0.18),transparent_60%),radial-gradient(70%_80%_at_84%_18%,rgba(232,196,122,0.1),transparent_64%),radial-gradient(80%_90%_at_50%_100%,rgba(37,45,80,0.12),transparent_68%)] blur-xl"
      />
      <GlowCard
        glowColor="purple"
        customSize
        radius={26}
        className="relative overflow-hidden !p-[2px] [--backdrop:linear-gradient(135deg,rgba(203,108,230,0.58),rgba(232,196,122,0.24)_34%,rgba(255,255,255,0.16)_58%,rgba(44,35,72,0.44))] [--backup-border:rgba(255,255,255,0.22)] [--border:1] [--outer:0.55] shadow-[0_18px_52px_rgba(7,5,14,0.18),0_0_0_1px_rgba(255,255,255,0.07)]"
      >
        <div className="relative h-[clamp(680px,calc(100svh-92px),900px)] overflow-hidden rounded-[24px] bg-white">
          <div className="pointer-events-none absolute inset-0 z-10 rounded-[24px] shadow-[inset_0_1px_0_rgba(255,255,255,0.38),inset_0_0_0_1px_rgba(255,255,255,0.18),inset_0_-72px_110px_rgba(12,10,18,0.08)]" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-white/16 to-transparent"
          />
          <iframe
            title={title}
            src={embedUrl}
            loading="lazy"
            className="relative z-0 block h-[calc(100%/0.92)] w-[calc(100%/0.92)] origin-top-left scale-[0.92] border-0 bg-white md:h-[calc(100%/0.82)] md:w-[calc(100%/0.82)] md:scale-[0.82] xl:h-[calc(100%/0.78)] xl:w-[calc(100%/0.78)] xl:scale-[0.78]"
            allow="payment"
          />
        </div>
      </GlowCard>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-12 -bottom-3 h-5 rounded-full bg-black/16 blur-lg"
      />
    </div>
  );
}
