"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  InputAdornment,
  ListItemButton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircleOutlined';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmailOutlined';
import HomeIcon from '@mui/icons-material/HomeOutlined';
import LinkOffIcon from '@mui/icons-material/LinkOffOutlined';
import LocalOfferIcon from '@mui/icons-material/LocalOfferOutlined';
import PhoneIcon from '@mui/icons-material/PhoneOutlined';
import SearchIcon from '@mui/icons-material/Search';
import StarIcon from '@mui/icons-material/StarOutline';
import SyncIcon from '@mui/icons-material/SyncOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFileOutlined';
import WorkspacesIcon from '@mui/icons-material/WorkspacesOutlined';

type ContactTab = 'directory' | 'profile';
type LoadState = 'loading' | 'ready' | 'empty' | 'mock';

type ContactRecord = {
  id: string;
  name: string;
  role: string;
  status: string;
  email: string;
  phone: string;
  source: string;
  tags: string[];
  address: string;
  budget: string;
  lastTouch: string;
  nextStep: string;
  notes: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
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

function contactFrom(raw: unknown, index: number): ContactRecord {
  const item = asRecord(raw);
  const custom = asRecord(item.customFields);
  return {
    id: text(item.id, text(item.contactId, `contact-${index}`)),
    name: text(item.name, text(item.fullName, text(item.full_name, 'Unnamed contact'))),
    role: text(item.role, text(item.segment, text(item.type, 'Lead'))),
    status: text(item.status, text(custom.status, 'active')),
    email: text(item.email, text(custom.email, '')),
    phone: text(item.phone, text(item.phoneNumber, text(custom.phone, ''))),
    source: text(item.source, text(item.channel, 'CRM')),
    tags: textList(item.tags).length ? textList(item.tags) : textList(item.segments),
    address: text(item.address, text(item.propertyAddress, text(custom.address, 'Address pending'))),
    budget: text(item.budget, text(item.priceRange, text(custom.budget, 'Budget pending'))),
    lastTouch: text(item.lastTouch, text(item.last_touch, text(item.updatedAt, 'No recent touch'))),
    nextStep: text(item.nextStep, text(item.next_step, 'Review contact')),
    notes: text(item.notes, text(item.summary, text(item.description, 'No profile notes yet.')))
  };
}

async function loadContacts(): Promise<ContactRecord[]> {
  const response = await fetch('/api/contacts', { cache: 'no-store' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return listFrom(data, ['contacts', 'items', 'results', 'leads']).map(contactFrom);
}

function contactsConnectHref(provider: 'google' | 'outlook'): string {
  if (typeof window === 'undefined') return `/api/contacts/connect/${provider}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/api/contacts/connect/${provider}?returnTo=${encodeURIComponent(current)}`;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'C') + (parts[1]?.[0] || '');
}

function statusColor(status: string): 'default' | 'success' | 'warning' | 'info' {
  const normalized = status.toLowerCase();
  if (normalized.includes('ready') || normalized.includes('hot')) return 'success';
  if (normalized.includes('review') || normalized.includes('nurture')) return 'warning';
  if (normalized.includes('valuation') || normalized.includes('active')) return 'info';
  return 'default';
}

export function ContactsOsView() {
  const [tab, setTab] = useState<ContactTab>('directory');
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reloadContacts = useCallback(async () => {
    setState('loading');
    try {
      const nextContacts = await loadContacts();
      setContacts(nextContacts);
      setSelectedId((current) => current && nextContacts.some((contact) => contact.id === current) ? current : nextContacts[0]?.id || '');
      if (!nextContacts.length) {
        setState('empty');
        setMessage('Contacts API responded, but no contacts were returned.');
        return;
      }
      setState('ready');
      setMessage('');
    } catch {
      setContacts([]);
      setSelectedId('');
      setState('mock');
      setMessage('Contacts API is not available. Connect or import contacts to populate this workspace.');
    }
  }, []);

  useEffect(() => {
    void reloadContacts();
  }, [reloadContacts]);

  async function importCsv(file: File) {
    setBusyAction('import');
    setMessage('');
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('dryRun', 'false');
      const response = await fetch('/api/contacts/import', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Contact import failed');
      await reloadContacts();
      const summary = data.summary || {};
      setMessage(`Imported ${summary.importedContacts || 0} contacts from ${file.name}. ${summary.duplicateRows || 0} duplicates skipped.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Contact import failed');
      setState('mock');
    } finally {
      setBusyAction('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function syncContacts() {
    setBusyAction('sync');
    setMessage('');
    try {
      const response = await fetch('/api/contacts/sync/full', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Contact sync failed');
      await reloadContacts();
      setMessage(`Synced ${data.summary?.itemsWritten || 0} contacts from ${data.summary?.connections || 0} connected account(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Contact sync failed');
    } finally {
      setBusyAction('');
    }
  }

  const displayContacts = contacts;
  const filteredContacts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return displayContacts;
    return displayContacts.filter((contact) =>
      [
        contact.name,
        contact.role,
        contact.status,
        contact.email,
        contact.phone,
        contact.source,
        contact.address,
        contact.budget,
        contact.tags.join(' ')
      ].join(' ').toLowerCase().includes(normalized)
    );
  }, [displayContacts, query]);

  const selected = displayContacts.find((contact) => contact.id === selectedId) || filteredContacts[0] || displayContacts[0];
  const tags = selected?.tags.length ? selected.tags : ['untagged'];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6">Contacts</Typography>
          <Typography variant="body2" color="text.secondary">
            Directory and contact profile cards for lead operations.
          </Typography>
        </Box>
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contacts..."
          sx={{ width: { xs: '100%', md: 320 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
          aria-label="Search contacts"
        />
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importCsv(file);
          }}
        />
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant="outlined"
            startIcon={<UploadFileIcon />}
            disabled={Boolean(busyAction)}
            onClick={() => fileInputRef.current?.click()}>
            Import CSV
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<SyncIcon />}
            disabled={Boolean(busyAction)}
            onClick={() => void syncContacts()}>
            Sync contacts
          </Button>
          <Button size="small" variant="outlined" onClick={() => { window.location.href = contactsConnectHref('google'); }}>
            Connect Google
          </Button>
          <Button size="small" variant="outlined" onClick={() => { window.location.href = contactsConnectHref('outlook'); }}>
            Connect Outlook
          </Button>
        </Stack>
      </Stack>

      {state === 'loading' ? (
        <Card sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Loading contacts workspace...</Typography>
        </Card>
      ) : null}

      {state !== 'loading' && message ? (
        <Alert severity={state === 'mock' ? 'warning' : 'info'} icon={state === 'mock' ? <LinkOffIcon /> : <AccountCircleIcon />}>
          {message}
        </Alert>
      ) : null}

      <Card sx={{ flex: 1, minHeight: { xs: 640, lg: 0 }, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ px: 1.75, pt: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tabs value={tab} onChange={(_, next: ContactTab) => setTab(next)} aria-label="Contacts tabs">
            <Tab value="directory" icon={<WorkspacesIcon fontSize="small" />} iconPosition="start" label="Directory" />
            <Tab value="profile" icon={<AccountCircleIcon fontSize="small" />} iconPosition="start" label="Profile cards" />
          </Tabs>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '340px 1fr' }, flex: 1, minHeight: 0 }}>
          <Box sx={{ borderRight: { lg: '1px solid' }, borderColor: 'divider', minHeight: 0, overflow: 'auto' }}>
            <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2">Directory</Typography>
                <Chip size="small" variant="outlined" label={`${filteredContacts.length} shown`} />
              </Stack>
            </Box>
            <Stack spacing={0.75} sx={{ p: 1 }}>
              {filteredContacts.map((contact) => (
                <ListItemButton
                  key={contact.id}
                  selected={selected?.id === contact.id}
                  onClick={() => {
                    setSelectedId(contact.id);
                    setTab('profile');
                  }}
                  sx={{ borderRadius: 2, alignItems: 'flex-start', gap: 1.25 }}>
                  <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 13 }}>
                    {initials(contact.name)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle2" noWrap>{contact.name}</Typography>
                      <Chip size="small" color={statusColor(contact.status)} variant="outlined" label={contact.status} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {contact.role} - {contact.source} - {contact.lastTouch}
                    </Typography>
                  </Box>
                </ListItemButton>
              ))}
              {!filteredContacts.length ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">No contacts match the current search.</Typography>
                </Box>
              ) : null}
            </Stack>
          </Box>

          <Box sx={{ minHeight: 0, overflow: 'auto', p: 2 }}>
            {selected ? (
              tab === 'directory' ? (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                    gap: 1.5
                  }}>
                  {filteredContacts.map((contact) => (
                    <Card key={contact.id} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction="row" spacing={1.25} alignItems="flex-start">
                        <Avatar sx={{ bgcolor: 'primary.main' }}>{initials(contact.name)}</Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="subtitle2">{contact.name}</Typography>
                            <Chip size="small" color={statusColor(contact.status)} variant="outlined" label={contact.status} />
                          </Stack>
                          <Typography variant="caption" color="text.secondary">{contact.role}</Typography>
                          <Divider sx={{ my: 1 }} />
                          <Stack spacing={0.75}>
                            <Stack direction="row" spacing={0.75} alignItems="center">
                              <PhoneIcon fontSize="small" color="primary" />
                              <Typography variant="body2" noWrap>{contact.phone || 'No phone'}</Typography>
                            </Stack>
                            <Stack direction="row" spacing={0.75} alignItems="center">
                              <AlternateEmailIcon fontSize="small" color="primary" />
                              <Typography variant="body2" noWrap>{contact.email || 'No email'}</Typography>
                            </Stack>
                            <Stack direction="row" spacing={0.75} alignItems="center">
                              <HomeIcon fontSize="small" color="primary" />
                              <Typography variant="body2" noWrap>{contact.address}</Typography>
                            </Stack>
                          </Stack>
                        </Box>
                      </Stack>
                    </Card>
                  ))}
                </Box>
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 280px' }, gap: 2 }}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                      <Avatar sx={{ width: 58, height: 58, bgcolor: 'primary.main', fontSize: 20 }}>
                        {initials(selected.name)}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="h6">{selected.name}</Typography>
                          <Chip size="small" color={statusColor(selected.status)} variant="outlined" label={selected.status} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{selected.role} from {selected.source}</Typography>
                      </Box>
                    </Stack>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                      <ProfileMetric icon={<PhoneIcon fontSize="small" />} label="Phone" value={selected.phone || 'Not provided'} />
                      <ProfileMetric icon={<AlternateEmailIcon fontSize="small" />} label="Email" value={selected.email || 'Not provided'} />
                      <ProfileMetric icon={<HomeIcon fontSize="small" />} label="Area or property" value={selected.address} />
                      <ProfileMetric icon={<StarIcon fontSize="small" />} label="Budget / timeline" value={selected.budget} />
                    </Box>

                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Profile notes</Typography>
                    <Typography variant="body2" color="text.secondary">{selected.notes}</Typography>
                  </Card>

                  <Stack spacing={1.5}>
                    <Card variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>Next action</Typography>
                      <Typography variant="body2">{selected.nextStep}</Typography>
                      <Typography variant="caption" color="text.secondary">Last touch: {selected.lastTouch}</Typography>
                    </Card>
                    <Card variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>Tags</Typography>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        {tags.map((tag) => (
                          <Chip key={tag} size="small" icon={<LocalOfferIcon />} label={tag} variant="outlined" />
                        ))}
                      </Stack>
                    </Card>
                  </Stack>
                </Box>
              )
            ) : (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">No contact selected.</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Card>
    </Box>
  );
}

function ProfileMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card variant="outlined" sx={{ p: 1.25 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="body2" noWrap>{value}</Typography>
        </Box>
      </Stack>
    </Card>
  );
}
