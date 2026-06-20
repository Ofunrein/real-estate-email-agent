import EmailIcon from '@mui/icons-material/MailOutline';
import SmsIcon from '@mui/icons-material/SmsOutlined';
import VoiceIcon from '@mui/icons-material/GraphicEqOutlined';
import InstagramIcon from '@mui/icons-material/Instagram';
import MessengerIcon from '@mui/icons-material/ChatBubbleOutline';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import WebsiteIcon from '@mui/icons-material/LanguageOutlined';
import type { SvgIconComponent } from '@mui/icons-material';

export type ChannelId =
'all' |
'email' |
'sms' |
'voice' |
'instagram' |
'messenger' |
'whatsapp' |
'website' |
'properties';

export interface Channel {
  id: ChannelId;
  label: string;
  icon: SvgIconComponent;
  count?: number;
  accent: string;
}

export const channels: Channel[] = [
{
  id: 'all',
  label: 'All channels',
  icon: WebsiteIcon,
  count: 119,
  accent: '#818cf8'
},
{
  id: 'email',
  label: 'Email',
  icon: EmailIcon,
  count: 68,
  accent: '#818cf8'
},
{ id: 'sms', label: 'SMS', icon: SmsIcon, count: 51, accent: '#22d3ee' },
{
  id: 'voice',
  label: 'Voice',
  icon: VoiceIcon,
  count: 12,
  accent: '#34d399'
},
{
  id: 'instagram',
  label: 'Instagram',
  icon: InstagramIcon,
  count: 6,
  accent: '#f472b6'
},
{
  id: 'messenger',
  label: 'Messenger',
  icon: MessengerIcon,
  count: 4,
  accent: '#38bdf8'
},
{
  id: 'whatsapp',
  label: 'WhatsApp',
  icon: WhatsAppIcon,
  count: 3,
  accent: '#34d399'
},
{
  id: 'website',
  label: 'Website',
  icon: WebsiteIcon,
  count: 9,
  accent: '#fbbf24'
}];


export const channelMeta: Record<
  Exclude<ChannelId, 'all' | 'properties'>,
  {label: string;icon: SvgIconComponent;accent: string;}> =
{
  email: { label: 'Email', icon: EmailIcon, accent: '#818cf8' },
  sms: { label: 'SMS', icon: SmsIcon, accent: '#22d3ee' },
  voice: { label: 'Voice', icon: VoiceIcon, accent: '#34d399' },
  instagram: { label: 'Instagram', icon: InstagramIcon, accent: '#f472b6' },
  messenger: { label: 'Messenger', icon: MessengerIcon, accent: '#38bdf8' },
  whatsapp: { label: 'WhatsApp', icon: WhatsAppIcon, accent: '#34d399' },
  website: { label: 'Website', icon: WebsiteIcon, accent: '#fbbf24' }
};

/* --------------------------- Connected accounts ----------------------------- */

export interface ConnectedAccount {
  label: string;
  value: string;
  status: string;
}

// The live account / number / handle the AI is currently sending from,
// shown in the channel header top-right.
export const channelAccounts: Record<ChannelId, ConnectedAccount> = {
  all: { label: 'Workspace', value: 'Austin Realty', status: 'READY' },
  email: { label: 'Email', value: 'martin@lumenosis.com', status: 'READY' },
  sms: { label: 'SMS number', value: '+1 (512) 846-9460', status: 'READY' },
  voice: { label: 'Voice line', value: '+1 (512) 846-9460', status: 'READY' },
  instagram: { label: 'Instagram', value: '@austin.realty', status: 'READY' },
  messenger: {
    label: 'Messenger',
    value: 'Austin Realty Page',
    status: 'READY'
  },
  whatsapp: {
    label: 'WhatsApp',
    value: '+1 (512) 846-9460',
    status: 'READY'
  },
  website: {
    label: 'Website chat',
    value: 'austinrealty.com',
    status: 'READY'
  },
  properties: {
    label: 'Property data',
    value: 'Austin Realty sheet',
    status: 'SYNCED'
  }
};

/* ------------------------------ Lead categories ----------------------------- */

export type LeadCategoryId =
'needs-reply' |
'hot-lead' |
'showing' |
'seller' |
'financing' |
'needs-human' |
'nurture' |
'closed';

export interface LeadCategory {
  id: LeadCategoryId;
  label: string;
  color: string;
}

export const leadCategories: LeadCategory[] = [
{ id: 'needs-reply', label: 'Needs Reply', color: '#8b5cf6' },
{ id: 'hot-lead', label: 'Hot Lead', color: '#ef4444' },
{ id: 'showing', label: 'Showing', color: '#f97316' },
{ id: 'seller', label: 'Seller / Valuation', color: '#14b8a6' },
{ id: 'financing', label: 'Financing', color: '#3b82f6' },
{ id: 'needs-human', label: 'Needs Human', color: '#e11d48' },
{ id: 'nurture', label: 'Nurture', color: '#94a3b8' },
{ id: 'closed', label: 'Closed / No Reply', color: '#475569' }];


/* ---------------------------------- Imagery --------------------------------- */

// AI agent (Arya) profile picture used wherever the agent's avatar appears.
export const agentAvatar = "/pasted-image.png";


export const austinSkyline = "/image.png";

export const austinSkyline2 = "/image-1.png";

export const propertyPhotoA = "/image-2.png";

export const propertyPhotoB = "/image-3.png";


const houseA =
'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=400&q=70';
const houseB =
'https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=400&q=70';
const houseC =
'https://images.unsplash.com/photo-1576941089067-2de3c901e126?auto=format&fit=crop&w=400&q=70';
const houseD =
'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=400&q=70';
const houseE =
'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=400&q=70';
const houseF =
'https://images.unsplash.com/photo-1599809275671-b5942cabc7a2?auto=format&fit=crop&w=400&q=70';

/* ----------------------------- Overview feed -------------------------------- */

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

export const activityEvents: ActivityEvent[] = [
{
  id: 'e1',
  channel: 'email',
  kind: 'inbound',
  actor: 'chatgptcrafters@gmail.com',
  body: 'your welcome brother man',
  time: 'Jun 20, 5:12 AM',
  isHuman: true
},
{
  id: 'e2',
  channel: 'sms',
  kind: 'ai_reply',
  actor: '+15125712595',
  intent: 'buyer_lead',
  body: 'Iris sent SMS reply for buyer_lead.',
  time: 'Jun 20, 3:57 AM'
},
{
  id: 'e3',
  channel: 'sms',
  kind: 'inbound',
  actor: '+15125712595',
  body: 'Inbound SMS: 2',
  time: 'Jun 20, 3:57 AM',
  isHuman: true
},
{
  id: 'e4',
  channel: 'sms',
  kind: 'ai_reply',
  actor: '+15125712595',
  intent: 'property_details',
  body: 'Iris sent SMS reply for property_details.',
  time: 'Jun 20, 3:56 AM'
},
{
  id: 'e5',
  channel: 'sms',
  kind: 'inbound',
  actor: '+15125712595',
  body: 'Inbound SMS: Round rock 3 beds and under 1 million',
  time: 'Jun 20, 3:56 AM',
  isHuman: true
},
{
  id: 'e6',
  channel: 'sms',
  kind: 'ai_reply',
  actor: '+15125712595',
  intent: 'buyer_lead',
  body: 'Iris sent SMS reply for buyer_lead.',
  time: 'Jun 20, 3:55 AM'
},
{
  id: 'e7',
  channel: 'sms',
  kind: 'inbound',
  actor: '+15125712595',
  body: 'Inbound SMS: Anything in round rock?',
  time: 'Jun 20, 3:55 AM',
  isHuman: true
},
{
  id: 'e8',
  channel: 'sms',
  kind: 'inbound',
  actor: '+15125712595',
  body: "Inbound SMS: Yo, what houses do you have in Warwick? I'm looking for three beds. Under $1 million.",
  time: 'Jun 20, 3:55 AM',
  isHuman: true
},
{
  id: 'e9',
  channel: 'email',
  kind: 'inbound',
  actor: 'chatgptcrafters@gmail.com',
  body: 'ready',
  time: 'Jun 20, 2:52 AM',
  isHuman: true
},
{
  id: 'e10',
  channel: 'sms',
  kind: 'ai_reply',
  actor: '+15125712595',
  intent: 'property_details',
  body: 'Iris sent SMS reply for property_details.',
  time: 'Jun 20, 12:57 AM'
},
{
  id: 'e11',
  channel: 'sms',
  kind: 'inbound',
  actor: '+15125712595',
  body: 'Inbound SMS: For the property you just sent me. Are there any other amenities?',
  time: 'Jun 20, 12:57 AM',
  isHuman: true
}];


/* ----------------------------- Review queue --------------------------------- */

export interface ReviewItem {
  id: string;
  channel: Exclude<ChannelId, 'all' | 'properties'>;
  contact: string;
  reason: string;
}

export const reviewQueue: ReviewItem[] = [
{
  id: 'r1',
  channel: 'email',
  contact: 'chatgptcrafters@gmail.com',
  reason: 'Imported from historical log; full body was not recorded.'
},
{
  id: 'r2',
  channel: 'email',
  contact: 'chatgptcrafters@gmail.com',
  reason: 'Imported from historical log; full body was not recorded.'
},
{
  id: 'r3',
  channel: 'email',
  contact: 'ofunrein123@gmail.com',
  reason: 'Imported from historical log; full body was not recorded.'
},
{
  id: 'r4',
  channel: 'email',
  contact: 'ofunrein123@gmail.com',
  reason: 'Imported from historical log; full body was not recorded.'
},
{
  id: 'r5',
  channel: 'email',
  contact: 'ofunrein123@gmail.com',
  reason: 'Imported from historical log; full body was not recorded.'
}];


/* --------------------------- Per-channel stats ------------------------------ */

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

export const channelStats: Record<
  Exclude<ChannelId, 'properties'>,
  ChannelStats> =
{
  all: {
    events: 119,
    threads: 28,
    inbound: 55,
    aiReplies: 64,
    lastActivity: {
      contact: 'chatgptcrafters@gmail.com',
      message: 'message',
      status: 'received',
      when: 'Jun 20, 5:12 AM'
    },
    humanReview: 'flagged'
  },
  email: {
    events: 68,
    threads: 3,
    inbound: 36,
    aiReplies: 32,
    lastActivity: {
      contact: 'chatgptcrafters@gmail.com',
      message: 'message',
      status: 'received',
      when: 'Jun 20, 5:12 AM'
    },
    humanReview: 'flagged'
  },
  sms: {
    events: 51,
    threads: 2,
    inbound: 19,
    aiReplies: 32,
    lastActivity: {
      contact: '+15125712595',
      message: 'Iris sent SMS reply for buyer_lead.',
      status: 'sent',
      when: 'Jun 20, 3:57 AM'
    },
    humanReview: 'clear'
  },
  voice: {
    events: 0,
    threads: 3,
    inbound: 0,
    aiReplies: 0,
    lastActivity: null,
    humanReview: 'clear'
  },
  instagram: {
    events: 0,
    threads: 0,
    inbound: 0,
    aiReplies: 0,
    lastActivity: null,
    humanReview: 'clear'
  },
  messenger: {
    events: 0,
    threads: 0,
    inbound: 0,
    aiReplies: 0,
    lastActivity: null,
    humanReview: 'clear'
  },
  whatsapp: {
    events: 0,
    threads: 0,
    inbound: 0,
    aiReplies: 0,
    lastActivity: null,
    humanReview: 'clear'
  },
  website: {
    events: 0,
    threads: 0,
    inbound: 0,
    aiReplies: 0,
    lastActivity: null,
    humanReview: 'clear'
  }
};

/* ------------------------------ Email data ---------------------------------- */

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

export const emailThreads: EmailThread[] = [
{
  id: 'em1',
  contact: 'chatgptcrafters@gmail.com',
  name: 'ChatGPT Crafters',
  time: 'Jun 20, 5:12 AM',
  preview: 'your welcome brother man',
  messageCount: 18,
  needsReview: true,
  reviewReason: 'Imported from historical log; full body was not recorded.',
  category: 'showing',
  messages: [
  {
    id: 'm1',
    sender: 'ChatGPT Crafters',
    direction: 'inbound',
    time: 'May 20, 5:58 PM',
    subject: '12725 Bloomington Dr #129, Austin, Texas 78748'
  },
  {
    id: 'm2',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 20, 5:58 PM',
    cards: [
    {
      address: '12725 Bloomington Dr #129, Austin, Texas 78748',
      price: '$268,000',
      beds: '4 bed',
      baths: '3 bath',
      sqft: '1,650 sqft'
    }],

    body: 'Hello,\n\nThis four-bedroom, three-bath condo at 12725 Bloomington Dr #129 is listed at $268,000, giving you 1,650 square feet in the 78748 zip code. At current rates, a 30-year fixed mortgage sits around 6.36%, which puts this in a pretty accessible range compared to much of the Austin metro.\n\nThe price comes in well below the Austin median of around $485,000, so it offers solid value if you are looking to get into the city without stretching your budget. Four bedrooms at this price point is genuinely hard to find in Austin proper.\n\nFeel free to reach out with any questions or to set up a showing, same-day visits are available since the home is vacant.\n\nBest regards, Austin Realty (512) 555-0192',
    showSchedule: true
  },
  {
    id: 'm3',
    sender: 'ChatGPT Crafters',
    direction: 'inbound',
    time: 'May 20, 6:12 PM',
    subject: 'Re: 12725 Bloomington Dr #129, Austin, Texas 78748'
  },
  {
    id: 'm4',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 20, 6:12 PM',
    body: "Hello,\n\nHappy to set up a showing for 12725 Bloomington Dr #129, Austin, Texas 78748. You can book a time directly here:\n\nSchedule a Showing\n\nIf none of those slots work, just reply and we'll find something.\n\nBest regards, Austin Realty (512) 555-0192"
  },
  {
    id: 'm5',
    sender: 'ChatGPT Crafters',
    direction: 'inbound',
    time: 'May 24, 10:43 PM',
    subject: 'Hi'
  },
  {
    id: 'm6',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 24, 10:43 PM',
    body: 'Hello,\n\nHere are 6 listings 2+ bed, under $1,000,000, in downtown Austin that match your search.',
    cards: [
    {
      address: '555 5th St #2826',
      price: '$995,000',
      beds: '2 bed',
      baths: '2 bath',
      sqft: '1,454 sqft',
      broker: 'The Leaders Realty, LLC',
      photo: austinSkyline
    },
    {
      address: '603 Davis St APT 2011',
      price: '$675,000',
      beds: '2 bed',
      baths: '2 bath',
      sqft: '1,219 sqft',
      broker: 'eXp Realty, LLC',
      photo: austinSkyline2
    },
    {
      address: '360 Nueces St APT 1405',
      price: '$739,000',
      beds: '2 bed',
      baths: '2 bath',
      sqft: '1,225 sqft',
      broker: 'The Leaders Realty, LLC',
      photo: houseA
    },
    {
      address: '507 Sabine St APT 605',
      price: '$539,000',
      beds: '2 bed',
      baths: '2 bath',
      sqft: '1,456 sqft',
      broker: 'Compass RE Texas, LLC',
      photo: houseB
    },
    {
      address: '70 Rainey St #1509',
      price: '$750,000',
      beds: '2 bed',
      baths: '2 bath',
      sqft: '1,128 sqft',
      broker: 'eXp Realty, LLC',
      photo: houseC
    },
    {
      address: '610 Davis St #2508',
      price: '$875,000',
      beds: '2 bed',
      baths: '2 bath',
      sqft: '1,174 sqft',
      broker: 'Urbanspace',
      photo: houseD
    }],

    showSchedule: true
  },
  {
    id: 'm7',
    sender: 'ChatGPT Crafters',
    direction: 'inbound',
    time: 'May 24, 11:07 PM',
    subject: 'Re: Hi'
  },
  {
    id: 'm8',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 24, 11:07 PM',
    body: "Hello,\n\nI looked through our listings and checked live Zillow inventory for 2-bedroom under $1,000,000 in Hyde Park, Downtown Austin — nothing available right now, but inventory changes daily. I'll reach out as soon as something comes up. Feel free to reply to adjust your search.\n\nAre you currently renting or do you own another property that needs to be sold before closing on a new place?\n\nBest regards, Austin Realty (512) 555-0192"
  },
  {
    id: 'm9',
    sender: 'ChatGPT Crafters',
    direction: 'inbound',
    time: 'May 24, 11:56 PM',
    subject: 'Re: Hi'
  },
  {
    id: 'm10',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 24, 11:56 PM',
    body: 'Thank you for providing those details. One of our agents will be in touch with you shortly.\n\nBest regards, Austin Realty (512) 555-0192',
    flag: 'Imported from historical log; full body was not recorded.'
  },
  {
    id: 'm11',
    sender: 'ChatGPT Crafters',
    direction: 'inbound',
    time: 'May 24, 11:59 PM',
    subject: 'Re: Hi'
  },
  {
    id: 'm12',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 24, 11:59 PM',
    body: 'Hello,\n\nHere are the details on the 2 properties you asked about.\n\nWhat is your target timeline for selling the Round Rock property and closing on the new Hyde Park home?\n\nBest regards, Austin Realty (512) 555-0192',
    cards: [
    {
      address: '70 Rainey St #1509',
      price: '$750,000',
      beds: '2 bed',
      baths: '2 bath',
      sqft: '1,128 sqft',
      broker: 'eXp Realty, LLC',
      photo: houseC
    },
    {
      address: '4309 Fairway Path',
      price: '$407,800',
      beds: '4 bed',
      baths: '2.5 bath',
      blurb:
      'This is a 2,702 square foot, 2.5 bathroom, single family home. This home is located at 4309 Fairway Path, Round Rock, TX.'
    }],

    showSchedule: true
  },
  {
    id: 'm13',
    sender: 'ChatGPT Crafters',
    direction: 'inbound',
    time: 'May 25, 12:02 AM',
    subject: 'Re: Hi'
  },
  {
    id: 'm14',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 25, 12:02 AM',
    body: 'Thank you for providing those details. One of our agents will be in touch with you shortly.\n\nBest regards, Austin Realty (512) 555-0192',
    flag: 'Imported from historical log; full body was not recorded.'
  },
  {
    id: 'm15',
    sender: 'Owner',
    direction: 'owner',
    time: 'Jun 20, 2:52 AM',
    body: 'ready'
  },
  {
    id: 'm16',
    sender: 'Owner',
    direction: 'owner',
    time: 'Jun 20, 5:12 AM',
    body: 'your welcome brother man'
  }]

},
{
  id: 'em2',
  contact: 'ofunrein123@gmail.com',
  name: 'O. Funrein',
  time: 'May 20, 3:51 AM',
  preview: 'Intent: unknown | role: unknown',
  messageCount: 48,
  needsReview: true,
  reviewReason: 'Imported from historical log; full body was not recorded.',
  category: 'needs-human',
  messages: [
  {
    id: 'o1',
    sender: 'O. Funrein',
    direction: 'inbound',
    time: 'May 20, 3:51 AM',
    subject: 'Intent: unknown | role: unknown'
  },
  {
    id: 'o2',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 20, 3:52 AM',
    body: 'Hello,\n\nThanks for reaching out to Austin Realty. To point you to the right listings, could you share your target area, budget, and bedroom count?\n\nBest regards, Austin Realty (512) 555-0192',
    flag: 'Imported from historical log; full body was not recorded.'
  }]

},
{
  id: 'em3',
  contact: 'austinhayes471@gmail.com',
  name: 'Austin Hayes',
  time: 'May 20, 2:13 AM',
  preview: 'Iris replied to unknown',
  messageCount: 2,
  category: 'nurture',
  messages: [
  {
    id: 'a1',
    sender: 'Austin Hayes',
    direction: 'inbound',
    time: 'May 20, 2:13 AM',
    subject: 'Inquiry'
  },
  {
    id: 'a2',
    sender: 'Iris',
    direction: 'iris',
    time: 'May 20, 2:14 AM',
    body: 'Hello,\n\nThanks for getting in touch. What area and price range are you considering? I can pull current listings right away.\n\nBest regards, Austin Realty (512) 555-0192'
  }]

}];


/* ------------------------------- SMS data ----------------------------------- */

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

export const smsThreads: SmsThread[] = [
{
  id: 'sm1',
  contact: '+15125712595',
  time: 'Jun 20, 3:57 AM',
  preview: 'Iris sent SMS reply for buyer_lead.',
  messageCount: 49,
  category: 'hot-lead',
  messages: [
  {
    id: 's1',
    direction: 'iris',
    time: 'Jun 11, 12:35 AM',
    body: 'Photo for 4608 Wally Ave, Austin TX 78721: https://maps.googleapis.com/maps/api/streetview?location=4608%20Wally%20Ave… Sorry for the runaround. A real person from our team is reaching out to you now.'
  },
  {
    id: 's2',
    direction: 'inbound',
    time: 'Jun 11, 12:35 AM',
    body: 'Send a damn photo you dummy'
  },
  {
    id: 's3',
    direction: 'iris',
    time: 'Jun 11, 11:21 AM',
    body: 'Here are the full details on 4309 Fairway Path: 4309 Fairway Path • $407,800 • 4bd/2.5ba • 2,702 square feet • Cat Hollow https://www.zillow.com/homedetails/4309-Fairway-Path-Round-Rock-TX-78665/70987534_zpid/'
  },
  {
    id: 's4',
    direction: 'inbound',
    time: 'Jun 11, 11:28 AM',
    body: 'Give me a photo of 610 Davis St #2508 70 Rainey St #1509'
  },
  {
    id: 's5',
    direction: 'inbound',
    time: 'Jun 11, 12:36 PM',
    body: 'Give me a photo of 610 Davis St #2508 70 Rainey St #1509'
  },
  {
    id: 's6',
    direction: 'iris',
    time: 'Jun 11, 12:37 PM',
    body: 'Sending the property photos for: 1. 610 Davis St #2508 - $875,000, 2bd/2ba, Downtown Austin 2. 70 Rainey St #1509 - $750,000, 2bd/2ba, Downtown Austin'
  },
  {
    id: 's7',
    direction: 'inbound',
    time: 'Jun 11, 4:20 PM',
    body: 'Give me a photo of 610 Davis St #2508 70 Rainey St #1509'
  },
  {
    id: 's8',
    direction: 'iris',
    time: 'Jun 11, 4:20 PM',
    body: 'Sending the property photos for: 1. 610 Davis St #2508 - $875,000, 2bd/2ba, Downtown Austin 2. 70 Rainey St #1509 - $750,000, 2bd/2ba, Downtown Austin'
  },
  {
    id: 's9',
    direction: 'iris',
    time: 'Jun 18, 12:11 AM',
    body: 'Your welcome'
  },
  {
    id: 's10',
    direction: 'iris',
    time: 'Jun 18, 2:21 AM',
    body: 'thanks brother'
  },
  {
    id: 's11',
    direction: 'iris',
    time: 'Jun 19, 7:48 AM',
    body: 'Hi, this is Iris with Austin Realty. I just tried reaching you by phone. I was calling about your real estate request. You can call or text back here, or reach us at +15128469460.'
  },
  {
    id: 's12',
    direction: 'iris',
    time: 'Jun 19, 7:51 AM',
    body: 'Hi, this is Iris with Austin Realty. I just tried reaching you by phone. I was calling about your real estate request. You can call or text back here, or reach us at +15128469460.'
  },
  {
    id: 's13',
    direction: 'inbound',
    time: 'Jun 19, 7:52 AM',
    body: 'Thanks what properties do you have available under 3k a month in downtown Austin with at least 1 bed'
  },
  {
    id: 's14',
    direction: 'inbound',
    time: 'Jun 19, 7:52 AM',
    body: 'And can you send me photos'
  },
  {
    id: 's15',
    direction: 'inbound',
    time: 'Jun 19, 7:52 AM',
    body: 'Apartments I mean'
  },
  {
    id: 's16',
    direction: 'iris',
    time: 'Jun 19, 7:54 AM',
    body: 'Hi, this is Iris with Austin Realty. I just tried reaching you by phone. You can call or text back here, or reach us at +15128469460.'
  },
  {
    id: 's17',
    direction: 'iris',
    time: 'Jun 19, 8:01 AM',
    body: 'I found the listing, but the direct image source is not sendable by SMS. The photo gallery is here: 1. 610 Davis St #2508 - $875,000, 2bd/2ba, Downtown Austin 2. 610 Davis St #3001 - $567,000, 1bd/1ba 3. 610 Davis St #3508 - $550,800, 1bd/1ba'
  },
  {
    id: 's18',
    direction: 'iris',
    time: 'Jun 19, 8:08 AM',
    body: 'I found the listing, but the direct image source is not sendable by SMS. The photo gallery is here: 1. 610 Davis St #2508 - $875,000, 2bd/2ba 2. 610 Davis St #4807 - $5,832/mo, 2bd/2ba 3. 610 Davis St #4903 - $5,536,500, 5bd/6ba'
  },
  {
    id: 's19',
    direction: 'iris',
    time: 'Jun 19, 8:15 AM',
    body: 'Got it — here are matches I found: 1. 6814 Old Quarry Ln - $1,703/mo, Northwest Austin 2. 6816 Beatty Dr - $2,800/mo, 3bd/2ba 3. 6903 Deatonhill Dr APT 19 - $1,242/mo, 1bd/1ba. Which one should I focus on first?'
  },
  {
    id: 's20',
    direction: 'inbound',
    time: 'Jun 19, 8:21 AM',
    body: 'The first one tell me more about it'
  },
  {
    id: 's21',
    direction: 'iris',
    time: 'Jun 19, 8:21 AM',
    body: "I'm going to have a real person follow up on that so we handle it correctly."
  },
  {
    id: 's22',
    direction: 'iris',
    time: 'Jun 19, 8:29 AM',
    body: '6814 Old Quarry Ln: $1,703/mo, Northwest Austin, 1,020 sqft, built 1982, Townhouse. Investment property. Want me to send photos, book a showing, or find similar options?'
  },
  {
    id: 's23',
    direction: 'inbound',
    time: 'Jun 19, 8:32 AM',
    body: 'Similar options'
  },
  {
    id: 's24',
    direction: 'iris',
    time: 'Jun 19, 8:32 AM',
    body: "I'm going to have a real person follow up on that so we handle it correctly."
  },
  {
    id: 's25',
    direction: 'iris',
    time: 'Jun 19, 8:39 AM',
    body: 'Got it — here are matches I found: 1. 70 Rainey St #1509 - $750,000, 2bd/2ba, Downtown 2. 7603 Beinville Cv - $887,600, 1,330 sqft 3. 8611 Winding Walk - $847,000, 1,790 sqft. Which one should I focus on first?'
  },
  {
    id: 's26',
    direction: 'iris',
    time: 'Jun 19, 8:46 AM',
    body: 'Got it — here are matches I found: 1. 8802 Clearbrook Trl - $1,699/mo, 2bd/2ba 2. 8600 N FM 620 APT 1841 - $1,643/mo, 3bd/2ba 3. 8330 Fathom Cir APT 702 - $1,900/mo, 2bd/2ba. Which one should I focus on first?'
  },
  {
    id: 's27',
    direction: 'inbound',
    time: 'Jun 19, 4:28 PM',
    body: 'send photos of that first one'
  },
  {
    id: 's28',
    direction: 'iris',
    time: 'Jun 19, 4:28 PM',
    body: 'Sending the property photos for: 1. 6814 Old Quarry Ln - $1,703/mo 2. 8330 Fathom Cir APT 702 - $1,900/mo, 2bd/2ba 3. 8810 Dawnridge Cir APT 101 - $1,700/mo, 2bd/2ba'
  },
  { id: 's29', direction: 'inbound', time: 'Jun 19, 4:49 PM', body: 'hi' },
  {
    id: 's30',
    direction: 'iris',
    time: 'Jun 19, 4:49 PM',
    body: "I'm going to have a real person follow up on that so we handle it correctly."
  },
  {
    id: 's31',
    direction: 'iris',
    time: 'Jun 19, 4:55 PM',
    body: 'Hi, this is Iris with Austin Realty. I can help find listings, send photos, compare options, or book a showing. What area, budget, and bedroom count should I search?'
  },
  {
    id: 's32',
    direction: 'iris',
    time: 'Jun 19, 8:08 PM',
    body: 'hello my friend whats going on'
  },
  {
    id: 's33',
    direction: 'inbound',
    time: 'Jun 20, 12:55 AM',
    body: 'Thanks for everything'
  },
  {
    id: 's34',
    direction: 'iris',
    time: 'Jun 20, 12:55 AM',
    body: 'Sending the property photos for: 1. 610 Davis St #2508 - $875,000, 2bd/2ba 2. 610 Davis St #5003 - $5,582,000, 4bd/5ba 3. 610 Davis St #4903 - $5,536,500, 5bd/6ba [MMS images attached]'
  },
  {
    id: 's35',
    direction: 'inbound',
    time: 'Jun 20, 12:56 AM',
    body: 'Tell me more about the first property what neighborhood is it in?'
  },
  {
    id: 's36',
    direction: 'iris',
    time: 'Jun 20, 12:56 AM',
    body: '610 Davis St #2508: $875,000, 2bd/2ba, Downtown Austin, 1,174 sqft, built 2025, Condo. Central Air, Balcony, Parking, Modern Finishes. Want me to send photos, book a showing, or find similar options?'
  },
  {
    id: 's37',
    direction: 'inbound',
    time: 'Jun 20, 12:57 AM',
    body: 'For the property you just sent me. Are there any other amenities?'
  },
  {
    id: 's38',
    direction: 'iris',
    time: 'Jun 20, 12:57 AM',
    body: 'I can help narrow the search. Send me the area, budget, bedroom count, and whether you want to buy or rent.'
  },
  {
    id: 's39',
    direction: 'inbound',
    time: 'Jun 20, 3:55 AM',
    body: "Yo, what houses do you have in Warwick? I'm looking for three beds. Under $1 million."
  },
  {
    id: 's40',
    direction: 'iris',
    time: 'Jun 20, 3:55 AM',
    body: 'Got it — here are matches I found: 1. 6814 E Riverside Dr Unit 44 - $386,100, 4bd/3ba 2. 6814 E Riverside Dr Unit 55 - $349,900, 4bd/3ba 3. 6814 Old Quarry Ln - $1,703/mo. Which one should I focus on first?'
  },
  {
    id: 's41',
    direction: 'inbound',
    time: 'Jun 20, 3:55 AM',
    body: 'Anything in round rock?'
  },
  {
    id: 's42',
    direction: 'iris',
    time: 'Jun 20, 3:55 AM',
    body: 'I can help narrow the search. Send me the area, budget, bedroom count, and whether you want to buy or rent.'
  },
  {
    id: 's43',
    direction: 'inbound',
    time: 'Jun 20, 3:56 AM',
    body: 'Round rock 3 beds and under 1 million'
  },
  {
    id: 's44',
    direction: 'iris',
    time: 'Jun 20, 3:56 AM',
    body: 'Got it — here are matches I found: 1. 700 Whitetail Dr - $699,000, 4bd/4ba 2. 701 Old Ravine Ct - $700,000, 5bd/4ba 3. 808 Bent Wood Pl - $560,000, 4bd/3ba. Which one should I focus on first?'
  },
  { id: 's45', direction: 'inbound', time: 'Jun 20, 3:57 AM', body: '2' },
  {
    id: 's46',
    direction: 'iris',
    time: 'Jun 20, 3:57 AM',
    body: 'I can help narrow the search. Send me the area, budget, bedroom count, and whether you want to buy or rent.'
  }]

},
{
  id: 'sm2',
  contact: '+15128152032',
  time: 'Jun 18, 2:21 AM',
  preview: 'Outbound SMS sent.',
  messageCount: 2,
  category: 'needs-reply',
  messages: [
  {
    id: 'b1',
    direction: 'iris',
    time: 'Jun 18, 2:20 AM',
    body: 'Hi, this is Iris with Austin Realty following up on your showing request for 4309 Fairway Path tomorrow at 10:30 AM. An agent will confirm shortly.'
  },
  {
    id: 'b2',
    direction: 'iris',
    time: 'Jun 18, 2:21 AM',
    body: 'Outbound SMS sent.'
  }]

}];


/* ------------------------------ Voice data ---------------------------------- */

export type CallOutcome =
'voicemail' |
'silence-timed-out' |
'assistant-forwarded-call' |
'assistant-ended-call';

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
}

export interface VoiceContact {
  id: string;
  contact: string;
  time: string;
  summary: string;
  callCount: number;
  tag: string;
  calls: Call[];
}

export const voiceContacts: VoiceContact[] = [
{
  id: 'vc2',
  contact: '+15125712595',
  time: 'Jun 19, 5:41 AM',
  summary:
  "The user called Austin Realty seeking to buy a 3-bedroom home in South Austin, initially specifying Southwest Austin. Despite providing their criteria and being pre-approved, the user became increasingly frustrated and used offensive language when the AI suggested sending property options via text or email, demanding specific details immediately over the phone. Due to the user's escalating agitation, the AI forwarded the call to a team member.",
  callCount: 7,
  tag: 'assistant-forwarded-call',
  calls: [
  {
    id: 'c1',
    time: 'Jun 19, 7:55 AM',
    duration: '24s',
    outcome: 'voicemail',
    turns: [
    {
      speaker: 'Iris',
      text: 'Thanks for calling Austin Realty. This is Arya. How can I help?'
    },
    {
      speaker: 'Lead',
      text: 'Not available. At the tone, please record your message. When you have finished recording, you may hang up.'
    },
    {
      speaker: 'Iris',
      text: 'Hi. This is Arya with Austin Realty. I called about your real estate request. I also sent you a quick text. Call or text me back at five one two eight four six nine four six zero. Thanks.'
    }],

    report:
    'Arya from Austin Realty called a user regarding a real estate request, but the call went to voicemail. She left a message asking the user to call or text her back at 512-846-9460, mentioning she also sent a text.'
  },
  {
    id: 'c2',
    time: 'Jun 19, 7:52 AM',
    duration: '49s',
    outcome: 'silence-timed-out',
    turns: [
    {
      speaker: 'Iris',
      text: 'Thanks for -- Austin Realty. This is Arya. How can I help?'
    },
    {
      speaker: 'Lead',
      text: 'Available. At the tone, please record your message. When you have finished recording, you may hang up.'
    },
    {
      speaker: 'Iris',
      text: 'It sounds like you reached a voice mail. If you want, I can help you with any real estate questions or property searches in the Austin area. Just let me know.'
    }],

    report:
    "The call began with an AI from Austin Realty answering, but the user's system immediately played a voicemail tone. The AI then left a message offering assistance. The call subsequently ended due to silence."
  },
  {
    id: 'c3',
    time: 'Jun 19, 6:45 AM',
    duration: '5m 2s',
    outcome: 'assistant-ended-call',
    turns: [
    {
      speaker: 'Iris',
      text: 'Thanks for calling Austin Realty. This is Arya. How can I help?'
    },
    {
      speaker: 'Lead',
      text: 'Hello. What properties you have available in Austin?'
    },
    {
      speaker: 'Iris',
      text: 'One moment. I found three available properties in Austin, a four bed, three bath at 10026 Mirage Cv listed for $3,500, and two three bed, two bath units at 1007 Markham Ln. Would you like details?'
    },
    {
      speaker: 'Lead',
      text: 'But can you tell me about 4309 Fairway Road?'
    },
    {
      speaker: 'Iris',
      text: "4309 Fairway Road is listed for $407,800. It has four bedrooms, 2.5 bathrooms, and about 2,702 square feet. It's in the Cat Hollow neighborhood. What timeline are you looking at for a move?"
    },
    { speaker: 'Lead', text: 'What about 4309 Fairway Pass?' },
    {
      speaker: 'Iris',
      text: "I don't have info for 4309 Fairway Pass. Can you confirm the full street address and city?"
    },
    {
      speaker: 'Lead',
      text: 'No. No. No. You stupid... I said 4309 Fairway Ave, Round Rock, Texas.'
    },
    {
      speaker: 'Iris',
      text: 'I hear you. 4309 Fairway Avenue in Round Rock is listed for four hundred seven thousand...'
    },
    {
      speaker: 'Lead',
      text: "No. It's not avenue. It's path. Path. Path."
    },
    {
      speaker: 'Iris',
      text: "Thanks for clarifying. 4309 Fairway Path in Round Rock is listed at $407,800 with four beds, 2.5 baths, and 2,702 square feet in the Cat Hollow neighborhood. Does that sound like the property you're asking about?"
    },
    {
      speaker: 'Lead',
      text: 'Yes. I wanna schedule a showing tomorrow at ten thirty AM.'
    },
    {
      speaker: 'Iris',
      text: 'Can I have your phone number to have an agent reach out and set up the showing for tomorrow at ten thirty AM?'
    },
    {
      speaker: 'Lead',
      text: 'Yes. It is five one two eight one five two zero three two.'
    },
    {
      speaker: 'Iris',
      text: "Got it. I'll pass your requested showing for tomorrow at 10:30 AM at 4309 Fairway Path in Round Rock, along with your phone number, to an agent. Goodbye."
    }],

    report:
    'The user initially inquired about properties in Austin but then focused on 4309 Fairway Path, Round Rock, which required multiple clarifications due to miscommunications about the street name. After confirming details, the user requested a showing for tomorrow at 10:30 AM. The AI confirmed it would pass the request and phone number to an agent.'
  },
  {
    id: 'c4',
    time: 'Jun 19, 5:41 AM',
    duration: '9s',
    outcome: 'assistant-forwarded-call',
    turns: [
    {
      speaker: 'Iris',
      text: 'Thanks for calling Austin Realty. This is Arya. How can I help?'
    },
    { speaker: 'Lead', text: 'Connecting to team member.' },
    {
      speaker: 'Iris',
      text: 'Connecting you with a team member now. One moment.'
    }],

    report:
    "The call began with Austin Realty's AI answering. The user immediately requested to be connected to a team member. The AI confirmed it was connecting the user, indicating the call was forwarded."
  },
  {
    id: 'c5',
    time: 'Jun 19, 5:41 AM',
    duration: '3m 24s',
    outcome: 'assistant-forwarded-call',
    turns: [
    {
      speaker: 'Iris',
      text: 'Thanks for calling Austin Realty. This is Arya. How can I help?'
    },
    {
      speaker: 'Lead',
      text: 'Hey. How are you? What properties do you have available?'
    },
    {
      speaker: 'Iris',
      text: "I'm doing well, thanks. Are you looking to buy or rent? And do you have a particular area or price range in mind?"
    },
    {
      speaker: 'Lead',
      text: "I'm looking to buy. Southwest Austin. Three beds."
    },
    {
      speaker: 'Iris',
      text: 'Three bedrooms in Southwest Austin with flexible bathrooms. Are you planning to sell a home before buying, or is this your first purchase?'
    },
    {
      speaker: 'Lead',
      text: "Selling a home. Second time buyer. I'm preapproved."
    },
    {
      speaker: 'Iris',
      text: "Perfect. What's the best way to follow up with you — phone, text, or email?"
    },
    {
      speaker: 'Lead',
      text: 'Text. But I wanna know a property available first.'
    },
    {
      speaker: 'Iris',
      text: "I'll send you some options for three bedroom homes in Southwest Austin by text shortly."
    },
    {
      speaker: 'Lead',
      text: "Give me specifics. Don't text me. Tell me what they are right now."
    },
    {
      speaker: 'Iris',
      text: 'I hear you. To get you exact details on current listings, let me grab your email or phone so I can send accurate info right away.'
    },
    {
      speaker: 'Lead',
      text: "Don't send me info. I want them on the call right now."
    },
    {
      speaker: 'Iris',
      text: 'Hold on a sec. Connecting you with a team member now. One moment.'
    }],

    report:
    'The user called seeking a 3-bedroom home in South Austin, was pre-approved, but became frustrated and used offensive language when the AI suggested sending options via text/email. Due to escalating agitation, the AI forwarded the call to a team member.'
  }]

},
{
  id: 'vc1',
  contact: '+15128152032',
  time: 'Jun 19, 7:59 AM',
  summary:
  'An AI agent from Austin Realty, Arya, attempted to contact a user regarding a real estate request. The agent left two voicemails, stating she had also sent a text and provided a contact number (512-846-9460) for the user to call or text back. The user was unavailable, and the call ultimately ended in voicemail.',
  callCount: 1,
  tag: 'voicemail',
  calls: [
  {
    id: 'd1',
    time: 'Jun 19, 7:49 AM',
    duration: '33s',
    outcome: 'voicemail',
    turns: [
    {
      speaker: 'Iris',
      text: 'Thanks for calling Austin Realty. This is Arya. How can I help?'
    },
    {
      speaker: 'Lead',
      text: 'is not available. At the tone, please record your message.'
    },
    {
      speaker: 'Iris',
      text: 'Hi. This is Arya with Austin Realty. I was reaching out about your real estate request and wanted to make sure we got you the right property details. You can call or text us back at 512-846-9460. I also sent you a quick text.'
    }],

    report:
    'Arya called a user regarding a real estate request, but the call went to voicemail. She left a message providing 512-846-9460 to call or text back, mentioning a follow-up text was sent.'
  }]

},
{
  id: 'vc3',
  contact: '+18644385911',
  time: 'Jun 19, 3:58 AM',
  summary:
  'The call began with an AI from Austin Realty greeting the user. The user repeatedly provided a verification code ("two five three four two one") to the AI. The AI acknowledged receiving the code and asked how it could assist further, but the call ended shortly after.',
  callCount: 1,
  tag: 'assistant-ended-call',
  calls: [
  {
    id: 'f1',
    time: 'Jun 19, 3:58 AM',
    duration: '41s',
    outcome: 'assistant-ended-call',
    turns: [
    {
      speaker: 'Iris',
      text: 'Thanks for calling Austin Realty. This is Arya. How can I help?'
    },
    { speaker: 'Lead', text: 'Two five three four two one.' },
    {
      speaker: 'Iris',
      text: 'Got it, I received the code two five three four two one. How can I help you further?'
    },
    { speaker: 'Lead', text: 'Two five three four two one.' },
    {
      speaker: 'Iris',
      text: 'Thanks. Is there anything else I can help you with today?'
    }],

    report:
    'The call began with an AI greeting. The user repeatedly provided a verification code. The AI acknowledged receiving the code and asked how it could assist, but the call ended shortly after.'
  }]

}];


/* ----------------------------- Properties ----------------------------------- */

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

export const properties: Property[] = [
{
  id: 'p1',
  address: '825 Whitetail Dr',
  city: 'Round Rock',
  price: '$424,900',
  priceNum: '$424,900',
  beds: '3',
  baths: '2',
  sqft: '1725',
  year: '2002',
  type: 'Single-Family Home',
  status: 'FOR SALE',
  neighborhood: 'Round Rock',
  zip: '78681',
  photo: propertyPhotoA,
  broker: 'Teifke Real Estate'
},
{
  id: 'p2',
  address: '813 Whitetail Dr',
  city: 'Round Rock',
  price: '$445,900',
  priceNum: '$445,900',
  beds: '3',
  baths: '2',
  sqft: '1753',
  year: '2019',
  type: 'Single-Family Home',
  status: 'For Sale',
  neighborhood: 'Round Rock',
  zip: '78681',
  photo: houseA,
  broker: 'Teifke Real Estate'
},
{
  id: 'p3',
  address: '808 Bent Wood Pl',
  city: 'Round Rock',
  price: '$560,000',
  priceNum: '$560,000',
  beds: '4',
  baths: '3',
  sqft: '2957',
  year: '2005',
  type: 'Single-Family Home',
  status: 'FOR SALE',
  neighborhood: 'Round Rock',
  zip: '78665',
  photo: houseB,
  broker: 'Teifke Real Estate'
},
{
  id: 'p4',
  address: '701 Old Ravine Ct',
  city: 'Round Rock',
  price: '$700,000',
  priceNum: '$700,000',
  beds: '5',
  baths: '4',
  sqft: '4636',
  year: '2005',
  type: 'Single-Family Home',
  status: 'FOR SALE',
  neighborhood: 'Round Rock',
  zip: '78665',
  photo: houseC,
  broker: 'Teifke Real Estate'
},
{
  id: 'p5',
  address: '700 Whitetail Dr',
  city: 'Round Rock',
  price: '$699,000',
  priceNum: '$699,000',
  beds: '4',
  baths: '4',
  sqft: '3171',
  year: '2002',
  type: 'Single-Family Home',
  status: 'FOR SALE',
  neighborhood: 'Round Rock',
  zip: '78681',
  photo: houseD,
  broker: 'Teifke Real Estate'
},
{
  id: 'p6',
  address: '702 Dover Ln',
  city: 'Round Rock',
  price: '$385',
  priceNum: '$385',
  beds: '1',
  baths: '1',
  sqft: '2264',
  year: '2001',
  type: 'Single-Family Home',
  neighborhood: 'Round Rock',
  zip: '78664',
  photo: houseE,
  broker: 'Teifke Real Estate'
},
{
  id: 'p7',
  address: '700 Louis Henna Blvd #611',
  city: 'Round Rock',
  price: '$790 per month',
  priceNum: '$790 per month',
  beds: '1',
  baths: 'Blank',
  sqft: '491',
  year: '1999',
  type: 'Apartment',
  neighborhood: 'Round Rock',
  zip: '78664',
  photo: houseF,
  broker: 'Teifke Real Estate'
},
{
  id: 'p8',
  address: '6816 Beatty Dr',
  city: 'Austin',
  price: '$2,800 per month',
  priceNum: '$2,800 per month',
  beds: '3',
  baths: '2',
  sqft: '1687',
  year: '1998',
  type: 'Single-Family Home',
  neighborhood: 'Austin',
  zip: '78749',
  photo: houseA,
  broker: 'Teifke Real Estate'
},
{
  id: 'p9',
  address: '6815 Cougar Run',
  city: 'Northwest Austin · Austin',
  price: '$969,800',
  priceNum: '$969,800',
  beds: '3',
  baths: '3',
  sqft: '2625',
  year: '1991',
  type: 'Single-Family Home',
  status: 'For Sale',
  neighborhood: 'Northwest Austin',
  zip: '78729',
  photo: houseB,
  broker: 'Teifke Real Estate'
},
{
  id: 'p10',
  address: '6814 Old Quarry Ln',
  city: 'Northwest Austin · Austin',
  price: '$1,703 per month',
  priceNum: '$1,703 per month',
  beds: 'Blank',
  baths: 'Blank',
  sqft: '1020',
  year: '1982',
  type: 'Townhouse',
  neighborhood: 'Northwest Austin',
  zip: '78731',
  photo: houseC,
  broker: 'Teifke Real Estate'
},
{
  id: 'p11',
  address: '6814 E Riverside Dr Unit 55',
  city: 'East Riverside · Austin',
  price: '$349,900',
  priceNum: '$349,900',
  beds: '4',
  baths: '3',
  sqft: '1916',
  year: '2017',
  type: 'Townhouse',
  neighborhood: 'East Riverside',
  zip: '78741',
  broker: 'Teifke Real Estate'
},
{
  id: 'p12',
  address: '6814 E Riverside Dr Unit 44',
  city: 'East Riverside · Austin',
  price: '$386,100',
  priceNum: '$386,100',
  beds: '4',
  baths: '3',
  sqft: '1912',
  year: '2018',
  type: 'Townhouse',
  neighborhood: 'East Riverside',
  zip: '78741',
  photo: houseD,
  broker: 'Teifke Real Estate'
},
{
  id: 'p13',
  address: '9605 Corbe Dr',
  city: 'Austin 78726',
  price: '$1,150,000',
  priceNum: '$1,150,000',
  beds: '5',
  baths: '5',
  sqft: '4226',
  year: '1999',
  type: 'Single-Family Home',
  neighborhood: 'Austin',
  zip: '78726',
  photo: houseE,
  broker: 'Teifke Real Estate'
}];


export const propertyHealth = {
  score: 100,
  total: 100,
  clean: '100% clean',
  missingCore: 0,
  duplicateGroups: 1,
  rows: 2540
};

/* ------------------------------- Metrics ------------------------------------ */

export const metrics = {
  needReview: 9,
  leadsTotal: 4,
  events: 119,
  threads: 28,
  inbound: 55,
  aiReplies: 64,
  flaggedThreads: 5,
  propertyHealth: 100,
  activityDays: 14,
  peakDay: 'Jun 19',
  peakCount: 24
};

export const sparkline = [3, 6, 4, 8, 5, 9, 7, 12, 8, 14, 11, 18, 13, 24];

// Small trend series for the Overview stat cards' inline area charts.
export interface TrendPoint {
  value: number;
}
function toTrend(values: number[]): TrendPoint[] {
  return values.map((value) => ({ value }));
}

export const statTrends = {
  needReview: toTrend([2, 4, 3, 6, 5, 8, 6, 9, 7, 11, 9, 12, 10, 9]),
  leadsTotal: toTrend([1, 2, 2, 3, 3, 2, 4, 3, 4, 4, 3, 4, 4, 4]),
  events: toTrend([8, 14, 10, 22, 16, 28, 20, 34, 26, 44, 38, 52, 47, 53]),
  aiRate: toTrend([72, 78, 75, 81, 79, 84, 82, 88, 85, 90, 87, 92, 89, 94])
};