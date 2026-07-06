"use client";

import React, { useMemo, useState } from 'react';
import { Box, Card, Chip, Grid, LinearProgress, Stack, Typography } from '@mui/material';
import ReviewsIcon from '@mui/icons-material/RateReviewOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import ForumIcon from '@mui/icons-material/ForumOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CalendarIcon from '@mui/icons-material/EventAvailableOutlined';
import TransferIcon from '@mui/icons-material/PhoneForwardedOutlined';
import MediaIcon from '@mui/icons-material/PermMediaOutlined';
import SpeedIcon from '@mui/icons-material/SpeedOutlined';
import WhatshotIcon from '@mui/icons-material/WhatshotOutlined';
import { StatCard, computeTrendDelta } from './StatCards';
import { ActivityChart } from './ActivityChart';
import { ActivityFeed } from './ActivityFeed';
import { type ActivityEvent } from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';

function PipelineOverview() {
  const { pipelineStages } = useInboxModel();
  const max = Math.max(1, ...pipelineStages.map((stage) => stage.value));

  return (
    <Card sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Pipeline overview</Typography>
        <Chip size="small" label="Live channels" sx={{ bgcolor: 'action.selected', fontWeight: 700 }} />
      </Stack>
      <Box sx={{ height: 190, display: 'flex', alignItems: 'flex-end', gap: 1.25, pt: 1 }}>
        {pipelineStages.map((stage) => (
          <Stack key={stage.key} spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                width: '100%',
                height: `${Math.max(10, (stage.value / max) * 130)}px`,
                borderRadius: 2,
                bgcolor: stage.color,
                boxShadow: `0 14px 32px ${stage.color}33`,
                transition: 'height .35s ease, transform .2s ease',
                '&:hover': { transform: 'translateY(-3px)' },
              }}
            />
            <Typography variant="caption" sx={{ fontWeight: 800, lineHeight: 1 }}>{stage.value}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%', fontSize: 10 }}>
              {stage.label}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Card>
  );
}

function ChannelQualityPanel() {
  const { channelQuality, channelMeta } = useInboxModel();
  const rows = channelQuality.filter((row) => row.inbound || row.replies || row.media || row.review).slice(0, 7);

  return (
    <Card sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Channel quality</Typography>
        <Chip size="small" label="Reply coverage" sx={{ bgcolor: 'action.selected', fontWeight: 700 }} />
      </Stack>
      <Stack spacing={1.25}>
        {(rows.length ? rows : channelQuality.slice(0, 4)).map((row) => {
          const meta = channelMeta[row.channel];
          return (
            <Box key={row.channel}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: meta?.accent || 'primary.main' }} />
                  <Typography variant="caption" sx={{ fontWeight: 800 }} noWrap>{row.label}</Typography>
                </Stack>
                <Typography variant="caption" sx={{ fontWeight: 800 }}>{row.quality}%</Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={row.quality}
                sx={{
                  my: 0.5,
                  height: 5,
                  borderRadius: 3,
                  bgcolor: 'action.selected',
                  '& .MuiLinearProgress-bar': { bgcolor: meta?.accent || 'primary.main', borderRadius: 3 },
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {row.inbound} inbound · {row.replies} replies · {row.media} media · {row.review} review
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Card>
  );
}

export function OverviewView({ active = true, onOpenActivityEvent }: {active?: boolean;onOpenActivityEvent?: (event: ActivityEvent) => void;}) {
  const { metrics, statTrends, emailThreads, smsThreads, textThreads } = useInboxModel();
  const aiRate = metrics.events ? Math.round(metrics.aiReplies / metrics.events * 100) : 0;
  const mediaRate = metrics.mediaItems ? Math.round(metrics.mediaTranscripts / metrics.mediaItems * 100) : 0;

  // Hot leads: real count of threads categorized 'hot-lead' across every
  // channel — no invented number. There's no day-bucketed history for this
  // count, so its trend delta is intentionally omitted (see brief: only show
  // a delta when computable from real historical data).
  const hotLeadsCount = useMemo(() => {
    const allThreads = [
      ...emailThreads,
      ...smsThreads,
      ...textThreads.instagram,
      ...textThreads.messenger,
      ...textThreads.whatsapp,
      ...textThreads.website,
    ];
    return allThreads.filter((t) => t.category === 'hot-lead').length;
  }, [emailThreads, smsThreads, textThreads]);

  // Shared hoverBucket state — ports Iris Dashboard.dc.html's
  // agentActivityData(): hovering a chart bar or a feed row sets the same
  // state, so both surfaces highlight together.
  const [hoverBucket, setHoverBucket] = useState<number | null>(null);

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
        minHeight: 0,
        overflowY: { xs: 'visible', lg: 'auto' }
      }}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label="Booked appointments"
            value={metrics.appointments > 0 ? metrics.appointments : '—'}
            hint="Actual scheduled calendar appointments"
            accent="#16A34A"
            icon={<CalendarIcon fontSize="small" />}
            trend={statTrends.appointments}
            delta={computeTrendDelta(statTrends.appointments)}
            tint
            active={active}
            replayDelay={0} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label="Qualified transfers"
            value={metrics.liveTransfers > 0 ? metrics.liveTransfers : '—'}
            hint="Completed handoffs to a human"
            accent="#2F5D7C"
            icon={<TransferIcon fontSize="small" />}
            trend={statTrends.transfers}
            delta={computeTrendDelta(statTrends.transfers)}
            tint
            active={active}
            replayDelay={120} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label="Avg response"
            value={metrics.avgResponseSamples > 0 ? metrics.avgResponseLabel : '—'}
            hint={metrics.avgResponseSamples > 0 ? `${metrics.avgResponseSamples} replies today` : 'No replies yet today'}
            accent="#C49A52"
            icon={<SpeedIcon fontSize="small" />}
            trend={metrics.avgResponseSamples > 0 ? statTrends.avgResponse : undefined}
            delta={metrics.avgResponseSamples > 0 ? computeTrendDelta(statTrends.avgResponse) : null}
            tint
            active={active}
            replayDelay={240} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label="Hot leads"
            value={hotLeadsCount > 0 ? hotLeadsCount : '—'}
            hint="Threads categorized as hot"
            accent="#DC2626"
            icon={<WhatshotIcon fontSize="small" />}
            tint
            active={active}
            replayDelay={360} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Need review" value={metrics.needReview} hint="Flagged for human approval" accent="#f59e0b" icon={<ReviewsIcon fontSize="small" />} trend={statTrends.needReview} active={active} replayDelay={0} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Leads total" value={metrics.leadsTotal} hint="Active buyer leads" accent="#10b981" icon={<GroupsIcon fontSize="small" />} trend={statTrends.leadsTotal} active={active} replayDelay={120} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Conversations handled" value={metrics.events} hint={`${metrics.threads} threads tracked`} accent="#06b6d4" icon={<ForumIcon fontSize="small" />} trend={statTrends.events} active={active} replayDelay={240} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="AI reply rate" value={`${aiRate}%`} hint={`${metrics.aiReplies} AI replies`} accent="#6366f1" icon={<AutoAwesomeIcon fontSize="small" />} progress={aiRate} trend={statTrends.aiRate} trendSuffix="%" active={active} replayDelay={360} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Qualified" value={metrics.qualifiedLeads} hint="Verified qualified leads" accent="#8b5cf6" icon={<SpeedIcon fontSize="small" />} trend={statTrends.qualified} active={active} replayDelay={480} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Media understood" value={`${mediaRate}%`} hint={`${metrics.mediaTranscripts}/${metrics.mediaItems} media transcribed`} accent="#14b8a6" icon={<MediaIcon fontSize="small" />} progress={mediaRate} active={active} replayDelay={840} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <ActivityChart active={active} hoverBucket={hoverBucket} onHoverBucketChange={setHoverBucket} />
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <PipelineOverview />
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <ChannelQualityPanel />
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <ActivityFeed
            channel="all"
            onOpenEvent={onOpenActivityEvent}
            hoverBucket={hoverBucket}
            onHoverBucketChange={setHoverBucket}
            bucketCount={metrics.activityDays}
          />
        </Grid>
      </Grid>
    </Box>
  );
}
