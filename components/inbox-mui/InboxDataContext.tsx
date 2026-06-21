"use client";

import React, { createContext, useContext } from 'react';
import { leadCategories, type InboxModel } from './data/inboxData';
import { DEFAULT_INBOX_SETTINGS } from '@/lib/inboxSettings';

// Empty fallback model so components never read undefined before first render.
const emptyModel: InboxModel = {
  channels: [],
  channelMeta: {} as InboxModel['channelMeta'],
  channelAccounts: {} as InboxModel['channelAccounts'],
  leadCategories,
  activityEvents: [],
  reviewQueue: [],
  channelStats: {} as InboxModel['channelStats'],
  emailThreads: [],
  smsThreads: [],
  voiceContacts: [],
  properties: [],
  propertyHealth: { score: 0, total: 0, clean: '0% clean', missingCore: 0, duplicateGroups: 0, rows: 0 },
  metrics: { needReview: 0, leadsTotal: 0, events: 0, threads: 0, inbound: 0, aiReplies: 0, flaggedThreads: 0, propertyHealth: 0, activityDays: 14, peakDay: '', peakCount: 0, avgResponseSeconds: 0, avgResponseLabel: 'No replies', avgResponseSamples: 0 },
  sparkline: [],
  statTrends: { needReview: [], leadsTotal: [], events: [], aiRate: [], avgResponse: [] },
  drafts: {},
  inboxSettings: DEFAULT_INBOX_SETTINGS,
};

interface InboxDataContextValue {
  model: InboxModel;
  onDraftChanged?: (key: string, status?: string) => void;
}

const InboxDataContext = createContext<InboxDataContextValue>({ model: emptyModel });

export function InboxDataProvider({
  model,
  onDraftChanged,
  children,
}: {
  model: InboxModel;
  onDraftChanged?: (key: string, status?: string) => void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => ({ model, onDraftChanged }), [model, onDraftChanged]);
  return <InboxDataContext.Provider value={value}>{children}</InboxDataContext.Provider>;
}

export function useInboxData(): InboxDataContextValue {
  return useContext(InboxDataContext);
}

export function useInboxModel(): InboxModel {
  return useContext(InboxDataContext).model;
}
