export function PullQuote() {
  return (
    <section
      data-motion="pull-quote"
      className="border-t border-b border-[var(--color-line)] py-16 md:py-20 bg-[#edeadf] dark:bg-[rgba(255,255,255,0.02)]"
    >
      <div className="mx-auto w-[min(700px,calc(100vw-64px))] text-center">
        <blockquote>
          <p
            className="text-[1.1875rem] leading-[1.65] text-[var(--color-ink)]"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
          >
            "I used to chase conversations. Now the right handoffs are already waiting."
          </p>
          <footer className="mt-6">
            <cite className="not-italic text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
              Real Estate Professional, Austin TX
            </cite>
          </footer>
        </blockquote>
      </div>
    </section>
  );
}
