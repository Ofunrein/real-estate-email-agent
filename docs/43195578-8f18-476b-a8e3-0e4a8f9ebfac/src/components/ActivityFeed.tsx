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
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import GraphicEqIcon from '@mui/icons-material/GraphicEqOutlined';
import {
  activityEvents,
  channelMeta,
  type ChannelId,
  type ActivityEvent } from
'../data/inboxData';
interface ActivityFeedProps {
  channel: ChannelId;
}
export function ActivityFeed({ channel }: ActivityFeedProps) {
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
        
        <Stack spacing={0.5}>
          {events.map((e) =>
          <EventRow key={e.id} event={e} />
          )}
        </Stack>
      </Box>
    </Card>);

}
function EventRow({ event }: {event: ActivityEvent;}) {
  const meta = channelMeta[event.channel];
  const Icon = meta.icon;
  const isAi = event.kind === 'ai_reply' || event.kind === 'voice';
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 1.25,
        borderRadius: 2,
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
          sx={{
            width: 34,
            height: 34,
            bgcolor: isAi ? 'action.selected' : 'action.hover',
            color: isAi ? 'primary.main' : 'text.secondary'
          }}>
          
          {isAi ?
          event.kind === 'voice' ?
          <GraphicEqIcon fontSize="small" /> :

          <AutoAwesomeIcon fontSize="small" /> :


          <Icon fontSize="small" />
          }
        </Avatar>
      </Box>

      <Box
        sx={{
          minWidth: 0,
          flex: 1
        }}>
        
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            mb: 0.25
          }}>
          
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600
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
              bgcolor: 'action.selected',
              color: isAi ? 'primary.main' : 'success.main'
            }} />
          
          <Chip
            size="small"
            label={meta.label}
            sx={{
              height: 20,
              fontSize: 11,
              bgcolor: 'action.hover',
              color: 'text.secondary'
            }} />
          
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            lineHeight: 1.4
          }}>
          
          {event.body}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            mt: 0.5
          }}>
          
          <Typography variant="caption" color="text.secondary">
            {event.time}
          </Typography>
          {event.intent &&
          <Typography
            variant="caption"
            sx={{
              color: 'primary.main',
              bgcolor: 'action.selected',
              px: 0.75,
              borderRadius: 1,
              fontWeight: 600
            }}>
            
              {event.intent}
            </Typography>
          }
        </Stack>
      </Box>
    </Box>);

}