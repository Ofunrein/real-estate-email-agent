import EmailIcon from '@mui/icons-material/MailOutline';
import SmsIcon from '@mui/icons-material/SmsOutlined';
import VoiceIcon from '@mui/icons-material/PhoneOutlined';
import InstagramIcon from '@mui/icons-material/Instagram';
import MessengerIcon from '@mui/icons-material/ChatBubbleOutline';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import WebsiteIcon from '@mui/icons-material/LanguageOutlined';
import type { SvgIconComponent } from '@mui/icons-material';

// This module holds the TYPES + static config (icons, labels, defaults) for
// the inbox UI. All live data is produced by lib/inboxDataAdapter.ts from
// AgentInboxData and delivered via InboxDataContext — nothing hardcoded here.

export type ChannelId =
  | 'all'
  | 'email'
  | 'sms'
  | 'voice'
  | 'instagram'
  | 'messenger'
  | 'whatsapp'
  | 'website'
  | 'properties';

export interface Channel {
  id: ChannelId;
  label: string;
  icon: SvgIconComponent;
  count?: number;
  accent: string;
}

export interface ConnectedAccount {
  label: string;
  value: string;
  status: string;
}

export type LeadCategoryId =
  | 'needs-reply'
  | 'hot-lead'
  | 'showing'
  | 'seller'
  | 'financing'
  | 'needs-human'
  | 'nurture'
  | 'closed';

export interface LeadCategory {
  id: LeadCategoryId;
  label: string;
  color: string;
}

export type EventKind = 'inbound' | 'ai_reply' | 'note' | 'voice';

export interface ActivityEvent {
  id: string;
  channel: Exclude<ChannelId, 'all' | 'properties'>;
  kind: EventKind;
  actor: string;
  intent?: string;
  body: string;
  time: string;
  isHuman?: boolean;
}

export interface ReviewItem {
  id: string;
  key: string;
  channel: Exclude<ChannelId, 'all' | 'properties'>;
  contact: string;
  reason: string;
  receivedAt: string;
  intent: string;
  inbound: string;
  draft: string;
  confidence: number;
  threadRef: string;
}

export interface ChannelStats {
  events: number;
  threads: number;
  inbound: number;
  aiReplies: number;
  lastActivity: {
    contact: string;
    message: string;
    status: string;
    when: string;
  } | null;
  humanReview: 'flagged' | 'clear';
}

export interface PropertyCard {
  address: string;
  price: string;
  beds?: string;
  baths?: string;
  sqft?: string;
  broker?: string;
  photo?: string;
  blurb?: string;
}

export interface EmailMessage {
  id: string;
  sender: string;
  direction: 'inbound' | 'iris' | 'owner';
  time: string;
  subject?: string;
  body?: string;
  html?: string;
  cards?: PropertyCard[];
  showSchedule?: boolean;
  flag?: string;
}

export interface EmailThread {
  id: string;
  contact: string;
  name: string;
  time: string;
  preview: string;
  messageCount: number;
  needsReview?: boolean;
  reviewReason?: string;
  category: LeadCategoryId;
  messages: EmailMessage[];
}

export interface SmsMessage {
  id: string;
  direction: 'inbound' | 'iris';
  time: string;
  body: string;
}

export interface SmsThread {
  id: string;
  contact: string;
  time: string;
  preview: string;
  messageCount: number;
  category: LeadCategoryId;
  messages: SmsMessage[];
}

export type CallOutcome =
  | 'voicemail'
  | 'silence-timed-out'
  | 'assistant-forwarded-call'
  | 'assistant-ended-call';

export interface CallTurn {
  speaker: 'Iris' | 'Lead';
  text: string;
}

export interface Call {
  id: string;
  time: string;
  duration: string;
  outcome: CallOutcome;
  turns: CallTurn[];
  report: string;
  recordingUrl?: string;
}

export interface VoiceContact {
  id: string;
  contact: string;
  phone?: string;
  time: string;
  summary: string;
  callCount: number;
  tag: string;
  calls: Call[];
}

export interface Property {
  id: string;
  address: string;
  city: string;
  price: string;
  priceNum: string;
  beds: string;
  baths: string;
  sqft: string;
  year: string;
  type: string;
  status?: string;
  neighborhood: string;
  zip: string;
  photo?: string;
  broker: string;
}

export interface PropertyHealth {
  score: number;
  total: number;
  clean: string;
  missingCore: number;
  duplicateGroups: number;
  rows: number;
}

export interface TrendPoint {
  value: number;
}

export interface Metrics {
  needReview: number;
  leadsTotal: number;
  events: number;
  threads: number;
  inbound: number;
  aiReplies: number;
  flaggedThreads: number;
  propertyHealth: number;
  activityDays: number;
  peakDay: string;
  peakCount: number;
}

export interface InboxModel {
  channels: Channel[];
  channelMeta: Record<Exclude<ChannelId, 'all' | 'properties'>, { label: string; icon: SvgIconComponent; accent: string }>;
  channelAccounts: Record<ChannelId, ConnectedAccount>;
  leadCategories: LeadCategory[];
  activityEvents: ActivityEvent[];
  reviewQueue: ReviewItem[];
  channelStats: Record<Exclude<ChannelId, 'properties'>, ChannelStats>;
  emailThreads: EmailThread[];
  smsThreads: SmsThread[];
  voiceContacts: VoiceContact[];
  properties: Property[];
  propertyHealth: PropertyHealth;
  metrics: Metrics;
  sparkline: number[];
  statTrends: {
    needReview: TrendPoint[];
    leadsTotal: TrendPoint[];
    events: TrendPoint[];
    aiRate: TrendPoint[];
  };
  drafts: Record<string, unknown>;
}

/* ----------------------------- Static config ------------------------------- */

export const channelMeta: Record<
  Exclude<ChannelId, 'all' | 'properties'>,
  { label: string; icon: SvgIconComponent; accent: string }
> = {
  email: { label: 'Email', icon: EmailIcon, accent: '#818cf8' },
  sms: { label: 'SMS', icon: SmsIcon, accent: '#22d3ee' },
  voice: { label: 'Voice', icon: VoiceIcon, accent: '#34d399' },
  instagram: { label: 'Instagram', icon: InstagramIcon, accent: '#f472b6' },
  messenger: { label: 'Messenger', icon: MessengerIcon, accent: '#38bdf8' },
  whatsapp: { label: 'WhatsApp', icon: WhatsAppIcon, accent: '#34d399' },
  website: { label: 'Website', icon: WebsiteIcon, accent: '#fbbf24' },
};

export const channelAccounts: Record<ChannelId, ConnectedAccount> = {
  all: { label: 'Workspace', value: 'Austin Realty', status: 'READY' },
  email: { label: 'Email', value: 'martin@lumenosis.com', status: 'READY' },
  sms: { label: 'SMS number', value: '+1 (512) 846-9460', status: 'READY' },
  voice: { label: 'Voice line', value: '+1 (512) 846-9460', status: 'READY' },
  instagram: { label: 'Instagram', value: '@austin.realty', status: 'READY' },
  messenger: { label: 'Messenger', value: 'Austin Realty Page', status: 'READY' },
  whatsapp: { label: 'WhatsApp', value: '+1 (512) 846-9460', status: 'READY' },
  website: { label: 'Website chat', value: 'austinrealty.com', status: 'READY' },
  properties: { label: 'Property data', value: 'Austin Realty sheet', status: 'SYNCED' },
};

export const leadCategories: LeadCategory[] = [
  { id: 'needs-reply', label: 'Needs Reply', color: '#8b5cf6' },
  { id: 'hot-lead', label: 'Hot Lead', color: '#ef4444' },
  { id: 'showing', label: 'Showing', color: '#f97316' },
  { id: 'seller', label: 'Seller / Valuation', color: '#14b8a6' },
  { id: 'financing', label: 'Financing', color: '#3b82f6' },
  { id: 'needs-human', label: 'Needs Human', color: '#e11d48' },
  { id: 'nurture', label: 'Nurture', color: '#94a3b8' },
  { id: 'closed', label: 'Closed / No Reply', color: '#475569' },
];

// AI agent (Iris/Arya) profile picture used wherever the agent's avatar appears.
export const agentAvatar = '/arya-avatar.png';
