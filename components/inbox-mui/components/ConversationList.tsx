"use client";
import React, { useMemo, useState } from 'react';
import {
  Box,
  Card,
  Stack,
  Typography,
  Chip,
  ListItemButton,
  TextField,
  InputAdornment,
  Avatar } from
'@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import type { SvgIconComponent } from '@mui/icons-material';
import type { MessageChannelId } from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';

// Temperature is derived from the existing lead-category id — there is no
// separate hot/warm/cold field in the data model. Categories with no clear
// temperature signal (needs-reply, seller, needs-human) render no chip
// rather than inventing a value.
export type ThreadTemperature = 'hot' | 'warm' | 'cold';

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export interface ConversationListItem {
  id: string;
  title: string;
  time: string;
  preview: string;
  meta: string;
  unreadCount?: number;
  seen?: boolean;
  needsReview?: boolean;
  fallbackUsed?: boolean;
  categoryLabel?: string;
  categoryColor?: string;
  /** Channel this thread belongs to, used to render the small channel-icon badge on the avatar. */
  channel?: MessageChannelId;
  /** Status pill text, e.g. "Iris active", "Needs human", "Booked". Optional — omitted when unknown. */
  statusLabel?: string;
  statusTone?: 'accent' | 'warning' | 'success' | 'info' | 'neutral';
  /** Derived hot/warm/cold signal — omit to render no temperature chip. */
  temperature?: ThreadTemperature;
}
interface ConversationListProps {
  items: ConversationListItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  title: string;
}
export function ConversationList({
  items,
  selectedId,
  onSelect,
  title
}: ConversationListProps) {
  const { channelMeta } = useInboxModel();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
    `${it.title} ${it.preview} ${it.meta}`.toLowerCase().includes(q)
    );
  }, [items, query]);
  return (
    <Card
      sx={{
        width: {
          xs: '100%',
          md: 240,
          lg: 300
        },
        flexShrink: 0,
        maxHeight: {
          xs: 240,
          md: 'none'
        },
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
      
      <Box
        sx={{
          p: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider'
        }}>
        
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
            mb: 1
          }}>
          
          <Typography variant="subtitle2">{title}</Typography>
          <Chip
            size="small"
            variant="outlined"
            label={`${filtered.length} shown`} />
          
        </Stack>
        <TextField
          fullWidth
          size="small"
          placeholder="Search contacts..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search conversations"
          InputProps={{
            startAdornment:
            <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>

          }} />
        
      </Box>
      <Box
        sx={{
          overflowY: 'auto',
          flex: 1
        }}
        role="list">
        
        {filtered.length === 0 &&
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: 'block',
            p: 2,
            textAlign: 'center'
          }}>
          
            No conversations match “{query}”.
          </Typography>
        }
        {filtered.map((it) => {
          const selected = it.id === selectedId;
          const chanMeta = it.channel ? channelMeta[it.channel] : undefined;
          const ChanIcon: SvgIconComponent | undefined = chanMeta?.icon;
          const tempColor: Record<ThreadTemperature, { fg: string; paletteKey: 'error' | 'warning' | 'info'; label: string }> = {
            hot: { fg: 'error.main', paletteKey: 'error', label: 'Hot' },
            warm: { fg: 'warning.main', paletteKey: 'warning', label: 'Warm' },
            cold: { fg: 'info.main', paletteKey: 'info', label: 'Cold' }
          };
          const temp = it.temperature ? tempColor[it.temperature] : undefined;
          const statusPalette: Record<NonNullable<ConversationListItem['statusTone']>, string> = {
            accent: 'iris.accentInk',
            warning: 'warning.main',
            success: 'success.main',
            info: 'info.main',
            neutral: 'text.secondary'
          };
          return (
            <ListItemButton
              key={it.id}
              selected={selected}
              onClick={() => onSelect(it.id)}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.25,
                borderLeft: '3px solid',
                borderColor: selected ? 'primary.main' : 'transparent',
                bgcolor: selected ? 'iris.accentSoft' : 'transparent',
                py: 1.25,
                px: 1.5,
                borderBottom: '1px solid',
                borderBottomColor: 'divider'
              }}>

              <Box sx={{ position: 'relative', flexShrink: 0 }}>
                <Avatar
                  variant="rounded"
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: '11px',
                    bgcolor: 'action.selected',
                    color: 'text.secondary',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: 600
                  }}>
                  {initialsFor(it.title)}
                </Avatar>
                {ChanIcon &&
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: -3,
                    right: -3,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    bgcolor: 'background.paper',
                    border: '2px solid',
                    borderColor: 'background.paper',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: chanMeta?.accent
                  }}>
                  <ChanIcon sx={{ fontSize: 11 }} />
                </Box>
                }
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="baseline"
                  spacing={1}>

                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: it.unreadCount ? 800 : 600
                    }}
                    noWrap>

                    {it.title}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      flexShrink: 0,
                      fontFamily: 'var(--font-mono)'
                    }}>

                    {it.time}
                  </Typography>
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{
                    display: 'block',
                    mt: 0.25
                  }}>

                  {it.preview}
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.6}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{
                    mt: 0.6,
                    rowGap: 0.5
                  }}>

                  {it.statusLabel &&
                  <Chip
                    size="small"
                    label={it.statusLabel}
                    sx={{
                      height: 18,
                      fontSize: 10,
                      fontWeight: 600,
                      color: statusPalette[it.statusTone || 'neutral'],
                      bgcolor: 'action.hover',
                      '& .MuiChip-label': { px: 0.75 }
                    }} />
                  }
                  {it.categoryLabel &&
                  <Chip
                    size="small"
                    label={it.categoryLabel}
                    sx={{
                      height: 18,
                      fontSize: 10,
                      color: it.categoryColor || 'text.primary',
                      bgcolor: it.categoryColor ? `${it.categoryColor}22` : 'action.hover',
                      border: '1px solid',
                      borderColor: it.categoryColor || 'divider',
                      '& .MuiChip-label': { px: 0.75 }
                    }} />
                  }
                  {temp &&
                  <Chip
                    size="small"
                    label={temp.label}
                    sx={{
                      height: 18,
                      fontSize: 10,
                      fontWeight: 700,
                      color: temp.fg,
                      bgcolor: (theme) => `color-mix(in srgb, ${theme.palette[temp.paletteKey].main} 16%, transparent)`,
                      '& .MuiChip-label': { px: 0.75 }
                    }} />
                  }
                  {Boolean(it.unreadCount) &&
                  <Chip
                    size="small"
                    label={it.unreadCount}
                    color="primary"
                    sx={{
                      height: 18,
                      minWidth: 18,
                      fontSize: 10,
                      '& .MuiChip-label': { px: 0.6 }
                    }} />
                  }
                  {it.fallbackUsed &&
                  <Chip
                    size="small"
                    label="Fallback"
                    color="info"
                    variant="outlined"
                    sx={{
                      height: 18,
                      fontSize: 10
                    }} />
                  }
                  {it.needsReview &&
                  <Chip
                    size="small"
                    label="Review"
                    color="warning"
                    variant="outlined"
                    sx={{
                      height: 18,
                      fontSize: 10
                    }} />

                  }
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {it.meta}
                  </Typography>
                </Stack>
              </Box>
            </ListItemButton>);

        })}
      </Box>
    </Card>);

}
