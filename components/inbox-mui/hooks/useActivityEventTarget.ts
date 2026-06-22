"use client";

import { useEffect, useState } from "react";

import type { ActivityEvent, ChannelId } from "../data/inboxData";

const STORAGE_KEY = "iris.inbox.activityTarget";

type ActivityTarget = {
  channel: ActivityEvent["channel"];
  threadId: string;
  eventId: string;
  activityId: string;
  openedAt: number;
};

export function activityTargetId(event: ActivityEvent): string {
  return event.eventId || event.id || event.threadRef;
}

export function persistActivityEventTarget(event: ActivityEvent) {
  if (typeof window === "undefined") return;
  const eventId = activityTargetId(event);
  const target: ActivityTarget = {
    channel: event.channel,
    threadId: event.threadId,
    eventId,
    activityId: event.id,
    openedAt: Date.now(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
  window.localStorage.setItem("iris.inbox.last.event", eventId);
}

export function clearActivityEventTarget() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function useActivityEventTarget(
  channel: Exclude<ChannelId, "all" | "properties" | "imports">,
  threadId: string | undefined,
) {
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !threadId) {
      setEventId(null);
      return;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setEventId(null);
      return;
    }
    try {
      const target = JSON.parse(raw) as Partial<ActivityTarget>;
      setEventId(target.channel === channel && target.threadId === threadId && target.eventId ? target.eventId : null);
    } catch {
      setEventId(null);
    }
  }, [channel, threadId]);

  return eventId;
}
