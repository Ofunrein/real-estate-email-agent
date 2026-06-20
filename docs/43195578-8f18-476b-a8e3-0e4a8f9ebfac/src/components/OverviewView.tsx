import React from 'react';
import { Box, Grid } from '@mui/material';
import ReviewsIcon from '@mui/icons-material/RateReviewOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import ForumIcon from '@mui/icons-material/ForumOutlined';
import HubIcon from '@mui/icons-material/HubOutlined';
import { StatCard } from './StatCards';
import { ActivityChart } from './ActivityChart';
import { ActivityFeed } from './ActivityFeed';
import { metrics, statTrends } from '../data/inboxData';
export function OverviewView() {
  const aiRate = Math.round(metrics.aiReplies / metrics.events * 100);
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0
      }}>
      
      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <StatCard
            label="Need review"
            value={metrics.needReview}
            hint="Flagged for human approval"
            accent="#f59e0b"
            icon={<ReviewsIcon fontSize="small" />}
            trend={statTrends.needReview} />
          
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            label="Leads total"
            value={metrics.leadsTotal}
            hint="Active buyer leads"
            accent="#10b981"
            icon={<GroupsIcon fontSize="small" />}
            trend={statTrends.leadsTotal} />
          
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            label="Events"
            value={metrics.events}
            hint={`${metrics.threads} threads tracked`}
            accent="#06b6d4"
            icon={<ForumIcon fontSize="small" />}
            trend={statTrends.events} />
          
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            label="AI reply rate"
            value={`${aiRate}%`}
            hint={`${metrics.aiReplies} of ${metrics.events} handled`}
            accent="#6366f1"
            icon={<HubIcon fontSize="small" />}
            progress={aiRate}
            trend={statTrends.aiRate}
            trendSuffix="%" />
          
        </Grid>
      </Grid>

      <ActivityChart />
      <ActivityFeed channel="all" />
    </Box>);

}