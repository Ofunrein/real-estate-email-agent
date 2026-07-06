"use client";
import React, { useEffect, useState } from 'react';
import { Box, Card, Stack, Typography, Chip, useTheme } from '@mui/material';
import TimelineIcon from '@mui/icons-material/InsightsOutlined';
import { useInboxModel } from '../InboxDataContext';
import { useReplayKey } from '../hooks/useReplayKey';

// Respect prefers-reduced-motion by skipping the bar grow-in animation.
// Kept local to this file (no new hook file) since this component's file is
// the only one in scope that needs it.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);
  return reduced;
}

const dayLabels = [
'M',
'T',
'W',
'T',
'F',
'S',
'S',
'M',
'T',
'W',
'T',
'F',
'S',
'S'];

interface ActivityChartProps {
  active?: boolean;
  /** Controlled hover-bucket index, shared with ActivityFeed via OverviewView.
   *  Falls back to internal state when the chart is used standalone. */
  hoverBucket?: number | null;
  onHoverBucketChange?: (index: number | null) => void;
}

// Iris Dashboard.dc.html's agentActivityData(): hovering EITHER a bar or a
// feed row sets the same hoverBucket state — bars brighten, scale up and get
// a ring; the matching feed rows highlight. Ported to React state here;
// OverviewView owns the shared value and passes it to both this chart and
// ActivityFeed.
export function ActivityChart({ active = true, hoverBucket: hoverBucketProp, onHoverBucketChange }: ActivityChartProps) {
  const { sparkline, metrics, channelStats } = useInboxModel();
  const max = Math.max(1, ...sparkline);
  const { ref, playKey } = useReplayKey(active);
  const theme = useTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [internalHover, setInternalHover] = useState<number | null>(null);
  const hoveredIndex = hoverBucketProp !== undefined ? hoverBucketProp : internalHover;
  const setHoveredIndex = (index: number | null) => {
    setInternalHover(index);
    onHoverBucketChange?.(index);
  };
  const [displayValue, setDisplayValue] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  useEffect(() => {
    if (hoveredIndex !== null) setDisplayValue(sparkline[hoveredIndex]);
  }, [hoveredIndex, sparkline]);
  const handleLeave = () => {
    setIsHovering(false);
    setHoveredIndex(null);
    setTimeout(() => setDisplayValue(null), 150);
  };
  // Aggregate summary vs. per-day breakdown insight line, per the mockup —
  // only totals from the real sparkline are used, no invented channel splits.
  const totalTouches = sparkline.reduce((sum, v) => sum + v, 0);
  const insightText = hoveredIndex !== null
    ? `${dayLabels[hoveredIndex] ?? ''} bucket: ${sparkline[hoveredIndex]} touches that day.`
    : `${totalTouches} total touches over the last ${metrics.activityDays} days. Hover a bar or a feed row to see that day's count.`;
  return (
    <Card
      sx={{
        p: 2,
        transition: 'border-color .3s, background-color .3s'
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={handleLeave}>

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          mb: 0.5
        }}>

        <Stack direction="row" spacing={1} alignItems="center">
          <TimelineIcon
            fontSize="small"
            sx={{
              color: 'primary.main'
            }} />

          <Typography variant="subtitle2">
            Activity · {metrics.activityDays} days
          </Typography>
        </Stack>
        <Box
          sx={{
            height: 28,
            display: 'flex',
            alignItems: 'center'
          }}>

          <Typography
            variant="h6"
            sx={{
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono)',
              transition: 'opacity .25s, color .25s',
              opacity: isHovering && displayValue !== null ? 1 : 0.55,
              color:
              isHovering && displayValue !== null ?
              'text.primary' :
              'text.secondary'
            }}>

            {displayValue !== null ? displayValue : metrics.peakCount}
            <Box
              component="span"
              sx={{
                fontSize: 12,
                fontWeight: 500,
                color: 'text.secondary',
                ml: 0.5
              }}>

              touches
            </Box>
          </Typography>
        </Box>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Peak {metrics.peakDay} · {metrics.peakCount} touches
      </Typography>

      <Box
        ref={ref}
        key={playKey}
        sx={{
          mt: 2,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 0.75,
          height: 110
        }}>

        {sparkline.map((v, i) => {
          const isHovered = hoveredIndex === i;
          const isAnyHovered = hoveredIndex !== null;
          const isNeighbor =
          hoveredIndex !== null && (
          i === hoveredIndex - 1 || i === hoveredIndex + 1);
          return (
            <Box
              key={i}
              onMouseEnter={() => setHoveredIndex(i)}
              sx={{
                position: 'relative',
                flex: 1,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                cursor: 'pointer'
              }}>

              {/* Tooltip */}
              <Box
                sx={{
                  position: 'absolute',
                  top: -4,
                  left: '50%',
                  transform: isHovered ?
                  'translate(-50%, 0)' :
                  'translate(-50%, 4px)',
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1,
                  bgcolor: 'text.primary',
                  color: 'background.paper',
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity .2s, transform .2s',
                  pointerEvents: 'none',
                  zIndex: 2
                }}>

                {v} touches
              </Box>
              {/* Outer wrapper replays grow-up; inner bar keeps hover scaleX/ring separate. */}
              <Box
                sx={{
                  width: '100%',
                  height: `${(v / max) * 90}px`,
                  minHeight: 6,
                  transformOrigin: 'bottom',
                  animation: prefersReducedMotion ? 'none' : 'growBar .5s cubic-bezier(.22,1,.36,1) both',
                  animationDelay: prefersReducedMotion ? '0ms' : `${i * 35}ms`,
                  '@keyframes growBar': {
                    from: { transform: 'scaleY(0)', opacity: 0 },
                    to: { transform: 'scaleY(1)', opacity: 1 },
                  },
                }}>
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                  borderRadius: 1,
                    transform: `scaleX(${isHovered ? 1.12 : isNeighbor ? 1.04 : 1}) scaleY(${isHovered ? 1.04 : 1})`,
                    transition: 'transform .3s ease-out, background-color .3s, box-shadow .3s, filter .3s',
                  bgcolor: isHovered ?
                  'primary.main' :
                  isNeighbor ?
                  'primary.light' :
                  isAnyHovered ?
                  'action.selected' :
                  'action.selected',
                    filter: isHovered ? 'brightness(1.1)' : 'none',
                    boxShadow: isHovered ? `0 0 0 2px ${theme.iris.accentInk}` : 'none',
                    transformOrigin: 'bottom center'
                  }} />
              </Box>

              {/* Label */}
              <Typography
                variant="caption"
                sx={{
                  mt: 0.75,
                  fontSize: 10,
                  fontWeight: 600,
                  transition: 'color .3s',
                  color: isHovered ? 'text.primary' : 'text.secondary'
                }}>

                {dayLabels[i]}
              </Typography>
            </Box>);

        })}
      </Box>

      <Box
        sx={{
          mt: 1.5,
          p: 1.25,
          borderRadius: 2,
          bgcolor: hoveredIndex !== null ? 'action.selected' : 'action.hover',
          transition: 'background-color .15s',
        }}>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          {insightText}
        </Typography>
      </Box>

      <Stack
        direction="row"
        spacing={1}
        sx={{
          mt: 1.5
        }}
        flexWrap="wrap"
        useFlexGap>

        <Chip
          size="small"
          label={`Email · Iris · ${channelStats.email?.aiReplies || 0}`}
          sx={{
            bgcolor: 'action.selected',
            color: 'primary.main',
            fontWeight: 700
          }} />

        <Chip
          size="small"
          label={`SMS · Iris · ${channelStats.sms?.aiReplies || 0}`}
          sx={{
            bgcolor: 'action.selected',
            color: 'secondary.main',
            fontWeight: 700
          }} />
        <Chip
          size="small"
          label={`Social media · ${(
            (channelStats.instagram?.aiReplies || 0) +
            (channelStats.messenger?.aiReplies || 0) +
            (channelStats.whatsapp?.aiReplies || 0)
          )}`}
          sx={{
            bgcolor: 'action.selected',
            color: 'success.main',
            fontWeight: 700
          }} />

      </Stack>
    </Card>);

}
