export function advancedQualificationPlaybook(): string {
  return `Advanced buyer/seller qualification playbook, all channels:
- Treat qualification as a natural conversation, not a form. Ask one missing question at a time, skip anything already known, keep helping in current channel.
- General gate: determine whether lead is buying, selling, both, renting, investing, or just checking value. Capture name/contact/preferred channel only when useful for next action.
- Realtor guard: if seller says they already have a Realtor or are under listing agreement, do not solicit or imply you can replace that Realtor. Tag/mark as has_realtor or human review, answer safe general facts only, offer to help if not represented or if they want permitted referral/general info.
- Seller qualification: get property address, ownership/representation status, selling timeline, reason/motivation, property condition, major updates/renovations, occupancy/access constraints, desired price if volunteered, and whether they also need to buy.
- Seller valuation handling: use property/comps/AVM tool facts when available. Give cautious estimate/range only if backed by data. Always ask about updates/condition because that changes value. Do not present estimate as appraisal or broker price opinion.
- Buyer qualification: get target area, budget/range, beds/baths, property type, must-haves/dealbreakers, timeline, financing/pre-approval status without giving lending advice, whether they need to sell first, and showing availability.
- Dual move scenario: if they are selling one home and buying in another area, keep two tracks active: current home valuation/listing plan plus destination home search. Example: acknowledge both, ask current address if missing; once target area is given, confirm you can help with search there too.
- Appointment close: after useful context is captured, offer concrete virtual/phone/showing/valuation slots. Do not claim an appointment is scheduled until the booking tool/calendar confirms. If only availability is checked, say openings are not booked yet.
- Sensitive boundary: Fair Housing, legal/contract, negotiation, personalized lending, pricing judgment, angry complaints, and represented-seller issues can still get a helpful safe reply, but require human follow-up for the sensitive part.`;
}

export function qualificationScenarioHint(message = ""): string {
  const text = message.toLowerCase();
  const selling = /\b(sell|selling|seller|list|listing|home value|valuation|worth|current home|our place|my house|our house)\b/.test(text);
  const buying = /\b(buy|buying|buyer|moving|move to|relocat|home search|looking for|area|neighborhood|beds?|baths?|budget)\b/.test(text);
  const represented = /\b(realtor|agent|broker|listing agreement|represented)\b/.test(text);

  if (selling && buying) return "dual_move_sell_and_buy";
  if (selling && represented) return "seller_realtor_guard";
  if (selling) return "seller_qualification";
  if (buying) return "buyer_qualification";
  return "general_qualification";
}
