import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { StarButton } from "@/components/ui/star-button";
import { cn } from "@/lib/utils";

export interface PricingTier {
  name: string;
  icon: ReactNode;
  price: string;
  period?: string;
  description: string;
  features: string[];
  popular?: boolean;
  color: string;
  onSelect?: () => void;
}

export function CreativePricing({
  tag = "Simple Pricing",
  title = "Two ways in.",
  description = "Both paths lead to the same outcome: clean handoffs on your calendar.",
  tiers,
}: {
  tag?: string;
  title?: string;
  description?: string;
  tiers: PricingTier[];
}) {
  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      <div className="text-center space-y-4 mb-12">
        <div className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-violet)]">
          {tag}
        </div>
        <h2 className="text-4xl md:text-5xl font-[family-name:var(--font-display)] font-semibold text-[var(--color-ink-charcoal)] italic">
          {title}
        </h2>
        <p className="text-[var(--color-muted)] text-lg">{description}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {tiers.map((tier, index) => {
          const rotations = [
            "rotate-[-1deg]",
            "rotate-[1deg]",
            "rotate-[-0.5deg]",
            "rotate-[0.5deg]",
          ];
          return (
            <div
              key={tier.name}
              className={cn("relative group transition-all duration-300", rotations[index % 4])}
            >
              <div
                className={cn(
                  "absolute inset-0 bg-[var(--color-bg-cream)] border-2 border-[var(--color-ink-charcoal)]/20 rounded-xl shadow-[4px_4px_0px_0px] shadow-[var(--color-brand-violet)]/20 transition-all duration-300",
                  "group-hover:shadow-[8px_8px_0px_0px] group-hover:shadow-[var(--color-brand-violet)]/30 group-hover:translate-x-[-4px] group-hover:translate-y-[-4px]",
                )}
              />
              <div className="relative p-6">
                {tier.popular && (
                  <div className="absolute -top-3 -right-2 bg-[var(--color-brand-violet)] text-white px-3 py-1 rounded-full text-xs font-bold rotate-12 border-2 border-[var(--color-brand-violet)]">
                    Popular!
                  </div>
                )}
                <div className="mb-5">
                  <div
                    className={cn(
                      "w-11 h-11 rounded-full mb-4 flex items-center justify-center border-2 border-[var(--color-line)] text-[var(--color-brand-violet)]",
                    )}
                  >
                    {tier.icon}
                  </div>
                  <h3 className="font-[family-name:var(--font-display)] text-xl text-[var(--color-ink-charcoal)]">
                    {tier.name}
                  </h3>
                  <p className="text-sm text-[var(--color-muted)] mt-1">{tier.description}</p>
                </div>
                <div className="mb-5">
                  <span className="text-3xl font-bold text-[var(--color-ink-charcoal)]">
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className="text-[var(--color-muted)] text-sm">{tier.period}</span>
                  )}
                </div>
                <ul className="space-y-2 mb-6">
                  {tier.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-sm text-[var(--color-ink-charcoal)]"
                    >
                      <span className="mt-0.5 size-4 rounded-full border border-[var(--color-line)] flex items-center justify-center shrink-0">
                        <Check className="size-2.5 text-[var(--color-brand-violet)]" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <StarButton
                  lightColor="#cb6ce6"
                  className={cn(
                    "w-full justify-center h-11 text-sm transition-all duration-300 shadow-[4px_4px_0px_0px] hover:shadow-[6px_6px_0px_0px] hover:translate-x-[-2px] hover:translate-y-[-2px]",
                    tier.popular
                      ? "bg-[var(--color-brand-violet)] text-white shadow-[var(--color-brand-violet)]/40"
                      : "bg-[var(--color-bg-cream)] border border-[var(--color-line)] text-[var(--color-ink-charcoal)] shadow-[var(--color-line)]",
                  )}
                  onClick={tier.onSelect}
                >
                  Get Started
                </StarButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
