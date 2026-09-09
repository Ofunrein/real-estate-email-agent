export type PricingPath = {
  slug: "starter" | "team" | "growth" | "brokerage";
  label: string;
  price: string;
  subtext: string;
  pitch: string;
  bullets: string[];
  popular?: boolean;
  cta: string;
};

export const pricingPaths: PricingPath[] = [
  {
    slug: "starter",
    label: "Starter",
    // Saved for later: price: "$1,500", subtext: "setup + $1,000/mo".
    price: "TBD",
    subtext: "quoted after demo",
    pitch:
      "For an inquiry-spending solo operator or tiny team that needs one managed workflow live first.",
    bullets: [
      "One to two priority channels",
      "Basic CRM or sheet sync",
      "Conversation response scripts and routing rules",
      "Monthly monitoring",
    ],
    cta: "Book consult",
  },
  {
    slug: "team",
    label: "Team",
    // Saved for later: price: "$3,000+", subtext: "setup + $2,500/mo".
    price: "TBD",
    subtext: "quoted after demo",
    pitch: "For 3 to 15 operator teams buying portal, paid ad, social, or website inquiries.",
    bullets: [
      "Email, SMS, calls, website chat, and social DM handling",
      "Shared conversation brain and property data brain",
      "Human review controls",
      "Calendar and CRM routing",
      "Weekly launch optimization",
    ],
    popular: true,
    cta: "Book consult",
  },
  {
    slug: "growth",
    label: "Growth Team",
    // Saved for later: price: "$10,000+", subtext: "setup + custom monthly".
    price: "TBD",
    subtext: "quoted after demo",
    pitch:
      "For teams with multiple operators, markets, inquiry sources, calendars, or routing rules.",
    bullets: [
      "Everything in Team",
      "Per-operator and per-market routing",
      "Conversation scoring and owner visibility",
      "Advanced property enrichment",
      "Ongoing reporting and management",
    ],
    cta: "Book consult",
  },
  {
    slug: "brokerage",
    label: "Brokerage / White-label",
    price: "Custom",
    subtext: "",
    pitch:
      "For offices, brokerages, and agencies that need a managed front desk across many users or clients.",
    bullets: [
      "Multi-office deployment",
      "Agency client management",
      "Custom compliance workflow",
      "Dedicated build and support cadence",
      "SLA and expansion plan",
    ],
    cta: "Book consult",
  },
];
