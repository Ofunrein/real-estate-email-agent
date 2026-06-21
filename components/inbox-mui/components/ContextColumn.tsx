"use client";
import React from 'react';
import {
  Box,
  Card,
  Stack,
  Typography,
  Chip,
  LinearProgress,
  Avatar,
  Divider } from
'@mui/material';
import HomeIcon from '@mui/icons-material/HomeWorkOutlined';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import FlagIcon from '@mui/icons-material/OutlinedFlag';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import {
  agentAvatar,
  type ChannelId } from
'../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
interface ContextColumnProps {
  channel: ChannelId;
  inDrawer?: boolean;
}
export function ContextColumn({
  channel,
  inDrawer = false
}: ContextColumnProps) {
  const { channelStats, reviewQueue, channelMeta, metrics } = useInboxModel();
  const statsKey: Exclude<ChannelId, 'properties' | 'imports'> =
  channel === 'properties' || channel === 'imports' ? 'all' : channel;
  const stats = channelStats[statsKey];
  const label =
  channel === 'all' ?
  'All channels' :
  channel === 'properties' || channel === 'imports' ?
  'All channels' :
  channelMeta[channel as Exclude<ChannelId, 'all' | 'properties' | 'imports'>]?.label ?? channel;
  const total = stats.inbound + stats.aiReplies;
  const approvalRate = total > 0 ? Math.round((stats.aiReplies / total) * 100) : 0;
  const suggestions = reviewQueue.slice(0, 3);
  return (
    <Stack
      spacing={2}
      sx={{
        width: inDrawer ? '100%' : 312,
        flexShrink: 0,
        overflowY: 'auto',
        height: inDrawer ? '100%' : 'auto',
        p: inDrawer ? 2 : 0,
        pr: inDrawer ? 2 : 0.5
      }}
      component="aside"
      aria-label="Context">

      {/* Iris status + today */}
      <Card sx={{ p: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Avatar src={agentAvatar} alt="Iris AI agent" sx={{ width: 34, height: 34 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'text.primary', lineHeight: 1.2 }}>
              Iris
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' }} />
              <Typography sx={{ fontSize: '11px', color: 'text.secondary' }}>
                Handling leads
              </Typography>
            </Stack>
          </Box>
        </Stack>
        <Divider sx={{ my: 1.25 }} />
        <TodayRow
          label="AI avg response"
          value={metrics.avgResponseLabel}
          color="#0ea5e9" />
        <Divider sx={{ my: 1.25 }} />
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25 }}>
          <TrendingUpIcon sx={{ fontSize: 15, color: '#6366f1' }} aria-hidden />
          <Typography sx={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'text.secondary' }}>
            Today
          </Typography>
        </Stack>
        <Stack spacing={1.25}>
          <TodayRow label="Active threads" value={`${stats.threads}`} color="#6366f1" />
          <TodayRow label="Approval rate" value={`${approvalRate}%`} color="#10b981" />
          <TodayRow label="Open leads" value={`${metrics.leadsTotal}`} color="#f59e0b" />
        </Stack>
      </Card>

      {/* SUGGESTIONS */}
      {suggestions.length > 0 &&
      <Card sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <AutoAwesomeIcon sx={{ fontSize: 15, color: '#22d3ee' }} aria-hidden />
          <Typography sx={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'text.secondary' }}>
            Suggestions
          </Typography>
        </Stack>
        <Stack spacing={0}>
          {suggestions.map((s, i) =>
          <Box
            key={s.id}
            sx={{
              py: 1.25,
              borderTop: i === 0 ? 'none' : '1px solid',
              borderColor: 'divider'
            }}>
            <Typography sx={{ fontSize: '14px', color: 'text.secondary', lineHeight: 1.5 }}>
              Follow up with {s.contact} — {s.reason}
            </Typography>
          </Box>
          )}
        </Stack>
      </Card>
      }

      {/* Watching */}
      <Card
        sx={{
          p: 2
        }}>

        <Typography
          variant="subtitle2"
          sx={{
            mb: 1.5
          }}>
          
          Watching
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            mb: 1
          }}>
          
          <Chip
            size="small"
            label={label}
            sx={{
              bgcolor: 'action.selected'
            }} />
          
        </Stack>
        <Stack direction="row" spacing={3}>
          <Box>
            <Typography variant="h6">{stats.events}</Typography>
            <Typography variant="caption" color="text.secondary">
              events
            </Typography>
          </Box>
          <Box>
            <Typography variant="h6">{stats.threads}</Typography>
            <Typography variant="caption" color="text.secondary">
              threads
            </Typography>
          </Box>
        </Stack>
      </Card>

      {/* Last activity */}
      <Card
        sx={{
          p: 2
        }}>
        
        <Typography
          variant="subtitle2"
          sx={{
            mb: 1.5
          }}>
          
          Last activity
        </Typography>
        {stats.lastActivity ?
        <Stack spacing={1}>
            <Typography
            variant="body2"
            sx={{
              fontWeight: 600
            }}
            noWrap>
            
              {stats.lastActivity.contact}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {stats.lastActivity.message}
            </Typography>
            <Divider />
            <Row
            label="Status"
            value={
            <Chip
              size="small"
              label={stats.lastActivity.status}
              sx={{
                height: 20,
                fontSize: 11,
                bgcolor: 'action.selected'
              }} />

            } />
          
            <Row
            label="When"
            value={
            <Typography variant="caption" color="text.secondary">
                  {stats.lastActivity.when}
                </Typography>
            } />
          
          </Stack> :

        <Box>
            <Typography
            variant="body2"
            sx={{
              fontWeight: 600
            }}>
            
              No lead selected
            </Typography>
            <Typography variant="caption" color="text.secondary">
              No conversation activity loaded yet.
            </Typography>
            <Divider
            sx={{
              my: 1
            }} />
          
            <Row
            label="Status"
            value={
            <Typography variant="caption" color="text.secondary">
                  waiting
                </Typography>
            } />
          
            <Row
            label="When"
            value={
            <Typography variant="caption" color="text.secondary">
                  No timestamp
                </Typography>
            } />
          
          </Box>
        }
      </Card>

      {/* Human review */}
      <Card
        sx={{
          p: 2
        }}>
        
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
            mb: 1
          }}>
          
          <Typography variant="subtitle2">Human review</Typography>
          {stats.humanReview === 'flagged' ?
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label="5 flagged" /> :


          <Chip
            size="small"
            color="success"
            variant="outlined"
            label="Clear" />

          }
        </Stack>
        {stats.humanReview === 'flagged' ?
        <Stack spacing={0.5}>
            {reviewQueue.map((r) =>
          <Box
            key={r.id}
            sx={{
              p: 1,
              borderRadius: 1.5,
              bgcolor: 'action.hover'
            }}>
            
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <FlagIcon
                sx={{
                  fontSize: 13,
                  color: 'warning.main'
                }} />
              
                  <Typography
                variant="caption"
                sx={{
                  fontWeight: 600
                }}
                noWrap>
                
                    {r.contact}
                  </Typography>
                </Stack>
                <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                mt: 0.25
              }}>
              
                  {r.reason}
                </Typography>
              </Box>
          )}
          </Stack> :

        <Stack direction="row" spacing={1} alignItems="center">
            <CheckCircleIcon
            fontSize="small"
            sx={{
              color: 'success.main'
            }} />
          
            <Typography variant="caption" color="text.secondary">
              No handoffs in this view.
            </Typography>
          </Stack>
        }
      </Card>

      {/* Flow balance */}
      <Card
        sx={{
          p: 2
        }}>
        
        <Typography
          variant="subtitle2"
          sx={{
            mb: 1.5
          }}>
          
          Flow balance
        </Typography>
        <Stack spacing={1.5}>
          <FlowRow
            label="Inbound"
            value={stats.inbound}
            icon={
            <SouthEastIcon
              sx={{
                fontSize: 14
              }} />

            }
            color="#34d399"
            pct={total ? stats.inbound / total * 100 : 0} />
          
          <FlowRow
            label="AI replies"
            value={stats.aiReplies}
            icon={
            <ArrowOutwardIcon
              sx={{
                fontSize: 14
              }} />

            }
            color="#6366f1"
            pct={total ? stats.aiReplies / total * 100 : 0} />
          
        </Stack>
      </Card>

      {/* Data readiness */}
      <Card
        sx={{
          p: 2
        }}>
        
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            mb: 1
          }}>
          
          <HomeIcon
            fontSize="small"
            sx={{
              color: 'warning.main'
            }} />
          
          <Typography variant="subtitle2">Data readiness</Typography>
        </Stack>
        <Stack direction="row" alignItems="baseline" spacing={0.5}>
          <Typography variant="h5" color="success.main">
            100
          </Typography>
          <Typography variant="caption" color="text.secondary">
            property health
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={100}
          sx={{
            mt: 1,
            height: 6,
            borderRadius: 3,
            bgcolor: 'action.selected',
            '& .MuiLinearProgress-bar': {
              bgcolor: 'success.main',
              borderRadius: 3
            }
          }} />
        
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            mt: 0.75,
            display: 'block'
          }}>
          
          Property rows are ready for agent use.
        </Typography>
      </Card>
    </Stack>);

}
function TodayRow({ label, value, color }: {label: string;value: string;color: string;}) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: '14px', fontWeight: 800, color }}>
        {value}
      </Typography>
    </Stack>);

}
function Row({ label, value }: {label: string;value: React.ReactNode;}) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {value}
    </Stack>);

}
interface FlowRowProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  pct: number;
}
function FlowRow({ label, value, icon, color, pct }: FlowRowProps) {
  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          mb: 0.5
        }}>
        
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box
            sx={{
              color,
              display: 'flex'
            }}>
            
            {icon}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        </Stack>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 700
          }}>
          
          {value}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 6,
          borderRadius: 3,
          bgcolor: 'action.selected',
          '& .MuiLinearProgress-bar': {
            bgcolor: color,
            borderRadius: 3
          }
        }} />
      
    </Box>);

}
