"use client";
import React from 'react';
import { Box, Card, Stack, Typography, Avatar } from '@mui/material';
import { type MessageChannelId } from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
interface EmptyChannelViewProps {
  channel: MessageChannelId;
}
export function EmptyChannelView({ channel }: EmptyChannelViewProps) {
  const { channelMeta } = useInboxModel();
  const meta = channelMeta[channel];
  const Icon = meta.icon;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}>
      
      <Box
        sx={{
          mb: 2
        }}>
        
        <Typography variant="h6">{meta.label} Threads</Typography>
        <Typography variant="caption" color="text.secondary">
          Read the exact conversation as the AI handled it.
        </Typography>
      </Box>
      <Card
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4
        }}>

        <Stack
          spacing={1.5}
          alignItems="center"
          sx={{
            textAlign: 'center',
            maxWidth: 360,
            width: '100%',
            py: 5,
            px: 3,
            borderRadius: 3,
            border: '1px dashed',
            borderColor: 'divider'
          }}>

          <Avatar
            variant="rounded"
            sx={{
              width: 44,
              height: 44,
              borderRadius: '12px',
              bgcolor: 'action.hover',
              color: meta.accent
            }}>

            <Icon fontSize="small" />
          </Avatar>
          <Typography variant="subtitle1">
            No {meta.label.toLowerCase()} conversations yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Connected webhooks will appear here as live conversation threads.
          </Typography>
        </Stack>
      </Card>
    </Box>);

}
