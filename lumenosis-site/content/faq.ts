export type FaqItem = { q: string; a: string };

export const faq: FaqItem[] = [
  {
    q: "What does this actually cost?",
    // Saved for later: "$3,000 setup + $2,500/mo", "$1,500 setup + $1,000/mo".
    a: "Pricing is scoped after the demo. We map your channels, CRM, calendar, property data, review rules, and management needs before quoting the build.",
  },
  {
    q: "How long until it is running?",
    a: "Most first-channel installs can go live in about two weeks. Day one maps inquiry sources and rules. The first week builds the shared memory and priority integrations. Week two launches, tunes review, and tightens routing.",
  },
  {
    q: "Which operators are the best fit?",
    a: "Operators already spending money to create conversations. That includes real estate teams, property managers, short-term rental operators, brokerages, portal inquiry buyers, Meta or Google advertisers, and teams that need response coverage without hiring another full-time ISA.",
  },
  {
    q: "Which channels can Iris cover?",
    a: "Email, SMS, voice calls, website chat, Instagram DM, Facebook Messenger, and WhatsApp. The point is not just more channels. The point is one shared memory and one routing logic across all of them.",
  },
  {
    q: "Which CRMs and calendars do you integrate with?",
    a: "Follow Up Boss, Lofty, kvCORE, GoHighLevel, HubSpot, Google Sheets, Calendly, Google Calendar, and CRM calendars. If your system has an API, webhook, export, or clean enough workaround, we can usually connect it.",
  },
  {
    q: "Where does property data come from?",
    a: "The first version can use Google Sheets, a database, CRM listings, IDX or MLS exports, or Zillow and Apify enrichment. Iris uses available facts like price, beds, baths, square footage, links, photos, showing windows, and seller notes when they are present.",
  },
  {
    q: "How do consent and opt-outs work?",
    a: "Iris is built with consent records, opt-out handling, STOP handling, and human takeover rules. We are not legal counsel, so your compliance officer or attorney signs off before launch.",
  },
  {
    q: "What happens if the AI gets a question wrong?",
    a: "Sensitive, legal, financing, Fair Housing, low-confidence, or policy-bound replies can go to approval mode instead of auto-send. Human takeover is available anytime, and the full timeline stays visible.",
  },
  {
    q: "Can I cancel?",
    a: "Setup is a one-time implementation fee. Monthly management is month-to-month unless a custom agreement says otherwise. Notice terms are set in the agreement.",
  },
  {
    q: "Do my operators need to be trained?",
    a: "Your operators do not need to learn a complicated new tool. We train the owner or operator on routing rules, review mode, and takeover flow. Humans still handle judgment, negotiations, and relationship work.",
  },
  {
    q: "Will my brokerage approve this?",
    a: "We prepare the compliance and operating summary: recording, retention, consent, Fair Housing boundaries, review mode, and escalation rules. Brokerage approval depends on your office policies.",
  },
  {
    q: "Is this an AI ISA?",
    a: "No. AI ISA is too narrow. Iris is a shared response system for inbound conversations across channels. It answers, qualifies, follows up, remembers, and routes. Your licensed team still owns the relationship and decisions.",
  },
  {
    q: "What will Iris not do?",
    a: "It will not give legal advice, financing advice, Fair Housing-sensitive guidance, negotiate on your behalf, or pretend to be a licensed agent. Those moments are routed to a human.",
  },
  {
    q: "What if I am not a fit?",
    a: "Then the strategy call ends with us telling you exactly what to do instead. No upsell, no pressure. We turn down more clients than we take.",
  },
];
