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
import {
  agentAvatar,
  type ChannelId,
  type ActivityEvent } from
'../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
interface ActivityFeedProps {
  channel: ChannelId;
  onOpenEvent?: (event: ActivityEvent) => void;
  /** Shared with ActivityChart via OverviewView — matching rows highlight when set. */
  hoverBucket?: number | null;
  onHoverBucketChange?: (index: number | null) => void;
  /** Total day buckets the chart is showing (metrics.activityDays), used to rebuild day labels. */
  bucketCount?: number;
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

const BUCKET_DAY_LABEL_RE = /^([A-Za-z]{3})\s+(\d{1,2})/;

// Rebuilds the same "last N days ending today" window the sparkline uses
// server-side (lib/inboxDataAdapter.ts buildDayBins), then maps each
// event's displayed "MMM d, h:mm A" timestamp onto a bucket index. This is a
// best-effort client-side correlation — ActivityEvent carries no raw
// timestamp or bucket field, so a mismatch (e.g. unparsable time strings)
// just means that row doesn't highlight, never a fabricated match.
function buildBucketDayKeys(bucketCount: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = bucketCount - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(`${d.getMonth()}-${d.getDate()}`);
  }
  return keys;
}

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Mirrors ActivityChart's weekday-letter axis labels so a feed row's
// "bucket: X" caption visually matches the letter under the bar it links to.
function dayLabelForIndex(index: number): string {
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return letters[index % 7];
}

function eventBucketIndex(event: ActivityEvent, bucketDayKeys: string[]): number | null {
  const match = BUCKET_DAY_LABEL_RE.exec(event.time);
  if (!match) return null;
  const month = MONTH_ABBR[match[1].toLowerCase()];
  if (month === undefined) return null;
  const day = Number.parseInt(match[2], 10);
  const key = `${month}-${day}`;
  const index = bucketDayKeys.indexOf(key);
  return index === -1 ? null : index;
}

export function ActivityFeed({ channel, onOpenEvent, hoverBucket = null, onHoverBucketChange, bucketCount = 14 }: ActivityFeedProps) {
  const { activityEvents, channelMeta } = useInboxModel();
  const events =
  channel === 'all' ?
  activityEvents :
  activityEvents.filter((e) => e.channel === channel);
  const bucketDayKeys = React.useMemo(() => buildBucketDayKeys(bucketCount), [bucketCount]);
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
              Latest cross-channel lead touches from the shared timeline.
            </Typography>
          </Box>
          <Chip
            size="small"
            label={`${events.length} updates`}
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
          {events.map((e, index) => {
            const bucketIndex = eventBucketIndex(e, bucketDayKeys);
            return (
              <EventRow
                key={e.id}
                event={e}
                isLast={index === events.length - 1}
                onOpen={onOpenEvent}
                bucketIndex={bucketIndex}
                isBucketHovered={bucketIndex !== null && hoverBucket !== null && bucketIndex === hoverBucket}
                onHoverBucketChange={onHoverBucketChange}
              />
            );
          })}
        </Stack>
      </Box>
    </Card>);

}
function EventRow({
  event,
  isLast,
  onOpen,
  bucketIndex,
  isBucketHovered,
  onHoverBucketChange,
}: {
  event: ActivityEvent;
  isLast: boolean;
  onOpen?: (event: ActivityEvent) => void;
  bucketIndex: number | null;
  isBucketHovered: boolean;
  onHoverBucketChange?: (index: number | null) => void;
}) {
  const { channelMeta } = useInboxModel();
  const meta = channelMeta[event.channel];
  const Icon = meta?.icon;
  const isAi = event.kind === 'ai_reply' || event.kind === 'voice';
  const status = event.status ?? (isAi ? 'Sent' : 'New');
  const statusSx = activityStatusSx(status);
  const body = activityPreviewBody(event);
  return (
    <Box
      component={onOpen ? 'button' : 'div'}
      type={onOpen ? 'button' : undefined}
      onClick={() => onOpen?.(event)}
      onMouseEnter={() => bucketIndex !== null && onHoverBucketChange?.(bucketIndex)}
      onMouseLeave={() => onHoverBucketChange?.(null)}
      sx={{
        width: '100%',
        textAlign: 'left',
        border: 0,
        bgcolor: isBucketHovered ? 'action.selected' : 'transparent',
        color: 'inherit',
        font: 'inherit',
        display: 'flex',
        gap: 1.5,
        p: 1.25,
        borderBottom: isLast ? '0' : '1px solid',
        borderColor: 'divider',
        borderRadius: 0,
        transform: isBucketHovered ? 'translateX(2px)' : 'none',
        transition: 'background-color .15s, transform .15s',
        cursor: onOpen ? 'pointer' : 'default',
        '&:hover': {
          bgcolor: 'action.hover'
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: -2
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
          Icon ? <Icon fontSize="small" /> : null :
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
        {bucketIndex !== null &&
        <Typography
          variant="caption"
          sx={{
            mt: 0.5,
            display: 'block',
            fontSize: 9,
            color: isBucketHovered ? 'text.primary' : 'text.secondary',
            fontWeight: isBucketHovered ? 700 : 400,
          }}>
          bucket: {dayLabelForIndex(bucketIndex)}
        </Typography>
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
