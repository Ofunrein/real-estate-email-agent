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
  InputAdornment } from
'@mui/material';
import SearchIcon from '@mui/icons-material/Search';
export interface ConversationListItem {
  id: string;
  title: string;
  time: string;
  preview: string;
  meta: string;
  unreadCount?: number;
  seen?: boolean;
  needsReview?: boolean;
  categoryLabel?: string;
  categoryColor?: string;
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
          return (
            <ListItemButton
              key={it.id}
              selected={selected}
              onClick={() => onSelect(it.id)}
              sx={{
                display: 'block',
                borderLeft: '3px solid',
                borderColor: selected ? 'primary.main' : 'transparent',
                py: 1.25,
                px: 1.5,
                borderBottom: '1px solid',
                borderBottomColor: 'divider'
              }}>
              
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
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
                    flexShrink: 0
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
                spacing={0.75}
                alignItems="center"
                sx={{
                  mt: 0.5
                }}>
                
                <Typography variant="caption" color="text.secondary">
                  {it.meta}
                </Typography>
                {Boolean(it.unreadCount) &&
                <Chip
                  size="small"
                  label={it.unreadCount}
                  color="primary"
                  sx={{
                    height: 17,
                    minWidth: 18,
                    fontSize: 10,
                    '& .MuiChip-label': { px: 0.6 }
                  }} />
                }
                {it.categoryLabel &&
                <Chip
                  size="small"
                  label={it.categoryLabel}
                  sx={{
                    height: 17,
                    fontSize: 10,
                    color: it.categoryColor || 'text.primary',
                    bgcolor: it.categoryColor ? `${it.categoryColor}22` : 'action.hover',
                    border: '1px solid',
                    borderColor: it.categoryColor || 'divider',
                    '& .MuiChip-label': { px: 0.6 }
                  }} />
                }
                {it.needsReview &&
                <Chip
                  size="small"
                  label="Review"
                  color="warning"
                  variant="outlined"
                  sx={{
                    height: 17,
                    fontSize: 10
                  }} />

                }
              </Stack>
            </ListItemButton>);

        })}
      </Box>
    </Card>);

}
