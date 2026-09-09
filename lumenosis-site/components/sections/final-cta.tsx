export function FinalCTA() {
  return (
    <section data-motion="final-cta" className="border-t border-[var(--color-line)] py-24 md:py-32">
      <div className="mx-auto w-[min(1120px,calc(100vw-48px))] sm:w-[min(1120px,calc(100vw-48px))] xl:w-[min(1120px,calc(100vw-80px))]">
        <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] font-bold tracking-[-0.04em] leading-[1.05] text-[var(--color-ink)] max-w-[620px]">
          Set up your front desk before your next lead source goes live.
        </h2>
        <p className="mt-5 text-[1.0625rem] text-[var(--color-muted)] max-w-[440px] leading-relaxed">
          Share your workflow, connect your channels, and go live in days. No engineering required.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href="#book"
            className="inline-flex items-center px-6 h-11 rounded-full text-[14px] font-semibold bg-[var(--color-ink)] text-[var(--color-bg)] hover:opacity-85 transition-opacity active:scale-[0.97]"
          >
            Request a Demo
          </a>
          <a
            href="mailto:hello@lumenosis.com"
            className="inline-flex items-center px-6 h-11 rounded-full text-[14px] font-medium border border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-line)] transition-colors"
          >
            Talk to the team
          </a>
        </div>
      </div>
    </section>
  );
}
