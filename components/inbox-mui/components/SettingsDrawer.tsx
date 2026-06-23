"use client";
import React, { useEffect, useState } from 'react';
import {
  Drawer,
  Box,
  Stack,
  Typography,
  Button,
  Checkbox,
  FormControlLabel,
  Card,
  Avatar,
  Chip,
  Divider,
  Tooltip,
  Alert } from
'@mui/material';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import { signOut } from 'next-auth/react';
import { type LeadCategoryId } from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { useCategoryColors } from '../theme/CategoryColorContext';
import type { InboxSettings } from '@/lib/inboxSettings';
import {
  type ConnectionStatus,
  displayForChannelConnection,
  useChannelConnectionStatus
} from '../hooks/useChannelConnectionStatus';
interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}
const autoSendChannels = [
  ['email', 'Email'],
  ['sms', 'SMS'],
  ['whatsapp', 'WhatsApp'],
  ['messenger', 'Messenger'],
  ['instagram', 'Instagram'],
  ['website_chat', 'Website chat'],
] as
const;
const channelAvailability = [
  ['email', 'Email'],
  ['messenger', 'Messenger'],
  ['instagram', 'Instagram DMs'],
] as const;
const composioConnections = [
  ['instagram', 'Instagram DMs'],
  ['facebook', 'Messenger'],
  ['whatsapp', 'WhatsApp'],
] as const;

function ToggleGrid({
  items,
  values,
  onChange,
  suffix
}: {
  items: readonly (readonly [keyof InboxSettings['auto_send'], string])[];
  values: Record<string, boolean>;
  onChange: (key: keyof InboxSettings['auto_send'], checked: boolean) => void;
  suffix: string;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 112px), 1fr))',
        gap: {
          xs: 0.75,
          sm: 1
        }
      }}>
      {items.map(([key, label]) =>
      <Box
        key={key}
        component="label"
        sx={{
          minWidth: 0,
          p: {
            xs: 0.75,
            sm: 1
          },
          border: '1px solid',
          borderColor: values[key] ? 'primary.main' : 'divider',
          borderRadius: 1.25,
          bgcolor: values[key] ? 'action.selected' : 'background.paper',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: {
            xs: 0.25,
            sm: 0.5
          },
          cursor: 'pointer'
        }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 800,
              lineHeight: 1.1,
              fontSize: { xs: 11.5, sm: 13 }
            }}
            noWrap>
            {label}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              lineHeight: 1.12,
              fontSize: { xs: 10.5, sm: 11 }
            }}>
            {suffix}
          </Typography>
        </Box>
        <Checkbox
          size="small"
          checked={values[key]}
          onChange={(e) => onChange(key, e.target.checked)}
          sx={{ p: 0, '& .MuiSvgIcon-root': { fontSize: { xs: 17, sm: 19 } } }} />
      </Box>
      )}
    </Box>
  );
}

function ComposioConnectionGrid({
  status,
  disconnectingId,
  onDisconnect
}: {
  status: ConnectionStatus | null;
  disconnectingId: string;
  onDisconnect: (id: string) => void;
}) {
  const channelForSlug = (slug: string) => slug === 'facebook' ? 'messenger' : slug;
  const missingSetup = (connection?: NonNullable<ConnectionStatus['connections']>[number]) => {
    const missing = connection?.metadata?.outbound_missing;
    return Array.isArray(missing) ? missing.map(String).filter(Boolean) : [];
  };
  const newest = (connections: NonNullable<ConnectionStatus['connections']>) =>
    [...connections].sort((a, b) =>
      new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
    );
  const composioRows = (connections: NonNullable<ConnectionStatus['connections']>) =>
    connections.filter((connection) => connection.provider.startsWith('composio_'));
  const accountLabel = (connection?: NonNullable<ConnectionStatus['connections']>[number]) =>
    [
      connection?.selected_asset_name,
      typeof connection?.metadata?.display_name === 'string' ? connection.metadata.display_name : '',
    ].map((value) => String(value || '').trim()).find(Boolean) || '';
  const connectionForSlug = (slug: string) => {
    const channel = channelForSlug(slug);
    const channelStatus = status?.channels?.[channel];
    const display = displayForChannelConnection(
      status,
      channel as Parameters<typeof displayForChannelConnection>[1],
      '',
      ''
    );
    if (display.connection) return display.connection;
    const direct = newest(composioRows(channelStatus?.connections || []))[0];
    if (direct) return direct;
    return newest(composioRows(status?.connections?.filter((connection) => connection.channel === channel) || []))[0];
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 178px), 1fr))',
        gap: { xs: 0.75, sm: 1 }
      }}>
      {composioConnections.map(([slug, label]) => (
        (() => {
          const connection = connectionForSlug(slug);
          const connected = connection?.status === 'connected' && Boolean(connection.selected_asset_name || connection.selected_asset_id || connection.connected_account_id);
          const authConfigured = Boolean(connection?.metadata?.composio_auth_configured);
          const display = displayForChannelConnection(
            status,
            channelForSlug(slug) as Parameters<typeof displayForChannelConnection>[1],
            '',
            ''
          );
          const missing = missingSetup(connection);
          const ready = connected && display.ready;
          const pill = ready ? 'Ready' : connected ? 'Setup needed' : authConfigured ? 'Connect' : 'Setup needed';
          const tone = ready ? 'success' : connected ? 'warning' : authConfigured ? 'info' : 'warning';
          const labelText = accountLabel(connection);
          const detail = connected ? labelText || 'Connected account' : authConfigured ? 'Choose account' : 'Needs setup';
          const actionLabel = connected ? 'Change' : 'Connect';
          const connectUrl = `/api/settings/composio/connect/${slug}`;
          return (
        <Box
          key={slug}
          component="div"
          role={!ready ? 'button' : undefined}
          tabIndex={!ready ? 0 : undefined}
          onClick={(event) => {
            if (ready) return;
            const target = event.target as HTMLElement;
            if (target.closest('button,a')) return;
            window.open(connectUrl, '_blank');
          }}
          onKeyDown={(event) => {
            if (ready || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            window.open(connectUrl, '_blank');
          }}
          sx={{
            minWidth: 0,
            p: { xs: 1, sm: 1.15 },
            border: '1px solid',
            borderColor: ready ? 'success.light' : 'divider',
            borderRadius: 1.25,
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.85,
            color: 'inherit',
            textDecoration: 'none',
            boxShadow: ready ? 'inset 0 0 0 1px rgba(16, 185, 129, 0.28)' : 'none',
            cursor: ready ? 'default' : 'pointer',
            '&:hover': {
              borderColor: ready ? 'success.main' : 'primary.main',
              bgcolor: 'action.hover'
            }
          }}>
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
          {display.avatarUrl && (
            <Avatar
              src={display.avatarUrl}
              alt={display.value}
              sx={{
                width: 30,
                height: 30,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                flexShrink: 0
              }}
            />
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: { xs: 13, sm: 14 }, fontWeight: 850, lineHeight: 1.15, minWidth: 0 }}>
                {label}
              </Typography>
              <Chip
                size="small"
                label={pill}
                color={tone}
                variant={connected ? 'filled' : 'outlined'}
                sx={{ height: 20, flexShrink: 0, '& .MuiChip-label': { px: 0.75, fontSize: 10, fontWeight: 800 } }}
              />
            </Stack>
            <Typography variant="caption" color={connected ? 'text.primary' : 'text.secondary'} sx={{ display: 'block', lineHeight: 1.25, mt: 0.5, fontWeight: connected ? 700 : 500 }} noWrap>
              {detail}
            </Typography>
            {connected && display.subtitle && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, mt: 0.25 }} noWrap>
                {display.subtitle}
              </Typography>
            )}
            {connected && missing.length > 0 && (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', lineHeight: 1.2, mt: 0.25 }} noWrap>
                Finish send setup
              </Typography>
            )}
          </Box>
          </Stack>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Button
              href={connectUrl}
              variant={connected ? 'outlined' : 'contained'}
              size="small"
              sx={{ alignSelf: 'flex-start', fontSize: 11, minHeight: 28, px: 1.1 }}>
              {actionLabel}
            </Button>
            {connection?.id && !String(connection.id).startsWith('env_') &&
            <Button
              variant="text"
              color="error"
              size="small"
              disabled={disconnectingId === connection.id}
              onClick={() => onDisconnect(connection.id)}
              sx={{ alignSelf: 'flex-start', fontSize: 11, minHeight: 28, px: 1.1 }}>
              {disconnectingId === connection.id ? 'Removing...' : connected ? 'Disconnect' : 'Reset'}
            </Button>
            }
          </Stack>
        </Box>
          );
        })()
      ))}
    </Box>
  );
}
export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { leadCategories, inboxSettings } = useInboxModel();
  const { colors, setColor } = useCategoryColors();
  const [draftFirst, setDraftFirst] = useState(inboxSettings.draft_first);
  const [autoSend, setAutoSend] = useState<InboxSettings['auto_send']>(() =>
  ({ ...inboxSettings.auto_send })
  );
  const [channelsEnabled, setChannelsEnabled] = useState<InboxSettings['channels_enabled']>(() =>
  ({ ...inboxSettings.channels_enabled })
  );
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [disconnectingId, setDisconnectingId] = useState('');
  const [disconnectError, setDisconnectError] = useState('');
  const {
    status: connectionStatus,
    error: connectionError,
    refresh: refreshConnections,
  } = useChannelConnectionStatus(open);
  const [categoriesOn, setCategoriesOn] = useState<
    Record<LeadCategoryId, boolean>>(

    () =>
    Object.fromEntries(leadCategories.map((c) => [c.id, true])) as Record<
      LeadCategoryId,
      boolean>

  );
  useEffect(() => {
    if (!open) return;
    setDraftFirst(inboxSettings.draft_first);
    setAutoSend({ ...inboxSettings.auto_send });
    setChannelsEnabled({ ...inboxSettings.channels_enabled });
    setCategoriesOn(
      Object.fromEntries(leadCategories.map((c) => [c.id, c.enabled !== false])) as Record<
        LeadCategoryId,
        boolean
      >
    );
    setSaveStatus('idle');
  }, [inboxSettings, leadCategories, open]);

  const disconnectConnection = async (id: string) => {
    setDisconnectingId(id);
    setDisconnectError('');
    try {
      const res = await fetch(`/api/settings/channel-connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not disconnect account.');
      await refreshConnections();
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : 'Could not disconnect account.');
    } finally {
      setDisconnectingId('');
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/settings/inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            draft_first: draftFirst,
            auto_send: autoSend,
            channels_enabled: channelsEnabled,
          },
          categories: leadCategories.map((cat, index) => ({
            slug: cat.slug || cat.id.replace(/-/g, '_'),
            name: cat.label,
            color: colors[cat.id],
            sort_order: (index + 1) * 10,
            enabled: categoriesOn[cat.id],
            gmail_label_name: cat.gmailLabelName || `Iris/${cat.label}`,
          })),
        }),
      });
      if (!res.ok) throw new Error(`settings save failed (${res.status})`);
      setSaveStatus('saved');
      onClose();
    } catch (error) {
      console.error(error);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: {
            xs: '100%',
            sm: 460
          },
          maxWidth: '100vw',
          height: '100dvh',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          p: 0
        }
      }}>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: {
            xs: 1.25,
            sm: 3
          },
          pt: {
            xs: 1.5,
            sm: 3
          },
          pb: 2
        }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{
          mb: {
            xs: 1.5,
            sm: 2.5
          },
          gap: 1
        }}>
        
        <Box>
          <Typography variant="overline" color="text.secondary">
            Agent Inbox
          </Typography>
          <Typography variant="h5" sx={{ fontSize: { xs: 22, sm: 24 } }}>Settings</Typography>
        </Box>
        <Button onClick={onClose} variant="outlined" size="small" sx={{ flexShrink: 0, minWidth: 0 }}>
          Close
        </Button>
      </Stack>

      <Card
        variant="outlined"
        sx={{
          p: {
            xs: 1.25,
            sm: 2
          },
          mb: {
            xs: 1.5,
            sm: 2
          }
        }}>
        
        <FormControlLabel
          control={
          <Checkbox
            checked={draftFirst}
            onChange={(e) => setDraftFirst(e.target.checked)} />

          }
          label="Draft first by default"
          sx={{
            mb: 1,
            mr: 0,
            '& .MuiFormControlLabel-label': {
              fontSize: { xs: 13, sm: 14 },
              lineHeight: 1.2
            }
          }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          When this is on, Iris saves replies to the human review queue instead of sending automatically.
        </Typography>
        
        <Divider
          sx={{
            mb: 1.5
          }} />
        
        <ToggleGrid
          items={autoSendChannels}
          values={autoSend}
          suffix="Auto-send"
          onChange={(key, checked) =>
          setAutoSend((prev) => ({
            ...prev,
            [key]: checked
          }))
          } />
      </Card>

      <Card
        variant="outlined"
        sx={{
          p: {
            xs: 1.25,
            sm: 2
          },
          mb: {
            xs: 1.5,
            sm: 2
          }
        }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{
            display: 'block',
            mb: 0.75
          }}>
          Connections
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
          Social inboxes Iris can operate.
        </Typography>
        {(connectionError || disconnectError) && <Alert severity="warning" sx={{ mb: 1 }}>{connectionError || disconnectError}</Alert>}
        <ComposioConnectionGrid
          status={connectionStatus}
          disconnectingId={disconnectingId}
          onDisconnect={disconnectConnection}
        />
      </Card>

      <Card
        variant="outlined"
        sx={{
          p: {
            xs: 1.25,
            sm: 2
          },
          mb: {
            xs: 1.5,
            sm: 2
          }
        }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{
            display: 'block',
            mb: 1
          }}>
          
          Channel availability
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Turn off AI handling for channels that need a human-led inbox.
        </Typography>
        <ToggleGrid
          items={channelAvailability}
          values={channelsEnabled}
          suffix="Available"
          onChange={(key, checked) =>
          setChannelsEnabled((prev) => ({
            ...prev,
            [key]: checked
          }))
          } />
      </Card>

      <Card
        variant="outlined"
        sx={{
          p: {
            xs: 1.25,
            sm: 2
          }
        }}>
        
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{
            display: 'block',
            mb: 1.5
          }}>
          
          Categories
        </Typography>
        <Stack spacing={1.25}>
          {leadCategories.map((cat) =>
          <Box
            key={cat.id}
            sx={{
              minWidth: 0,
              display: 'grid',
              gridTemplateColumns: {
                xs: '28px minmax(0, 1fr) 28px',
                sm: '34px minmax(0, 1fr) 44px'
              },
              alignItems: 'center',
              gap: {
                xs: 0.75,
                sm: 1
              }
            }}>
            
              <Tooltip title="Change category color">
                <Box
                component="label"
                sx={{
                  width: { xs: 28, sm: 34 },
                  height: { xs: 28, sm: 34 },
                  borderRadius: 1.25,
                  bgcolor: colors[cat.id],
                  flexShrink: 0,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: 'divider',
                  display: 'block',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                
                  <Box
                  component="input"
                  type="color"
                  value={colors[cat.id]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setColor(cat.id, e.target.value)
                  }
                  aria-label={`${cat.label} color`}
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0,
                    width: '100%',
                    height: '100%',
                    cursor: 'pointer',
                    border: 'none',
                    p: 0
                  }} />
                
                </Box>
              </Tooltip>
              <Box
              sx={{
                flex: 1,
                minWidth: 0,
                px: { xs: 1, sm: 1.5 },
                py: { xs: 0.75, sm: 1 },
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: 'divider'
              }}>

                <Typography variant="body2" noWrap sx={{ fontSize: { xs: 12, sm: 13 } }}>{cat.label}</Typography>
              </Box>
              <Checkbox
                aria-label={`${cat.label} category enabled`}
                size="small"
                checked={categoriesOn[cat.id]}
                onChange={(e) =>
                setCategoriesOn((prev) => ({
                  ...prev,
                  [cat.id]: e.target.checked
                }))
                } />

            </Box>
          )}
        </Stack>
      </Card>

      <Card
        variant="outlined"
        sx={{
          p: {
            xs: 1.25,
            sm: 2
          },
          mt: {
            xs: 1.5,
            sm: 2
          }
        }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{
            display: 'block',
            mb: 1
          }}>
          Account
        </Typography>
        <Button
          fullWidth
          variant="outlined"
          color="inherit"
          startIcon={<LogoutIcon fontSize="small" />}
          onClick={() => {
            onClose();
            void signOut({ callbackUrl: '/login' });
          }}
          sx={{
            justifyContent: 'center',
            minHeight: { xs: 38, sm: 42 },
            fontWeight: 800,
            fontSize: { xs: 12, sm: 13 },
            whiteSpace: 'nowrap'
          }}>
          Log out
        </Button>
      </Card>
      </Box>

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          px: {
            xs: 1.25,
            sm: 3
          },
          py: {
            xs: 1,
            sm: 1.5
          },
          flexShrink: 0
        }}>
        {saveStatus === 'error' ?
        <Alert severity="error" sx={{ py: 0, flex: 1 }}>
          Settings did not save.
        </Alert> :
        <Box sx={{ flex: 1 }} />
        }
        <Button variant="contained" onClick={saveSettings} disabled={saving} sx={{ fontSize: { xs: 12, sm: 13 }, whiteSpace: 'nowrap' }}>
          Save settings
        </Button>
      </Box>
    </Drawer>);

}
