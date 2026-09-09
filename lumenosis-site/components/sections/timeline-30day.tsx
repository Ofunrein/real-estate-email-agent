import { Reveal } from "@/components/reveal";
import { timeline } from "@/content/timeline";

export function Timeline30Day() {
  return (
    <section
      id="process"
      className="border-b border-[var(--color-line)] bg-[#f5f2e9] py-20 dark:bg-[rgb(16_12_23_/_0.72)] md:py-28"
    >
      <div className="mx-auto w-[min(1500px,calc(100vw_-_48px))] sm:w-[min(1500px,calc(100vw_-_40px))]">
        <Reveal variant="left">
          <p className="mb-7 flex items-center gap-3 text-[var(--text-eyebrow)] font-medium uppercase tracking-[0.24em] text-[var(--color-brand-purple)]">
            <span className="h-px w-8 bg-[var(--color-gold-italic)]" aria-hidden />
            05 - Process
          </p>
        </Reveal>

        <Reveal variant="up" delay={0.05}>
          <h2 className="max-w-[760px] font-[family-name:var(--font-display)] text-[clamp(3.1rem,5.1vw,5.6rem)] font-medium leading-[0.98] tracking-normal text-[var(--color-ink-charcoal)]">
            <span className="headline-plain">Two weeks to a</span>{" "}
            <em className="font-normal text-[var(--color-gold-italic)]">live front desk.</em>
          </h2>
        </Reveal>

        <ol className="relative mt-20 grid gap-12 md:mt-28 md:grid-cols-4 md:gap-10">
          <li
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-[10px] hidden h-px bg-[var(--color-line)] md:block"
          />

          {timeline.map((w, i) => (
            <li key={w.week} className="relative md:pt-28">
              <div className="mb-8 flex items-center gap-3 md:absolute md:left-0 md:top-0 md:w-full md:flex-col md:items-start md:gap-10">
                <span
                  aria-hidden
                  className={`relative z-10 shrink-0 rounded-full ${
                    i === 2
                      ? "size-5 border-[7px] border-[var(--color-gold-italic)]/25 bg-[var(--color-gold-italic)]"
                      : i === 0
                        ? "size-4 bg-[var(--color-brand-purple)]"
                        : "size-4 border-2 border-[var(--color-brand-purple)] bg-[var(--color-bg-cream)] dark:bg-[rgb(16_12_23_/_0.72)]"
                  }`}
                />
                <span className="text-[var(--text-eyebrow)] font-medium uppercase tracking-[0.24em] text-[var(--color-brand-purple)]">
                  {w.week} · {w.kicker}
                </span>
              </div>

              <Reveal variant={i % 2 === 0 ? "up" : "scale"} delay={i * 0.07}>
                <div>
                  <h3 className="headline-plain text-[clamp(1.55rem,2vw,2rem)] leading-tight text-[var(--color-ink-charcoal)]">
                    {w.title}
                  </h3>
                  <p className="mt-5 max-w-[330px] text-[1.05rem] leading-8 text-[var(--color-muted)]">
                    {w.body}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
