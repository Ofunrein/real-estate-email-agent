import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans, Playfair_Display } from "next/font/google";
import { AnalyticsProvider } from "@/components/posthog-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});
const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-dm-mono",
  display: "swap",
  weight: ["300", "400", "500"],
});
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
  style: ["normal", "italic"],
  weight: ["400", "500"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  applicationName: "Lumenosis AI",
  title: {
    default: "Lumenosis AI Agents for Real Estate Teams",
    template: "%s — Lumenosis AI",
  },
  description:
    "Lumenosis AI builds real estate AI agents that answer calls, texts, email, and website leads, qualify buyers and sellers, and route property conversations before they go cold.",
  metadataBase: new URL("https://lumenosis.com"),
  alternates: {
    canonical: "/",
  },
  keywords: [
    "Lumenosis AI",
    "lumenosis",
    "AI agents for real estate",
    "real estate AI agents",
    "AI real estate assistant",
    "front desk",
    "real estate lead response software",
    "real estate SMS AI",
    "real estate voice AI",
    "property management AI assistant",
    "Iris AI real estate agent",
  ],
  authors: [{ name: "Lumenosis AI", url: "https://lumenosis.com" }],
  creator: "Lumenosis AI",
  publisher: "Lumenosis AI",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "Lumenosis AI Agents for Real Estate Teams",
    description:
      "Real estate AI agents for calls, SMS, email, website chat, and social DMs. Iris answers, qualifies, and routes property conversations before they go cold.",
    url: "https://lumenosis.com",
    siteName: "Lumenosis AI",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/images/lumenosis-logo-warm-rounded.png",
        width: 1200,
        height: 630,
        alt: "Lumenosis AI real estate AI agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lumenosis AI Agents for Real Estate Teams",
    description: "AI agents for real estate calls, texts, email, website leads, and social DMs.",
    images: ["/images/lumenosis-logo-warm-rounded.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} ${playfair.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <AnalyticsProvider>
          <ThemeProvider>
            <a
              href="#top"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--color-brand-purple)] focus:px-3 focus:py-2 focus:text-white"
            >
              Skip to content
            </a>
            {children}
          </ThemeProvider>
        </AnalyticsProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
