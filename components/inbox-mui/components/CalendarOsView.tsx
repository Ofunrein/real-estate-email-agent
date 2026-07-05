"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import EventIcon from '@mui/icons-material/EventOutlined';
import LinkOffIcon from '@mui/icons-material/LinkOffOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import SyncIcon from '@mui/icons-material/SyncOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import { useColorMode } from '../theme/ColorModeContext';

type CalendarViewMode = 'day' | 'week' | 'month';
type CalendarTab = 'appointments' | 'settings';
type LoadState = 'loading' | 'ready' | 'empty' | 'mock' | 'disconnected';

type CalendarAppointment = {
  id: string;
  title: string;
  contact: string;
  start: string;
  end?: string;
  status: string;
  type: string;
  location: string;
  channel: string;
  notes: string;
};

type CalendarSetting = {
  id: string;
  label: string;
  value: string;
  detail: string;
  status: 'ready' | 'needs_setup' | 'mock';
};

const disconnectedSettings: CalendarSetting[] = [
  {
    id: 'calendar-source',
    label: 'Calendar source',
    value: 'Disconnected',
    detail: 'Backend calendar API is not returning a live provider yet.',
    status: 'needs_setup'
  },
  {
    id: 'booking-window',
    label: 'Booking window',
    value: '9 AM - 6 PM',
    detail: 'Displayed as a UI placeholder until settings are wired.',
    status: 'mock'
  },
  {
    id: 'handoff-rule',
    label: 'Human review',
    value: 'Sensitive changes',
    detail: 'Reschedules and cancellations stay visible for review.',
    status: 'mock'
  }
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function listFrom(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  const nested = asRecord(record.data);
  for (const key of keys) {
    const candidate = nested[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function appointmentFrom(raw: unknown, index: number): CalendarAppointment {
  const item = asRecord(raw);
  const contact = asRecord(item.contact);
  return {
    id: text(item.id, text(item.appointmentId, `appointment-${index}`)),
    title: text(item.title, text(item.summary, text(item.type, 'Appointment'))),
    contact: text(item.contactName, text(contact.name, text(item.name, 'Unassigned contact'))),
    start: text(item.start, text(item.startTime, text(item.start_time, new Date().toISOString()))),
    end: text(item.end, text(item.endTime, text(item.end_time))),
    status: text(item.status, 'scheduled'),
    type: text(item.type, text(item.appointmentType, 'Showing')),
    location: text(item.location, text(item.address, 'Location pending')),
    channel: text(item.channel, text(item.source, 'Iris')),
    notes: text(item.notes, text(item.description, 'No notes captured yet.'))
  };
}

function settingFrom(raw: unknown, index: number): CalendarSetting {
  const item = asRecord(raw);
  const status = text(item.status, 'ready');
  return {
    id: text(item.id, `setting-${index}`),
    label: text(item.label, text(item.name, 'Calendar setting')),
    value: text(item.value, text(item.current, 'Not configured')),
    detail: text(item.detail, text(item.description, '')),
    status: status === 'needs_setup' || status === 'mock' ? status : 'ready'
  };
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return data;
}

function calendarConnectHref(provider: 'google' | 'outlook'): string {
  if (typeof window === 'undefined') return `/api/calendar/connect/${provider}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/api/calendar/connect/${provider}?returnTo=${encodeURIComponent(current)}`;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time pending';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ─── Calendar grid helpers ──────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_SLOTS = Array.from({ length: 13 }, (_, i) => i + 8); // 8–20

function typeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('show')) return '#7C6AF5';       // purple
  if (t.includes('valuat') || t.includes('apprais')) return '#10b981'; // teal
  if (t.includes('follow') || t.includes('call')) return '#f59e0b';   // amber
  if (t.includes('consult') || t.includes('meet')) return '#3b82f6';  // blue
  return '#6b7280';
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function startOfWeek(d: Date): Date {
  const result = new Date(d);
  result.setDate(d.getDate() - d.getDay());
  result.setHours(0, 0, 0, 0);
  return result;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function weekRangeLabel(d: Date): string {
  const sun = startOfWeek(d);
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  return `${sun.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${sat.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function appointmentsForDay(appointments: CalendarAppointment[], day: Date): CalendarAppointment[] {
  return appointments.filter((a) => {
    const d = new Date(a.start);
    return !Number.isNaN(d.getTime()) && isSameDay(d, day);
  });
}

function appointmentsForHour(appointments: CalendarAppointment[], day: Date, hour: number): CalendarAppointment[] {
  return appointments.filter((a) => {
    const d = new Date(a.start);
    return !Number.isNaN(d.getTime()) && isSameDay(d, day) && d.getHours() === hour;
  });
}

interface CalendarGridProps {
  appointments: CalendarAppointment[];
  viewMode: CalendarViewMode;
  currentDate: Date;
}

function CalendarGrid({ appointments, viewMode, currentDate }: CalendarGridProps) {
  const { mode } = useColorMode();
  const isDark = mode === 'dark';

  const gridBorder = isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.07)';
  const todayBg = isDark ? 'rgba(124,106,245,0.15)' : 'rgba(124,106,245,0.07)';
  const headerBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const today = new Date();

  // ── Month view ──────────────────────────────────────────────────────────────
  if (viewMode === 'month') {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    // Pad to fill the first week row
    const startPad = firstDay.getDay();
    const totalCells = startPad + lastDay.getDate();
    const rows = Math.ceil(totalCells / 7);

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* Weekday headers */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: gridBorder }}>
          {WEEKDAYS.map((wd) => (
            <Box key={wd} sx={{ p: 0.5, textAlign: 'center', background: headerBg, borderRight: gridBorder }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.05em' }}>
                {wd}
              </Typography>
            </Box>
          ))}
        </Box>
        {/* Day cells */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: `repeat(${rows}, 1fr)`, flex: 1, minHeight: 0 }}>
          {Array.from({ length: rows * 7 }, (_, idx) => {
            const dayNum = idx - startPad + 1;
            const isValid = dayNum >= 1 && dayNum <= lastDay.getDate();
            const cellDate = isValid ? new Date(year, month, dayNum) : null;
            const isToday = cellDate ? isSameDay(cellDate, today) : false;
            const dayAppts = cellDate ? appointmentsForDay(appointments, cellDate) : [];

            return (
              <Box
                key={idx}
                sx={{
                  borderRight: gridBorder,
                  borderBottom: gridBorder,
                  p: 0.5,
                  background: isToday ? todayBg : 'transparent',
                  minHeight: 80,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.25,
                }}
              >
                {isValid && (
                  <>
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: isToday ? 700 : 400,
                        color: isToday ? 'primary.main' : 'text.secondary',
                        lineHeight: 1.4,
                        alignSelf: 'flex-start',
                        px: 0.5,
                      }}
                    >
                      {dayNum}
                    </Typography>
                    {dayAppts.slice(0, 3).map((a) => (
                      <Tooltip key={a.id} title={`${a.title} — ${a.contact}`} placement="top" arrow>
                        <Box
                          sx={{
                            px: 0.75,
                            py: 0.2,
                            borderRadius: '3px',
                            background: typeColor(a.type),
                            overflow: 'hidden',
                            cursor: 'default',
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ color: '#fff', fontWeight: 500, fontSize: '0.65rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
                          >
                            {timeLabel(a.start)} {a.title}
                          </Typography>
                        </Box>
                      </Tooltip>
                    ))}
                    {dayAppts.length > 3 && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', pl: 0.5 }}>
                        +{dayAppts.length - 3} more
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  }

  // ── Week view ───────────────────────────────────────────────────────────────
  if (viewMode === 'week') {
    const sun = startOfWeek(currentDate);
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sun);
      d.setDate(sun.getDate() + i);
      return d;
    });

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto' }}>
        {/* Header row: day labels */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)', position: 'sticky', top: 0, zIndex: 2, borderBottom: gridBorder, background: isDark ? 'var(--s-card, #1a1a2e)' : 'var(--s-card, #fff)' }}>
          <Box sx={{ borderRight: gridBorder, background: headerBg }} />
          {weekDays.map((d) => {
            const isToday = isSameDay(d, today);
            return (
              <Box key={d.toISOString()} sx={{ p: 0.75, textAlign: 'center', borderRight: gridBorder, background: isToday ? todayBg : headerBg }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', letterSpacing: '0.04em' }}>
                  {WEEKDAYS[d.getDay()]}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: isToday ? 700 : 400, color: isToday ? 'primary.main' : 'text.primary' }}>
                  {d.getDate()}
                </Typography>
              </Box>
            );
          })}
        </Box>
        {/* Time slots */}
        {HOUR_SLOTS.map((hour) => (
          <Box key={hour} sx={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)', borderBottom: gridBorder, minHeight: 52 }}>
            <Box sx={{ borderRight: gridBorder, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', pr: 0.75, pt: 0.5 }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
                {hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`}
              </Typography>
            </Box>
            {weekDays.map((d) => {
              const isToday = isSameDay(d, today);
              const slotAppts = appointmentsForHour(appointments, d, hour);
              return (
                <Box
                  key={d.toISOString()}
                  sx={{
                    borderRight: gridBorder,
                    p: 0.25,
                    background: isToday ? todayBg : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.25,
                  }}
                >
                  {slotAppts.map((a) => (
                    <Tooltip key={a.id} title={`${a.title} — ${a.contact}`} placement="top" arrow>
                      <Box
                        sx={{
                          px: 0.75,
                          py: 0.3,
                          borderRadius: '3px',
                          background: typeColor(a.type),
                          cursor: 'default',
                          overflow: 'hidden',
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ color: '#fff', fontWeight: 500, fontSize: '0.65rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
                        >
                          {a.title}
                        </Typography>
                      </Box>
                    </Tooltip>
                  ))}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    );
  }

  // ── Day view ────────────────────────────────────────────────────────────────
  const isToday = isSameDay(currentDate, today);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto' }}>
      {/* Day header */}
      <Box sx={{ p: 1, borderBottom: gridBorder, background: isToday ? todayBg : headerBg, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ color: isToday ? 'primary.main' : 'text.primary', fontWeight: 600 }}>
          {dayLabel(currentDate)}
        </Typography>
        {isToday && <Chip size="small" label="Today" color="primary" sx={{ height: 18, fontSize: '0.65rem' }} />}
      </Box>
      {HOUR_SLOTS.map((hour) => {
        const slotAppts = appointmentsForHour(appointments, currentDate, hour);
        return (
          <Box key={hour} sx={{ display: 'grid', gridTemplateColumns: '64px 1fr', borderBottom: gridBorder, minHeight: 56 }}>
            <Box sx={{ borderRight: gridBorder, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', pr: 1, pt: 0.75 }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
                {hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`}
              </Typography>
            </Box>
            <Box sx={{ p: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {slotAppts.map((a) => (
                <Box
                  key={a.id}
                  sx={{
                    px: 1.25,
                    py: 0.75,
                    borderRadius: '4px',
                    background: typeColor(a.type),
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.25,
                    cursor: 'default',
                  }}
                >
                  <Typography variant="body2" sx={{ color: '#fff', fontWeight: 600, fontSize: '0.8rem' }}>
                    {a.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.7rem' }}>
                    {a.contact} · {a.location}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Navigation label helper ─────────────────────────────────────────────────
function navLabel(mode: CalendarViewMode, date: Date): string {
  if (mode === 'month') return monthLabel(date);
  if (mode === 'week') return weekRangeLabel(date);
  return dayLabel(date);
}

function navigateDate(mode: CalendarViewMode, date: Date, direction: 1 | -1): Date {
  const next = new Date(date);
  if (mode === 'month') next.setMonth(date.getMonth() + direction);
  else if (mode === 'week') next.setDate(date.getDate() + direction * 7);
  else next.setDate(date.getDate() + direction);
  return next;
}

export function CalendarOsView() {
  const [tab, setTab] = useState<CalendarTab>('appointments');
  const [mode, setMode] = useState<CalendarViewMode>('week');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [settings, setSettings] = useState<CalendarSetting[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [busyAction, setBusyAction] = useState('');

  function handleModeChange(_: unknown, next: CalendarViewMode | null) {
    if (!next) return;
    setMode(next);
    setCurrentDate(new Date());
  }

  function handleNav(direction: 1 | -1) {
    setCurrentDate((d) => navigateDate(mode, d, direction));
  }

  function handleToday() {
    setCurrentDate(new Date());
  }

  const loadCalendar = useCallback(async () => {
    setState('loading');
    try {
      const [appointmentsResult, settingsResult] = await Promise.allSettled([
        readJson('/api/calendar/appointments'),
        readJson('/api/calendar/settings')
      ]);

      const nextAppointments = appointmentsResult.status === 'fulfilled'
        ? listFrom(appointmentsResult.value, ['appointments', 'events', 'items', 'results']).map(appointmentFrom)
        : [];
      const nextSettings = settingsResult.status === 'fulfilled'
        ? listFrom(settingsResult.value, ['settings', 'calendars', 'items', 'results']).map(settingFrom)
        : [];

      setAppointments(nextAppointments);
      setSettings(nextSettings);

      if (appointmentsResult.status === 'rejected' && settingsResult.status === 'rejected') {
        setState('disconnected');
        setMessage('Calendar APIs are not available. Connect or migrate calendar data to populate this workspace.');
        return;
      }
      if (!nextAppointments.length && !nextSettings.length) {
        setState('empty');
        setMessage('Calendar APIs responded, but no appointments or settings were returned.');
        return;
      }
      setState('ready');
      setMessage('');
    } catch {
      setState('disconnected');
      setMessage('Calendar APIs are not available. Connect or migrate calendar data to populate this workspace.');
    }
  }, []);

  useEffect(() => {
    void loadCalendar();
    const timer = window.setInterval(() => {
      void loadCalendar();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [loadCalendar]);

  async function syncCalendar() {
    setBusyAction('sync');
    setMessage('');
    try {
      const response = await fetch('/api/calendar/sync/full', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Calendar sync failed');
      await loadCalendar();
      setMessage(`Synced ${data.summary?.itemsWritten || 0} calendar events from ${data.summary?.connections || 0} connected account(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Calendar sync failed');
    } finally {
      setBusyAction('');
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const provider = url.searchParams.get('calendarConnected');
    if (!provider) return;
    setMessage(`Connected ${provider}. Syncing all calendars...`);
    url.searchParams.delete('calendarConnected');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    void syncCalendar();
  }, []);

  const displayAppointments = appointments;
  const displaySettings = settings.length ? settings : disconnectedSettings;

  const counts = useMemo(() => {
    const confirmed = displayAppointments.filter((item) => item.status.toLowerCase().includes('confirm')).length;
    const review = displayAppointments.filter((item) => item.status.toLowerCase().includes('review')).length;
    return { confirmed, review, total: displayAppointments.length };
  }, [displayAppointments]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6">Calendar</Typography>
          <Typography variant="body2" color="text.secondary">
            Showing appointments, handoffs, and calendar settings without direct provider calls.
          </Typography>
        </Box>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={handleModeChange}
          aria-label="Calendar view">
          <ToggleButton value="day">Day</ToggleButton>
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant="outlined"
            startIcon={<SyncIcon />}
            disabled={Boolean(busyAction)}
            onClick={() => void syncCalendar()}>
            Sync calendar
          </Button>
          <Button size="small" variant="outlined" onClick={() => { window.location.href = calendarConnectHref('google'); }}>
            Connect Google
          </Button>
          <Button size="small" variant="outlined" onClick={() => { window.location.href = calendarConnectHref('outlook'); }}>
            Connect Outlook
          </Button>
        </Stack>
      </Stack>

      {state === 'loading' ? (
        <Card sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Loading calendar workspace...</Typography>
        </Card>
      ) : null}

      {state !== 'loading' && message ? (
        <Alert severity={state === 'empty' ? 'info' : 'warning'} icon={state === 'empty' ? <CalendarMonthIcon /> : <LinkOffIcon />}>
          {message}
        </Alert>
      ) : null}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '260px 1fr' }, gap: 2, flex: 1, minHeight: 0 }}>
        <Stack spacing={2}>
          <Card sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <CalendarMonthIcon color="primary" fontSize="small" />
                <Typography variant="subtitle2">Schedule health</Typography>
              </Stack>
              <Stack direction="row" spacing={1}>
                <Chip size="small" color="success" variant="outlined" label={`${counts.confirmed} confirmed`} />
                <Chip size="small" color={counts.review ? 'warning' : 'default'} variant="outlined" label={`${counts.review} review`} />
              </Stack>
              <Divider />
              <Stack spacing={1}>
                {displaySettings.slice(0, 3).map((setting) => (
                  <Box key={setting.id}>
                    <Typography variant="caption" color="text.secondary">{setting.label}</Typography>
                    <Typography variant="body2">{setting.value}</Typography>
                  </Box>
                ))}
              </Stack>
            </Stack>
          </Card>

          <Card sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Routing lanes</Typography>
            <Stack spacing={1}>
              {['Showings', 'Valuations', 'Follow-ups'].map((lane) => (
                <Stack key={lane} direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="body2">{lane}</Typography>
                  <Chip size="small" variant="outlined" label="visible" />
                </Stack>
              ))}
            </Stack>
          </Card>
        </Stack>

        <Card sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: { xs: 560, lg: 0 }, overflow: 'hidden' }}>
          <Box sx={{ px: 1.75, pt: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Tabs value={tab} onChange={(_, next: CalendarTab) => setTab(next)} aria-label="Calendar tabs">
              <Tab value="appointments" icon={<EventIcon fontSize="small" />} iconPosition="start" label="Appointments" />
              <Tab value="settings" icon={<SettingsIcon fontSize="small" />} iconPosition="start" label="Settings" />
            </Tabs>
          </Box>

          {tab === 'appointments' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {/* Calendar nav bar */}
              <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                <IconButton size="small" onClick={() => handleNav(-1)} aria-label="Previous">
                  <ArrowBackIosNewIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton size="small" onClick={() => handleNav(1)} aria-label="Next">
                  <ArrowForwardIosIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                  {navLabel(mode, currentDate)}
                </Typography>
                <Button size="small" variant="text" onClick={handleToday} sx={{ minWidth: 0, px: 1, fontSize: '0.75rem' }}>
                  Today
                </Button>
              </Stack>
              {/* Grid */}
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <CalendarGrid appointments={displayAppointments} viewMode={mode} currentDate={currentDate} />
              </Box>
            </Box>
          ) : (
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
              <Stack spacing={1.25}>
                {displaySettings.map((setting) => (
                  <Card key={setting.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" spacing={1.25} alignItems="flex-start">
                      {setting.status === 'ready' ? <CheckCircleIcon color="success" /> : <TuneIcon color="warning" />}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="subtitle2">{setting.label}</Typography>
                          <Chip
                            size="small"
                            color={setting.status === 'ready' ? 'success' : setting.status === 'mock' ? 'info' : 'warning'}
                            variant="outlined"
                            label={setting.status.replace('_', ' ')}
                          />
                        </Stack>
                        <Typography variant="body2">{setting.value}</Typography>
                        <Typography variant="caption" color="text.secondary">{setting.detail}</Typography>
                      </Box>
                    </Stack>
                  </Card>
                ))}
                <Button variant="outlined" size="small" startIcon={<SettingsIcon />} sx={{ alignSelf: 'flex-start' }}>
                  Provider settings placeholder
                </Button>
              </Stack>
            </Box>
          )}
        </Card>
      </Box>
    </Box>
  );
}
