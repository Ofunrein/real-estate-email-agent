"use client";

import { FilloutStandardEmbed } from "@fillout/react";

export function FilloutEmbed({ formId }: { formId: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-bg-cream)] shadow-[var(--shadow-soft)]">
      <FilloutStandardEmbed filloutId={formId} dynamicResize inheritParameters />
    </div>
  );
}
