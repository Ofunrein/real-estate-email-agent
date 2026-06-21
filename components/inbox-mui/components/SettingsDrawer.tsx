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
    setSaveStatus('idle');
  }, [inboxSettings, open]);

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
            xs: '92%',
            sm: 460
          },
          maxWidth: 480,
          p: {
            xs: 2.5,
            sm: 3.5
          }
        }
      }}>
      
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{
          mb: 3
        }}>
        
        <Box>
          <Typography variant="overline" color="text.secondary">
            Agent Inbox
          </Typography>
          <Typography variant="h5">Settings</Typography>
        </Box>
        <Button onClick={onClose} variant="outlined" size="small">
          Close
        </Button>
      </Stack>

      <Card
        variant="outlined"
        sx={{
          p: 2,
          mb: 2.5
        }}>
        
        <FormControlLabel
          control={
          <Checkbox
            checked={draftFirst}
            onChange={(e) => setDraftFirst(e.target.checked)} />

          }
          label="Draft first by default"
          sx={{
            mb: 1
          }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          When this is on, Iris saves replies to the human review queue instead of sending automatically.
        </Typography>
        
        <Divider
          sx={{
            mb: 1.5
          }} />
        
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: '1fr 1fr'
            },
            columnGap: 2
          }}>
          
          {autoSendChannels.map(([key, label]) =>
          <FormControlLabel
            key={key}
            control={
            <Checkbox
              checked={autoSend[key]}
              onChange={(e) =>
              setAutoSend((prev) => ({
                ...prev,
                [key]: e.target.checked
              }))
              } />

            }
            label={`${label} auto-send`} />

          )}
        </Box>
      </Card>

      <Card
        variant="outlined"
        sx={{
          p: 2,
          mb: 2.5
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
        <Stack spacing={0.5}>
          {channelAvailability.map(([key, label]) =>
          <FormControlLabel
            key={key}
            control={
            <Checkbox
              checked={channelsEnabled[key]}
              onChange={(e) =>
              setChannelsEnabled((prev) => ({
                ...prev,
                [key]: e.target.checked
              }))
              } />
            }
            label={`${label} enabled`} />
          )}
        </Stack>
      </Card>

      <Card
        variant="outlined"
        sx={{
          p: 2
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
          <Stack
            key={cat.id}
            direction="row"
            alignItems="center"
            spacing={1.5}>
            
              <Tooltip title="Change category color">
                <Box
                component="label"
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: 1.5,
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
                px: 1.5,
                py: 1,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: 'divider'
              }}>
              
                <Typography variant="body2">{cat.label}</Typography>
              </Box>
              <FormControlLabel
              sx={{
                m: 0
              }}
              control={
              <Checkbox
                checked={categoriesOn[cat.id]}
                onChange={(e) =>
                setCategoriesOn((prev) => ({
                  ...prev,
                  [cat.id]: e.target.checked
                }))
                } />

              }
              label="on" />
            
            </Stack>
          )}
        </Stack>
      </Card>

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          mt: 3
        }}>
        {saveStatus === 'error' ?
        <Alert severity="error" sx={{ py: 0, flex: 1 }}>
          Settings did not save.
        </Alert> :
        <Box sx={{ flex: 1 }} />
        }
        <Button variant="contained" onClick={saveSettings} disabled={saving}>
          Save settings
        </Button>
      </Box>
    </Drawer>);

}
