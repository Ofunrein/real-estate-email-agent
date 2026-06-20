"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { adaptInboxData } from "@/lib/inboxDataAdapter";
import type { AgentInboxData } from "@/lib/inboxData";
import { InboxPage } from "./InboxPage";
import { ColorModeProvider } from "./theme/ColorModeContext";
import { CategoryColorProvider } from "./theme/CategoryColorContext";
import { InboxDataProvider } from "./InboxDataContext";

const DASHBOARD_REFRESH_MS = 5000;

interface InboxAppProps {
  data: AgentInboxData;
  teamName?: string;
  userEmail?: string;
  loadError?: string;
}

export function InboxApp({ data }: InboxAppProps) {
  const [inboxData, setInboxData] = useState<AgentInboxData>(data);

  // 5s poll /api/data for fresh AgentInboxData.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/data?ts=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as AgentInboxData;
        if (!cancelled && next) setInboxData(next);
      } catch {
        // network blip — keep last data
      }
    };
    refresh();
    const id = setInterval(refresh, DASHBOARD_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const model = useMemo(() => adaptInboxData(inboxData), [inboxData]);

  // Optimistic draft resolution after a review action so the 5s poll doesn't
  // fight the UI: remove the draft from local state immediately.
  const handleDraftChanged = useCallback((key: string) => {
    setInboxData((current) => {
      if (!current.drafts || !current.drafts[key]) return current;
      const drafts = { ...current.drafts };
      delete drafts[key];
      return { ...current, drafts };
    });
  }, []);

  return (
    <ColorModeProvider>
      <InboxDataProvider model={model} onDraftChanged={handleDraftChanged}>
        <CategoryColorProvider categories={model.leadCategories}>
          <InboxPage />
        </CategoryColorProvider>
      </InboxDataProvider>
    </ColorModeProvider>
  );
}
