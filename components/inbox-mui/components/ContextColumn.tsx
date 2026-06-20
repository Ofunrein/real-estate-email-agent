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
import {
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
  const { channelStats, reviewQueue, channelMeta } = useInboxModel();
  const statsKey = channel === 'properties' ? 'all' : channel;
  const stats = channelStats[statsKey as Exclude<ChannelId, 'properties'>];
  const label =
  channel === 'all' ?
  'All channels' :
  channel === 'properties' ?
  'All channels' :
  channelMeta[channel as Exclude<ChannelId, 'all' | 'properties'>]?.label ?? channel;
  const total = stats.inbound + stats.aiReplies;
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