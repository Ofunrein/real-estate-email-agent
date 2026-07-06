// Iris Design System — canonical tokens, ported from
// "Iris Dashboard.dc.html" (Claude Design export, Austin Realty demo).
// Semantic split: `primary` (ink) drives structural chrome — buttons, active
// nav, borders. `accent` (amber) is reserved for "Iris did this" signals —
// AI avatar rings, AI badges, draft banners. Do not use accent for generic UI.
export interface IrisPalette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  card: string;
  cardBorder: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  primary: string;
  onPrimary: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  channel: {
    email: string;
    sms: string;
    whatsapp: string;
    instagram: string;
    messenger: string;
    voice: string;
    calendar: string;
    crm: string;
  };
}

export const IRIS_LIGHT: IrisPalette = {
  bg: '#F5F4EE',
  surface: '#FFFFFF',
  surface2: '#EFEDE4',
  border: '#E2DFD4',
  card: '#FFFFFF',
  cardBorder: 'rgba(15,23,42,0.09)',
  text: '#0E0E0F',
  textMuted: '#5C5A52',
  textSubtle: '#949186',
  primary: '#1A1815',
  onPrimary: '#FFFFFF',
  accent: '#C49A52',
  accentSoft: '#F1E8D4',
  accentInk: '#8A6512',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  info: '#2563EB',
  infoSoft: '#DBEAFE',
  channel: {
    email: '#C49A52',
    sms: '#2F5D7C',
    whatsapp: '#1F9D6D',
    instagram: '#C2568F',
    messenger: '#C2568F',
    voice: '#A9863F',
    calendar: '#2563EB',
    crm: '#8A6D38',
  },
};

export const IRIS_DARK: IrisPalette = {
  bg: '#0B0F14',
  surface: '#141B24',
  surface2: '#1B2430',
  border: '#2A323D',
  card: '#171E29',
  cardBorder: 'rgba(255,255,255,0.09)',
  text: '#F5F3EF',
  textMuted: '#E6E3DD',
  textSubtle: '#D2CFC8',
  primary: '#F0EEEB',
  onPrimary: '#1A1815',
  accent: '#C49A52',
  accentSoft: 'rgba(196,154,82,0.15)',
  accentInk: '#D9B878',
  success: '#34D399',
  successSoft: 'rgba(52,211,153,0.12)',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.12)',
  warning: '#FBBF24',
  warningSoft: 'rgba(251,191,36,0.12)',
  info: '#60A5FA',
  infoSoft: 'rgba(96,165,250,0.12)',
  channel: {
    email: '#C49A52',
    sms: '#7BA0BE',
    whatsapp: '#4FD0A0',
    instagram: '#E08CBA',
    messenger: '#E08CBA',
    voice: '#E0B968',
    calendar: '#60A5FA',
    crm: '#D9B878',
  },
};

export function irisPalette(mode: 'light' | 'dark'): IrisPalette {
  return mode === 'dark' ? IRIS_DARK : IRIS_LIGHT;
}

export const IRIS_FONT_UI = '"Onest", system-ui, -apple-system, sans-serif';
export const IRIS_FONT_MONO = '"Geist Mono", "Berkeley Mono", "Courier New", monospace';
export const IRIS_RADIUS = { sm: 8, md: 12, lg: 16 };
export const IRIS_SHADOW = {
  sm: '0 1px 2px rgba(20,20,30,0.05)',
  md: '0 4px 16px rgba(20,20,30,0.08)',
  lg: '0 12px 40px rgba(20,20,30,0.12)',
};
