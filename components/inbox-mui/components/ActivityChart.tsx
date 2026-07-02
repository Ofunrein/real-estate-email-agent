"use client";
import React, { useEffect, useState } from 'react';
import { Box, Card, Stack, Typography, Chip } from '@mui/material';
import TimelineIcon from '@mui/icons-material/InsightsOutlined';
import { useInboxModel } from '../InboxDataContext';
import { useReplayKey } from '../hooks/useReplayKey';

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

export function ActivityChart({ active = true }: {active?: boolean;}) {
  const { sparkline, metrics, channelStats } = useInboxModel();
  const max = Math.max(...sparkline);
  const { ref, playKey } = useReplayKey(active);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [displayValue, setDisplayValue] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  useEffect(() => {
    if (hoveredIndex !== null) setDisplayValue(sparkline[hoveredIndex]);
  }, [hoveredIndex]);
  const handleLeave = () => {
    setIsHovering(false);
    setHoveredIndex(null);
    setTimeout(() => setDisplayValue(null), 150);
  };
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
              {/* Outer wrapper replays grow-up; inner bar keeps hover scaleX separate. */}
              <Box
                sx={{
                  width: '100%',
                  height: `${v / max * 90}px`,
                  minHeight: 6,
                  transformOrigin: 'bottom',
                  animation: 'growBar .5s cubic-bezier(.22,1,.36,1) both',
                  animationDelay: `${i * 35}ms`,
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
                    transform: `scaleX(${isHovered ? 1.12 : isNeighbor ? 1.04 : 1})`,
                    transition: 'transform .3s ease-out, background-color .3s',
                  bgcolor: isHovered ?
                  'primary.main' :
                  isNeighbor ?
                  'primary.light' :
                  isAnyHovered ?
                  'action.selected' :
                  'action.selected',
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

      <Stack
        direction="row"
        spacing={1}
        sx={{
          mt: 2
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
