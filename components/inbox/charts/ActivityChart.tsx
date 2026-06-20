"use client";

import { MiniChart } from "./MiniChart";
import type { SheetRow } from "@/lib/sheetSchema";

// Activity chart is the MUI MiniChart (1:1 port). Kept as a thin wrapper so
// the existing call site `<ActivityChart events={...} />` is unchanged.
export function ActivityChart({ events }: { events: SheetRow[] }) {
  return <MiniChart events={events} />;
}
