"use client";

import AutoScroll from "embla-carousel-auto-scroll";
import { Reveal } from "@/components/reveal";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";

const reLogos = [
  {
    id: "compass",
    label: "Compass",
    src: "/images/trust/compass-logo.svg",
  },
  {
    id: "keller-williams",
    label: "Keller Williams",
    src: "/images/trust/keller-williams-logo.svg",
  },
  {
    id: "exp-realty",
    label: "eXp Realty",
    src: "/images/trust/exp-realty-logo.png",
  },
  {
    id: "remax",
    label: "RE/MAX",
    src: "/images/trust/remax-logo.svg",
  },
];

const repeatedLogos = [
  ...reLogos.map((logo) => ({ ...logo, instanceId: `${logo.id}-a` })),
  ...reLogos.map((logo) => ({ ...logo, instanceId: `${logo.id}-b` })),
  ...reLogos.map((logo) => ({ ...logo, instanceId: `${logo.id}-c` })),
];

export function TrustStrip() {
  return (
    <section
      aria-label="Built for operators already investing in conversations"
      className="border-t border-b border-[var(--color-line)] py-5"
    >
      <Reveal variant="scale" data-motion="trust">
        <div
          className="relative w-full"
          style={{
            maskImage:
              "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
          }}
        >
          <Carousel
            opts={{ loop: true }}
            plugins={[AutoScroll({ playOnInit: true, speed: 1, stopOnInteraction: false })]}
          >
            <CarouselContent className="ml-0 items-center">
              {repeatedLogos.map((logo) => (
                <CarouselItem
                  key={logo.instanceId}
                  className="flex basis-1/2 justify-center pl-0 sm:basis-1/3 md:basis-1/4"
                >
                  <div className="mx-8 flex h-12 w-40 shrink-0 items-center justify-center opacity-65 transition-opacity hover:opacity-95 dark:opacity-95 dark:hover:opacity-100">
                    <span
                      aria-label={logo.label}
                      role="img"
                      className="block h-7 w-32 bg-[var(--color-ink)] opacity-40"
                      style={{
                        WebkitMask: `url(${logo.src}) center / contain no-repeat`,
                        mask: `url(${logo.src}) center / contain no-repeat`,
                      }}
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </div>
      </Reveal>
    </section>
  );
}
