import { AuroraBackground } from "@/components/aurora-background";
import { IrisLeadDesk } from "@/components/sections/iris-lead-desk";
import { IrisLeadDeskSpotlight } from "@/components/sections/iris-lead-desk-spotlight";

export const metadata = {
  title: "Iris section preview",
  robots: { index: false, follow: false },
};

function VariantLabel({ children }: { children: string }) {
  return (
    <div className="mx-auto w-[min(1120px,calc(100vw-48px))] pt-16">
      <p className="inline-block rounded-full border border-[var(--color-line)] px-4 py-1.5 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">
        {children}
      </p>
    </div>
  );
}

export default function IrisPreviewPage() {
  return (
    <>
      <AuroraBackground />
      <main>
        <VariantLabel>Variant A — editorial (live on homepage)</VariantLabel>
        <IrisLeadDesk />
        <div className="border-t border-[var(--color-line)]" />
        <VariantLabel>Variant B — spotlight showcase</VariantLabel>
        <IrisLeadDeskSpotlight />
      </main>
    </>
  );
}
