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
  textThreads: { instagram: [], messenger: [], whatsapp: [], website: [] },
  voiceContacts: [],
  properties: [],
  propertyHealth: { score: 0, total: 0, clean: '0% clean', missingCore: 0, duplicateGroups: 0, rows: 0 },
  metrics: {
    needReview: 0,
    leadsTotal: 0,
    events: 0,
    threads: 0,
    inbound: 0,
    aiReplies: 0,
    flaggedThreads: 0,
    propertyHealth: 0,
    activityDays: 14,
    peakDay: '',
    peakCount: 0,
    avgResponseSeconds: 0,
    avgResponseLabel: 'No replies',
    avgResponseSamples: 0,
    qualifiedLeads: 0,
    appointments: 0,
    liveTransfers: 0,
    mediaItems: 0,
    mediaTranscripts: 0,
  },
  pipelineStages: [],
  channelQuality: [],
  sparkline: [],
  statTrends: { needReview: [], leadsTotal: [], events: [], aiRate: [], avgResponse: [] },
  drafts: {},
  inboxSettings: DEFAULT_INBOX_SETTINGS,
};

interface InboxDataContextValue {
  model: InboxModel;
  onDraftChanged?: (key: string, status?: string) => void;
  onDataRefresh?: () => Promise<void>;
}

const InboxDataContext = createContext<InboxDataContextValue>({ model: emptyModel });

export function InboxDataProvider({
  model,
  onDraftChanged,
  onDataRefresh,
  children,
}: {
  model: InboxModel;
  onDraftChanged?: (key: string, status?: string) => void;
  onDataRefresh?: () => Promise<void>;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => ({ model, onDraftChanged, onDataRefresh }), [model, onDraftChanged, onDataRefresh]);
  return <InboxDataContext.Provider value={value}>{children}</InboxDataContext.Provider>;
}

export function useInboxData(): InboxDataContextValue {
  return useContext(InboxDataContext);
}

export function useInboxModel(): InboxModel {
  return useContext(InboxDataContext).model;
}
