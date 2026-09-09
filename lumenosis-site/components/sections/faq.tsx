"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/reveal";
import { faq } from "@/content/faq";

export function Faq() {
  return (
    <section
      id="faq"
      className="border-t border-[var(--color-line)] py-16 md:py-24"
    >
      <div className="mx-auto grid w-[min(1120px,calc(100vw-48px))] sm:w-[min(1120px,calc(100vw-48px))] xl:w-[min(1120px,calc(100vw-80px))] gap-10 md:grid-cols-[0.55fr_1fr]">
        <Reveal variant="left">
          <div>
            <h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.04em] leading-[1.05] text-[var(--color-ink)]">
              Questions we get every week.
            </h2>
          </div>
        </Reveal>

        <Reveal variant="right" delay={0.08}>
          <Accordion type="single" collapsible className="w-full">
            {faq.map((item, i) => (
              <AccordionItem
                key={item.q}
                value={`q-${i}`}
                className="border-b border-[var(--color-line)] last:border-b-0"
              >
                <AccordionTrigger className="text-left text-[1rem] font-semibold text-[var(--color-ink)] hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-amber)] focus-visible:ring-offset-2">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-[var(--color-muted)] dark:text-white">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
