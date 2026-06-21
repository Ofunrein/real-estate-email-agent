"use client";
import React from 'react';
import { Box, Grid } from '@mui/material';
import ReviewsIcon from '@mui/icons-material/RateReviewOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import ForumIcon from '@mui/icons-material/ForumOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { StatCard } from './StatCards';
import { ActivityChart } from './ActivityChart';
import { ActivityFeed } from './ActivityFeed';
import { useInboxModel } from '../InboxDataContext';
export function OverviewView() {
  const { metrics, statTrends } = useInboxModel();
  const aiRate = metrics.events ? Math.round(metrics.aiReplies / metrics.events * 100) : 0;
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
            label="Need review"
            value={metrics.needReview}
            hint="Flagged for human approval"
            accent="#f59e0b"
            icon={<ReviewsIcon fontSize="small" />}
            trend={statTrends.needReview} />
          
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label="Leads total"
            value={metrics.leadsTotal}
            hint="Active buyer leads"
            accent="#10b981"
            icon={<GroupsIcon fontSize="small" />}
            trend={statTrends.leadsTotal} />
          
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label="Events"
            value={metrics.events}
            hint={`${metrics.threads} threads tracked`}
            accent="#06b6d4"
            icon={<ForumIcon fontSize="small" />}
            trend={statTrends.events} />
          
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label="AI reply rate"
            value={`${aiRate}%`}
            hint={`${metrics.aiReplies} AI replies`}
            accent="#6366f1"
            icon={<AutoAwesomeIcon fontSize="small" />}
            progress={aiRate}
            trend={statTrends.aiRate}
            trendSuffix="%" />
          
        </Grid>
      </Grid>

      <ActivityChart />
      <ActivityFeed channel="all" />
    </Box>);

}
