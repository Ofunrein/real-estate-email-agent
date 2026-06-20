import React, { useState } from 'react';
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
  Tooltip } from
'@mui/material';
import { leadCategories, type LeadCategoryId } from '../data/inboxData';
import { useCategoryColors } from '../theme/CategoryColorContext';
interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}
const autoSendChannels = [
'email',
'sms',
'whatsapp',
'messenger',
'instagram',
'website chat'] as
const;
export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { colors, setColor } = useCategoryColors();
  const [draftFirst, setDraftFirst] = useState(false);
  const [autoSend, setAutoSend] = useState<Record<string, boolean>>(() =>
  Object.fromEntries(autoSendChannels.map((c) => [c, true]))
  );
  const [categoriesOn, setCategoriesOn] = useState<
    Record<LeadCategoryId, boolean>>(

    () =>
    Object.fromEntries(leadCategories.map((c) => [c.id, true])) as Record<
      LeadCategoryId,
      boolean>

  );
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
          
          {autoSendChannels.map((c) =>
          <FormControlLabel
            key={c}
            control={
            <Checkbox
              checked={autoSend[c]}
              onChange={(e) =>
              setAutoSend((prev) => ({
                ...prev,
                [c]: e.target.checked
              }))
              } />

            }
            label={`${c} auto-send`} />

          )}
        </Box>
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
          justifyContent: 'flex-end',
          mt: 3
        }}>
        
        <Button variant="contained" onClick={onClose}>
          Save settings
        </Button>
      </Box>
    </Drawer>);

}