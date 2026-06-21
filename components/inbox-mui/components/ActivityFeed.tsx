"use client";
import React from 'react';
import {
  Box,
  Card,
  Stack,
  Typography,
  Avatar,
  Chip,
  Divider } from
'@mui/material';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import GraphicEqIcon from '@mui/icons-material/GraphicEqOutlined';
import {
  agentAvatar,
  type ChannelId,
  type ActivityEvent } from
'../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
interface ActivityFeedProps {
  channel: ChannelId;
}

function activityPreviewBody(event: ActivityEvent) {
  if (
    event.channel === 'voice' &&
    /\b(you are\s+(?:iris|arya|a real estate)|brand voice|system prompt|developer instruction|never reveal|do not reveal|call script)\b/i.test(event.body)
  ) {
    return 'Voice call recorded.';
  }
  return event.body;
}

export function ActivityFeed({ channel }: ActivityFeedProps) {
  const { activityEvents, channelMeta } = useInboxModel();
  const events =
  channel === 'all' ?
  activityEvents :
  activityEvents.filter((e) => e.channel === channel);
  return (
    <Card
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}>
      
      <Box
        sx={{
          p: 2,
          pb: 1.5
        }}>
        
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start">
          
          <Box>
            <Typography variant="subtitle1">Recent activity</Typography>
            <Typography variant="caption" color="text.secondary">
              Latest cross-channel activity from the shared event log.
            </Typography>
          </Box>
          <Chip
            size="small"
            label={`${events.length} events`}
            variant="outlined" />
          
        </Stack>
      </Box>
      <Divider />
      <Box
        sx={{
          overflowY: 'auto',
          flex: 1,
          px: 1,
          py: 1
        }}
        role="feed"
        aria-label="Activity feed">
        
        <Stack spacing={0}>
          {events.map((e, index) =>
          <EventRow key={e.id} event={e} isLast={index === events.length - 1} />
          )}
        </Stack>
      </Box>
    </Card>);

}
function EventRow({ event, isLast }: {event: ActivityEvent;isLast: boolean;}) {
  const { channelMeta } = useInboxModel();
  const meta = channelMeta[event.channel];
  const Icon = meta?.icon;
  const isAi = event.kind === 'ai_reply' || event.kind === 'voice';
  const status = event.status ?? (isAi ? 'Sent' : 'New');
  const statusSx = activityStatusSx(status);
  const body = activityPreviewBody(event);
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 1.25,
        borderBottom: isLast ? '0' : '1px solid',
        borderColor: 'divider',
        borderRadius: 0,
        transition: 'background-color .15s',
        '&:hover': {
          bgcolor: 'action.hover'
        }
      }}>
      
      <Box
        sx={{
          position: 'relative',
          pt: 0.25
        }}>
        
          <Avatar
            variant="rounded"
            src={isAi && event.kind !== 'voice' ? agentAvatar : undefined}
            alt={isAi && event.kind !== 'voice' ? 'Iris AI agent' : undefined}
            sx={{
              width: 34,
              height: 34,
            bgcolor: isAi ? 'rgba(99,102,241,0.14)' : 'action.hover',
            color: isAi ? 'primary.dark' : 'text.secondary',
            border: '1px solid',
            borderColor: isAi ? 'rgba(99,102,241,0.28)' : 'divider'
          }}>
          
          {isAi ?
          event.kind === 'voice' ?
          <GraphicEqIcon fontSize="small" /> :
          null :

          Icon ?
          <Icon fontSize="small" /> :
            null
          }
        </Avatar>
      </Box>

      <Box
        sx={{
          minWidth: 0,
          flex: 1
        }}>
        
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: 1,
            alignItems: 'start'
          }}>
          
          <Box sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                mb: 0.25,
                minWidth: 0
              }}>
              
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  minWidth: 0
                }}
                noWrap>
                
                {event.actor}
              </Typography>
              <Chip
                size="small"
                icon={isAi ? <ArrowOutwardIcon /> : <SouthEastIcon />}
                label={isAi ? 'Iris' : 'Inbound'}
                sx={{
                  height: 20,
                  '& .MuiChip-icon': {
                    fontSize: 13,
                    ml: 0.5
                  },
                  fontSize: 11,
                  bgcolor: isAi ? 'rgba(99,102,241,0.14)' : 'rgba(4,120,87,0.12)',
                  color: isAi ? 'primary.dark' : 'success.main',
                  border: '1px solid',
                  borderColor: isAi ? 'rgba(99,102,241,0.26)' : 'rgba(4,120,87,0.25)',
                  flexShrink: 0
                }} />
              
              <Chip
                size="small"
                label={meta?.label ?? event.channel}
                sx={{
                  height: 20,
                  fontSize: 11,
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  border: '1px solid',
                  borderColor: 'divider',
                  flexShrink: 0
                }} />
              
            </Stack>
          </Box>
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            justifyContent="flex-end"
            sx={{
              minWidth: 70,
              pt: 0.1,
              flexShrink: 0
            }}>
            
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontSize: 10,
                lineHeight: '17px',
                whiteSpace: 'nowrap'
              }}>
              
              {event.time}
            </Typography>
            <Chip
              size="small"
              label={status}
              sx={{
                height: 17,
                fontSize: 10,
                px: 0.25,
                '& .MuiChip-label': {
                  px: 0.5
                },
                ...statusSx
              }} />
            
          </Stack>
        </Box>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            lineHeight: 1.45,
            whiteSpace: event.channel === 'sms' ? 'pre-wrap' : 'normal',
            wordBreak: 'break-word'
          }}>
          
          {body}
        </Typography>
        {event.intent &&
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            mt: 0.5
          }}>
          
          <Typography
            variant="caption"
            sx={{
              color: 'primary.dark',
              bgcolor: 'rgba(99,102,241,0.14)',
              border: '1px solid rgba(99,102,241,0.25)',
              px: 0.75,
              borderRadius: 1,
              fontWeight: 600
            }}>
            
              {event.intent}
            </Typography>
        </Stack>
        }
      </Box>
    </Box>);

}

function activityStatusSx(status: ActivityEvent['status']) {
  switch (status) {
    case 'Review':
      return {
        bgcolor: 'rgba(180,83,9,0.13)',
        color: '#92400e',
        border: '1px solid rgba(180,83,9,0.25)'
      };
    case 'Sent':
      return {
        bgcolor: 'rgba(4,120,87,0.13)',
        color: '#065f46',
        border: '1px solid rgba(4,120,87,0.25)'
      };
    default:
      return {
        bgcolor: 'rgba(2,132,199,0.13)',
        color: '#075985',
        border: '1px solid rgba(2,132,199,0.25)'
      };
  }
}
