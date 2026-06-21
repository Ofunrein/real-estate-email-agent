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
