export const niches = [
  "Real Estate",
  "Brokerage",
  "Property Management",
  "Short-Term Rental",
  "Investor",
] as const;

export type Niche = (typeof niches)[number];
