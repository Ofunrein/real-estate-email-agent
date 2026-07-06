"use client";
import React, { useId } from 'react';
import { Box, Card, Stack, Typography, LinearProgress, useTheme } from '@mui/material';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { TrendPoint } from '../data/inboxData';
import { useReplayKey } from '../hooks/useReplayKey';

// Ports Iris Dashboard.dc.html's metric card: a roughly 6% opacity tint of the
// metric's accent color washed across the card background (see the mockup's
// `inset 0 0 0 200px rgba({tint},.06)` box-shadow trick), a mono numeral, and
// a success-colored delta pill — only rendered when computed from real trend
// data (see computeTrendDelta below), never fabricated.
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return '99,102,241';
  return `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`;
}

// Real-data-only delta: compares the second half of a trend window against
// the first half. Returns null (render nothing) if there isn't enough real
// history to compute an honest percentage — never shows a fake positive.
export function computeTrendDelta(trend?: TrendPoint[]): string | null {
  if (!trend || trend.length < 4) return null;
  const mid = Math.floor(trend.length / 2);
  const first = trend.slice(0, mid).reduce((sum, p) => sum + p.value, 0);
  const second = trend.slice(mid).reduce((sum, p) => sum + p.value, 0);
  if (first <= 0) return null;
  const pct = Math.round(((second - first) / first) * 100);
  if (pct === 0) return null;
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: string;
  icon?: React.ReactNode;
  progress?: number;
  trend?: TrendPoint[];
  trendSuffix?: string;
  active?: boolean;
  replayDelay?: number;
  /** Success-colored delta pill next to the value. Omit when not computable from real data. */
  delta?: string | null;
  /** Wash a ~6% opacity tint of `accent` across the card background, per the mockup. */
  tint?: boolean;
}
export function StatCard({
  label,
  value,
  hint,
  accent = '#6366f1',
  icon,
  progress,
  trend,
  trendSuffix = '',
  active = true,
  replayDelay = 0,
  delta,
  tint = false
}: StatCardProps) {
  const gradientId = useId().replace(/:/g, '');
  const { ref, playKey } = useReplayKey(active);
  const theme = useTheme();
  const rimGlow = theme.palette.mode === 'dark'
    ? '0 0 0 1px rgba(196,154,82,0.35), 0 12px 44px rgba(196,154,82,0.2)'
    : '0 0 0 1px rgba(196,154,82,0.4), 0 10px 34px rgba(196,154,82,0.22)';
  return (
    <Card
      sx={{
        p: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        ...(tint
          ? { boxShadow: (t) => `${t.shadows[1]}, inset 0 0 0 200px rgba(${hexToRgb(accent)},0.06)` }
          : {}),
        transition: 'transform .2s ease, box-shadow .2s ease',
        '&:hover': tint ? { transform: 'translateY(-2px)', boxShadow: (t) => `${t.shadows[1]}, ${rimGlow}` } : undefined,
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
          
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography
              variant="h5"
              sx={{
                color: 'text.primary',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                fontFamily: 'var(--font-mono)'
              }}>

              {value}
            </Typography>
            {delta &&
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                color: 'success.main'
              }}>

              {delta}
            </Typography>
            }
          </Stack>
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
          ref={ref}
          sx={{
            width: 96,
            height: 44,
            flexShrink: 0
          }}>
          
            <ResponsiveContainer key={playKey} width="100%" height="100%">
              <AreaChart
              key={playKey}
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
                isAnimationActive={true}
                animationBegin={replayDelay}
                animationDuration={900}
                animationEasing="ease-out"
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
