export type Agent = {
  slug: "iris";
  name: string;
  role: string;
  tagline: string;
  bullets: string[];
  avatar: string;
  accent: "gold";
};

export const agents: Agent[] = [
  {
    slug: "iris",
    name: "Iris",
    role: "Your front desk",
    tagline:
      "One agent across email, voice, SMS, website chat, and social DMs — with one shared memory per lead.",
    bullets: [
      "Answers inbound email in your approved voice with real property facts",
      "Picks up after-hours and overflow calls, qualifies, and summarizes",
      "Sends the first text in under 60 seconds and runs long-term nurture",
      "Handles website chat, Instagram, Messenger, and WhatsApp intake",
      "Flags legal, financing, and sensitive replies for human review",
      "Keeps one timeline across every channel, routed into your CRM",
    ],
    avatar: "/images/agents/iris.png",
    accent: "gold",
  },
];
