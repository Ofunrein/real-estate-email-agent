"use client";
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  ListItemButton,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import EventIcon from '@mui/icons-material/EventOutlined';
import GroupIcon from '@mui/icons-material/GroupsOutlined';
import LinkOffIcon from '@mui/icons-material/LinkOffOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import VideocamIcon from '@mui/icons-material/VideocamOutlined';

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

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time pending';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date pending';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function appointmentTone(status: string): 'default' | 'success' | 'warning' | 'info' {
  const normalized = status.toLowerCase();
  if (normalized.includes('confirm') || normalized.includes('book')) return 'success';
  if (normalized.includes('review') || normalized.includes('tentative')) return 'warning';
  if (normalized.includes('cancel')) return 'default';
  return 'info';
}

export function CalendarOsView() {
  const [tab, setTab] = useState<CalendarTab>('appointments');
  const [mode, setMode] = useState<CalendarViewMode>('week');
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [settings, setSettings] = useState<CalendarSetting[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadCalendar() {
      setState('loading');
      try {
        const [appointmentsResult, settingsResult] = await Promise.allSettled([
          readJson('/api/calendar/appointments'),
          readJson('/api/calendar/settings')
        ]);
        if (cancelled) return;

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
        if (cancelled) return;
        setState('disconnected');
        setMessage('Calendar APIs are not available. Connect or migrate calendar data to populate this workspace.');
      }
    }

    void loadCalendar();
    return () => {
      cancelled = true;
    };
  }, []);

  const displayAppointments = appointments;
  const displaySettings = settings.length ? settings : disconnectedSettings;
  const visibleAppointments = useMemo(() => {
    if (mode === 'day') return displayAppointments.slice(0, 3);
    if (mode === 'month') return displayAppointments;
    return displayAppointments.slice(0, 7);
  }, [displayAppointments, mode]);

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
          onChange={(_, next: CalendarViewMode | null) => next && setMode(next)}
          aria-label="Calendar view">
          <ToggleButton value="day">Day</ToggleButton>
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
        </ToggleButtonGroup>
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
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: mode === 'month' ? { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } : '1fr',
                  gap: 1.25
                }}>
                {visibleAppointments.map((appointment) => (
                  <ListItemButton
                    key={appointment.id}
                    sx={{
                      alignItems: 'stretch',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      p: 0,
                      overflow: 'hidden'
                    }}>
                    <Box
                      sx={{
                        width: 6,
                        bgcolor: (theme) => appointmentTone(appointment.status) === 'success'
                          ? theme.palette.success.main
                          : appointmentTone(appointment.status) === 'warning'
                            ? theme.palette.warning.main
                            : theme.palette.info.main
                      }}
                    />
                    <Box sx={{ flex: 1, p: 1.5, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2">{appointment.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {dateLabel(appointment.start)} - {timeLabel(appointment.start)}
                            {appointment.end ? ` to ${timeLabel(appointment.end)}` : ''}
                          </Typography>
                        </Box>
                        <Chip size="small" color={appointmentTone(appointment.status)} variant="outlined" label={appointment.status} />
                      </Stack>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                        <Chip size="small" icon={<GroupIcon />} label={appointment.contact} />
                        <Chip size="small" variant="outlined" icon={<VideocamIcon />} label={appointment.location} />
                        <Chip size="small" variant="outlined" label={appointment.channel} />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {appointment.notes}
                      </Typography>
                    </Box>
                  </ListItemButton>
                ))}
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
