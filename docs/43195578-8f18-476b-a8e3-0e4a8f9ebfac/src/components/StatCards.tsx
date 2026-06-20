import React, { useId } from 'react';
import { Box, Card, Stack, Typography, LinearProgress } from '@mui/material';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { TrendPoint } from '../data/inboxData';
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: string;
  icon?: React.ReactNode;
  progress?: number;
  trend?: TrendPoint[];
  trendSuffix?: string;
}
export function StatCard({
  label,
  value,
  hint,
  accent = '#6366f1',
  icon,
  progress,
  trend,
  trendSuffix = ''
}: StatCardProps) {
  const gradientId = useId().replace(/:/g, '');
  return (
    <Card
      sx={{
        p: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
      }}>
      
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}>
        
        <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
          {icon &&
          <Box
            sx={{
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: (t) =>
              t.palette.mode === 'dark' ?
              'rgba(255,255,255,0.06)' :
              'action.hover',
              borderRadius: 1.5,
              p: 0.5
            }}>
            
              {icon}
            </Box>
          }
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              fontWeight: 700
            }}
            noWrap>
            
            {label}
          </Typography>
        </Stack>
      </Stack>

      <Stack
        direction="row"
        alignItems="flex-end"
        justifyContent="space-between"
        spacing={1.5}
        sx={{
          mt: 1.25,
          flex: 1
        }}>
        
        <Box
          sx={{
            minWidth: 0
          }}>
          
          <Typography
            variant="h5"
            sx={{
              color: 'text.primary',
              fontWeight: 800,
              letterSpacing: '-0.02em'
            }}>
            
            {value}
          </Typography>
          {hint &&
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              mt: 0.5,
              display: 'block'
            }}>
            
              {hint}
            </Typography>
          }
        </Box>

        {trend && trend.length > 0 &&
        <Box
          sx={{
            width: 96,
            height: 44,
            flexShrink: 0
          }}>
          
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
              data={trend}
              margin={{
                top: 4,
                right: 2,
                left: 2,
                bottom: 0
              }}>
              
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={accent} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <Tooltip
                cursor={{
                  stroke: accent,
                  strokeWidth: 1,
                  strokeDasharray: '2 2'
                }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <Box
                        sx={{
                          px: 1,
                          py: 0.5,
                          borderRadius: 1,
                          bgcolor: 'background.paper',
                          border: '1px solid',
                          borderColor: 'divider',
                          boxShadow: 2
                        }}>
                        
                          <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 700
                          }}>
                          
                            {payload[0].value}
                            {trendSuffix}
                          </Typography>
                        </Box>);

                  }
                  return null;
                }} />
              
                <Area
                type="monotone"
                dataKey="value"
                stroke={accent}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: accent,
                  stroke: '#fff',
                  strokeWidth: 1.5
                }} />
              
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        }
      </Stack>

      {progress != null &&
      <LinearProgress
        variant="determinate"
        value={progress}
        sx={{
          mt: 1.25,
          height: 6,
          borderRadius: 3,
          bgcolor: 'rgba(148,163,184,0.18)',
          '& .MuiLinearProgress-bar': {
            bgcolor: accent,
            borderRadius: 3
          }
        }} />

      }
    </Card>);

}