import { AuroraBackground } from "@/components/aurora-background";
import { ScrollExperience } from "@/components/motion/scroll-experience";
import { AriaDeepDive } from "@/components/sections/aria-deep-dive";
import { CalendarCTA } from "@/components/sections/calendar-cta";
import { Faq } from "@/components/sections/faq";
import { FinalCTA } from "@/components/sections/final-cta";
import { Footer } from "@/components/sections/footer";
import { Hero } from "@/components/sections/hero";
import { IrisLeadDesk } from "@/components/sections/iris-lead-desk";
import { PullQuote } from "@/components/sections/pull-quote";
import { StickyCtaBar } from "@/components/sections/sticky-cta-bar";
import { Topbar } from "@/components/sections/topbar";
import { TrustStrip } from "@/components/sections/trust-strip";
import { TwoWaysIn } from "@/components/sections/two-ways-in";

export const metadata = {
  title: "Scroll experience preview",
  robots: { index: false, follow: false },
};

// Full homepage with the scroll choreography layer mounted. Production
// (app/page.tsx) does not import ScrollExperience — this route is the
// approval gate before the motion system goes live.
export default function ScrollPreviewPage() {
  return (
    <>
      <ScrollExperience />
      <AuroraBackground />
      <Topbar />
      <main>
        <Hero />
        <TrustStrip />
        <IrisLeadDesk />
        <AriaDeepDive />
        <TwoWaysIn />
        <CalendarCTA />
        <Faq />
        <FinalCTA />
        <PullQuote />
      </main>
      <Footer />
      <StickyCtaBar />
    </>
  );
}
