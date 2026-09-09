export type TimelineWeek = {
  week: string;
  kicker: string;
  title: string;
  body: string;
};

export const timeline: TimelineWeek[] = [
  {
    week: "DAY 01",
    kicker: "Foundation",
    title: "Source audit.",
    body: "We trace your paid lead flow, property inquiries, inboxes, phone flow, CRM, calendar, and routing rules.",
  },
  {
    week: "DAY 03",
    kicker: "Build",
    title: "Shared brain build.",
    body: "We connect your channels, property source, tone, review rules, and conversation timeline.",
  },
  {
    week: "DAY 07",
    kicker: "Launch",
    title: "The desk goes live.",
    body: "Email, SMS, calls, website chat, and approved social DMs start answering and routing.",
  },
  {
    week: "DAY 14",
    kicker: "Optimize",
    title: "Tuning + handoff review.",
    body: "We review conversations, tighten human takeover, and report what is converting or leaking.",
  },
];
