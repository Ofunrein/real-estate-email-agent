"use client";
import React, { useEffect, useState, useRef } from 'react';
import {
  Box,
  Card,
  Stack,
  Typography,
  Chip,
  Collapse,
  Button,
  IconButton,
  Avatar,
  Slider,
  Tooltip } from
'@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonIcon from '@mui/icons-material/PersonOutline';
import GraphicEqIcon from '@mui/icons-material/GraphicEqOutlined';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import {
  agentAvatar,
  type Call,
  type CallOutcome } from
'../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
const outcomeColor: Record<CallOutcome, string> = {
  voicemail: '#fbbf24',
  'silence-timed-out': '#94a3b8',
  'assistant-forwarded-call': '#38bdf8',
  'assistant-ended-call': '#34d399'
};
export function VoiceView() {
  const { voiceContacts } = useInboxModel();
  const [selectedId, setSelectedId] = useState(voiceContacts[0]?.id ?? '');
  const contact =
  voiceContacts.find((c) => c.id === selectedId) ?? voiceContacts[0];
  const readerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handleSelect = (id: string) => {
    setSelectedId(id);
    // Jump to the conversation thread when a voice contact is opened.
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      readerRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    });
  };
  if (!contact) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <WorkspaceHeader title="Voice Threads" subtitle="Read the exact conversation as the AI handled it." count="0 calls" />
        <Card sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, minHeight: 200 }}>
          <Typography variant="body2" color="text.secondary">No voice calls yet.</Typography>
        </Card>
      </Box>
    );
  }
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}>
      
      <WorkspaceHeader
        title="Voice Threads"
        subtitle="Read the exact conversation as the AI handled it."
        count="9 calls" />
      
      <Box
        sx={{
          display: 'flex',
          flexDirection: {
            xs: 'column',
            sm: 'row'
          },
          gap: 2,
          flex: 1,
          minHeight: 0
        }}>
        
        <ConversationList
          title="Conversations"
          items={voiceContacts.map((c) => ({
            id: c.id,
            title: c.contact,
            time: c.time,
            preview: c.summary,
            meta: `${c.callCount} call${c.callCount > 1 ? 's' : ''} · Recording`
          }))}
          selectedId={selectedId}
          onSelect={handleSelect} />
        

        <Card
          ref={readerRef}
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0,
            scrollMarginTop: 16
          }}>
          
          <Box
            sx={{
              p: 1.75,
              borderBottom: '1px solid',
              borderColor: 'divider'
            }}>
            
            <Typography variant="subtitle1">{contact.contact}</Typography>
            <Typography variant="caption" color="text.secondary">
              {contact.callCount} calls · {contact.tag}
            </Typography>
          </Box>

          <Box
            ref={scrollRef}
            sx={{
              flex: 1,
              overflowY: 'auto',
              p: 2
            }}>
            
            <Stack spacing={2}>
              {contact.calls.map((call) =>
              <CallCard key={call.id} call={call} />
              )}
            </Stack>
          </Box>

          <ReaderFooter actionLabel="Take over call" />
        </Card>
      </Box>
    </Box>);

}
function CallCard({ call }: {call: Call;}) {
  const [rawOpen, setRawOpen] = useState(false);
  const accent = outcomeColor[call.outcome];
  return (
    <Card
      variant="outlined"
      sx={{
        p: 1.75
      }}>
      
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          mb: 1.5
        }}>
        
        <Stack direction="row" spacing={1} alignItems="center">
          <GraphicEqIcon
            fontSize="small"
            sx={{
              color: accent
            }} />
          
          <Typography variant="caption" color="text.secondary">
            {call.time} · {call.duration}
          </Typography>
        </Stack>
        <Chip
          size="small"
          label={call.outcome}
          sx={{
            height: 22,
            fontSize: 11,
            bgcolor: 'action.selected',
            color: accent
          }} />
        
      </Stack>

      <Stack spacing={1}>
        {call.turns.map((turn, i) => {
          const isAgent = turn.speaker === 'Iris';
          return (
            <Box
              key={i}
              sx={{
                display: 'flex',
                gap: 1,
                flexDirection: isAgent ? 'row-reverse' : 'row'
              }}>
              
              <Avatar
                src={isAgent ? agentAvatar : undefined}
                alt={isAgent ? 'Arya, AI agent' : undefined}
                sx={{
                  width: 24,
                  height: 24,
                  bgcolor: isAgent ? 'primary.main' : 'action.selected',
                  color: isAgent ? 'primary.contrastText' : 'text.secondary'
                }}>
                
                {!isAgent &&
                <PersonIcon
                  sx={{
                    fontSize: 14
                  }} />

                }
              </Avatar>
              <Box
                sx={{
                  maxWidth: '80%',
                  p: 1,
                  px: 1.25,
                  borderRadius: 2,
                  bgcolor: isAgent ?
                  (t) =>
                  t.palette.mode === 'dark' ?
                  'rgba(99,102,241,0.14)' :
                  'rgba(99,102,241,0.08)' :
                  'action.hover'
                }}>
                
                <Typography
                  variant="body2"
                  sx={{
                    lineHeight: 1.45
                  }}>
                  
                  {turn.text}
                </Typography>
              </Box>
            </Box>);

        })}
      </Stack>

      <Box
        sx={{
          mt: 1.5,
          p: 1.25,
          borderRadius: 1.5,
          bgcolor: 'action.hover'
        }}>
        
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700
          }}>
          
          Call report
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: 'block',
            mt: 0.5,
            lineHeight: 1.5
          }}>
          
          {call.report}
        </Typography>
      </Box>

      <Button
        size="small"
        endIcon={
        <ExpandMoreIcon
          sx={{
            transform: rawOpen ? 'rotate(180deg)' : 'none',
            transition: '0.2s'
          }} />

        }
        onClick={() => setRawOpen((o) => !o)}
        sx={{
          mt: 1
        }}>
        
        Raw transcript
      </Button>
      <Collapse in={rawOpen}>
        <Box
          sx={{
            mt: 1,
            p: 1.25,
            borderRadius: 1.5,
            bgcolor: 'action.selected'
          }}>
          
          {call.turns.map((t, i) =>
          <Typography
            key={i}
            variant="caption"
            sx={{
              display: 'block',
              mb: 0.5,
              lineHeight: 1.5
            }}>
            
              <Box
              component="span"
              sx={{
                fontWeight: 700,
                color:
                t.speaker === 'Iris' ? 'primary.main' : 'text.secondary'
              }}>
              
                {t.speaker === 'Iris' ? 'AI' : 'User'}:
              </Box>{' '}
              {t.text}
            </Typography>
          )}
        </Box>
      </Collapse>

      <RecordingPlayer duration={call.duration} accent={accent} />
    </Card>);

}
function parseDuration(value: string): number {
  const parts = value.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function RecordingPlayer({
  duration,
  accent



}: {duration: string;accent: string;}) {
  const total = parseDuration(duration);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrent((c) => {
          if (c + 1 >= total) {
            setPlaying(false);
            return total;
          }
          return c + 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, total]);
  const finished = current >= total && total > 0;
  return (
    <Box
      sx={{
        mt: 1.5
      }}>
      
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontWeight: 700,
          display: 'block',
          mb: 0.75
        }}>
        
        RECORDING
      </Typography>
      <Stack
        direction="row"
        spacing={1.25}
        alignItems="center"
        sx={{
          p: 1,
          pr: 1.5,
          borderRadius: 999,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}>
        
        <Tooltip title={finished ? 'Replay' : playing ? 'Pause' : 'Play'}>
          <IconButton
            size="small"
            onClick={() => {
              if (finished) {
                setCurrent(0);
                setPlaying(true);
              } else {
                setPlaying((p) => !p);
              }
            }}
            aria-label={
            finished ?
            'Replay recording' :
            playing ?
            'Pause recording' :
            'Play recording'
            }
            sx={{
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              width: 32,
              height: 32,
              '&:hover': {
                bgcolor: 'primary.dark'
              }
            }}>
            
            {finished ?
            <ReplayIcon fontSize="small" /> :
            playing ?
            <PauseIcon fontSize="small" /> :

            <PlayArrowIcon fontSize="small" />
            }
          </IconButton>
        </Tooltip>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
            minWidth: 76
          }}>
          
          {formatTime(current)} / {formatTime(total)}
        </Typography>

        <Slider
          size="small"
          value={current}
          max={total || 1}
          onChange={(_, v) => {
            const next = Array.isArray(v) ? v[0] : v;
            setCurrent(next);
            if (next < total) setPlaying((p) => p);
          }}
          aria-label="Seek recording"
          sx={{
            flex: 1,
            color: accent,
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12
            }
          }} />
        

        <Tooltip title={muted ? 'Unmute' : 'Mute'}>
          <IconButton
            size="small"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute recording' : 'Mute recording'}
            sx={{
              color: 'text.secondary'
            }}>
            
            {muted ?
            <VolumeOffIcon fontSize="small" /> :

            <VolumeUpIcon fontSize="small" />
            }
          </IconButton>
        </Tooltip>
      </Stack>

      <Button
        size="small"
        startIcon={<OpenInNewIcon fontSize="small" />}
        sx={{
          mt: 0.75,
          color: 'text.secondary'
        }}>
        
        Open recording
      </Button>
    </Box>);

}