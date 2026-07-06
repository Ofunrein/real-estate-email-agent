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
  CircularProgress,
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
import PhoneIcon from '@mui/icons-material/Phone';
import { useTheme } from '@mui/material/styles';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { LiveCallPanel } from './LiveCallPanel';
import {
  agentAvatar,
  type Call,
  type CallOutcome } from
'../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { clearActivityEventTarget, useActivityEventTarget } from '../hooks/useActivityEventTarget';
import { usePersistedSelection } from '../hooks/usePersistedSelection';
import type { IrisPalette } from '../theme/tokens';
function outcomeColor(outcome: CallOutcome, iris: IrisPalette): string {
  const map: Record<CallOutcome, string> = {
    voicemail: iris.warning,
    'silence-timed-out': iris.textSubtle,
    'assistant-forwarded-call': iris.info,
    'assistant-ended-call': iris.success
  };
  return map[outcome];
}
export function VoiceView() {
  const { voiceContacts } = useInboxModel();
  const voiceContactIds = React.useMemo(
    () => voiceContacts.map((c) => c.id),
    [voiceContacts]
  );
  const [selectedId, setSelectedId] = usePersistedSelection(
    'iris.inbox.voice.thread',
    voiceContactIds[0] ?? '',
    voiceContactIds
  );
  const contact =
  voiceContacts.find((c) => c.id === selectedId) ?? voiceContacts[0];
  const readerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [dialing, setDialing] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);
  const targetEventId = useActivityEventTarget('voice', contact?.id);
  const callRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!targetEventId || scrolledTargetRef.current === targetEventId) return;
    const target = callRefs.current.get(targetEventId);
    if (!target) return;
    scrolledTargetRef.current = targetEventId;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearActivityEventTarget();
    });
  }, [targetEventId, contact?.id]);
  useEffect(() => {
    if (targetEventId || !scrollRef.current) return;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
  }, [targetEventId, contact?.id, contact?.calls.length]);
  const handleSelect = (id: string) => {
    clearActivityEventTarget();
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
  const handleCall = async () => {
    if (!contact?.phone || dialing) return;
    setDialing(true);
    setDialError(null);
    try {
      const res = await fetch('/api/voice/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: contact.phone,
          leadName: contact.contact,
          summary: contact.summary,
        }),
      });
      const data = await res.json();
      if (data.ok && data.callId) {
        setActiveCallId(data.callId);
      } else {
        setDialError(data.error || 'Could not start call');
      }
    } catch {
      setDialError('Could not reach the call service');
    } finally {
      setDialing(false);
    }
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
            meta: `${c.phone ? `${c.phone} · ` : ''}${c.callCount} call${c.callCount > 1 ? 's' : ''} · Recording`
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
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1">{contact.contact}</Typography>
              <Typography variant="caption" color="text.secondary">
                {contact.phone ? `${contact.phone} · ` : ''}{contact.callCount} calls · {contact.tag}
              </Typography>
            </Box>
            <Tooltip title={contact.phone ? `Call ${contact.contact} with Iris` : 'No phone number on file'}>
              <span>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={dialing ? <CircularProgress size={14} color="inherit" /> : <PhoneIcon fontSize="small" />}
                  onClick={handleCall}
                  disabled={!contact.phone || dialing || Boolean(activeCallId)}
                  disableElevation
                  sx={{ flexShrink: 0 }}>
                  {dialing ? 'Calling…' : 'Call lead'}
                </Button>
              </span>
            </Tooltip>
          </Box>

          {dialError &&
          <Box sx={{ px: 1.75, py: 1, bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.07)' }}>
            <Typography variant="caption" color="error.main">{dialError}</Typography>
          </Box>
          }

          <Box
            ref={scrollRef}
            sx={{
              flex: 1,
              overflowY: 'auto',
              p: 2
            }}>

            {activeCallId &&
            <LiveCallPanel
              callId={activeCallId}
              contactName={contact.contact}
              onClose={() => setActiveCallId(null)} />
            }
            <Stack spacing={2}>
              {contact.calls.map((call) =>
              <CallCard
                key={call.id}
                call={call}
                highlighted={call.id === targetEventId}
                registerTarget={(node) => {
                  if (node) callRefs.current.set(call.id, node);
                  else callRefs.current.delete(call.id);
                }} />
              )}
            </Stack>
          </Box>

          <ReaderFooter />
        </Card>
      </Box>
    </Box>);

}
function CallCard({ call, highlighted, registerTarget }: {call: Call;highlighted?: boolean;registerTarget?: (node: HTMLDivElement | null) => void;}) {
  const [rawOpen, setRawOpen] = useState(false);
  const theme = useTheme();
  const iris = theme.iris;
  const accent = outcomeColor(call.outcome, iris);
  return (
    <Card
      ref={registerTarget}
      variant="outlined"
      sx={{
        p: 1.75,
        scrollMargin: '24px',
        borderColor: highlighted ? 'primary.main' : undefined,
        boxShadow: highlighted ? `0 0 0 3px ${theme.palette.mode === 'dark' ? 'rgba(240,238,235,0.18)' : 'rgba(26,24,21,0.14)'}` : 'none'
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
                alt={isAgent ? 'Iris, AI agent' : undefined}
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
                  bgcolor: isAgent ? iris.accentSoft : 'action.hover'
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

      <RecordingPlayer
        duration={call.duration}
        accent={accent}
        recordingUrl={call.recordingUrl}
        transcript={call.report} />
    </Card>);

}
function parseDuration(value: string): number {
  if (!value) return 0;
  // Supports "M:SS" (e.g. "2:05") and "Xm Ys" / "Ys" (adapter format, e.g. "2m 5s", "45s").
  if (value.includes(':')) {
    const parts = value.split(':').map((p) => parseInt(p, 10));
    if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }
  let secs = 0;
  const min = value.match(/(\d+)\s*m/);
  const sec = value.match(/(\d+)\s*s/);
  if (min) secs += parseInt(min[1], 10) * 60;
  if (sec) secs += parseInt(sec[1], 10);
  return secs;
}
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
// Deterministic bar heights derived from duration — not real audio amplitude.
// Same seed always produces the same pattern for a given call/duration.
function waveformBars(seed: number, count = 28): number[] {
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const frac = x - Math.floor(x);
    bars.push(0.28 + frac * 0.72);
  }
  return bars;
}
function RecordingPlayer({
  duration,
  accent,
  recordingUrl,
  transcript

}: {duration: string;accent: string;recordingUrl?: string;transcript?: string;}) {
  const theme = useTheme();
  const iris = theme.iris;
  const fallbackTotal = parseDuration(duration);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(false);
  const [audioTotal, setAudioTotal] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasRecording = Boolean(recordingUrl);
  const proxiedRecordingUrl = recordingUrl
    ? /^https:\/\/(?:storage|recordings)\.vapi\.ai\//i.test(recordingUrl)
      ? recordingUrl
      : `/api/media/audio?url=${encodeURIComponent(recordingUrl)}`
    : '';
  const total = hasRecording ? audioTotal || fallbackTotal : fallbackTotal;
  const bars = React.useMemo(() => waveformBars(fallbackTotal || 1), [fallbackTotal]);

  // Real audio playback when a recording URL exists.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setAudioTotal(el.duration || 0);
    const onEnd = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, [recordingUrl]);

  // Simulated timer fallback only when there's no real recording.
  useEffect(() => {
    if (hasRecording) return;
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrent((c) => {
          if (c + 1 >= fallbackTotal) {
            setPlaying(false);
            return fallbackTotal;
          }
          return c + 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, fallbackTotal, hasRecording]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  const finished = current >= total && total > 0;
  const progress = total > 0 ? Math.min(1, current / total) : 0;
  const playedBars = Math.round(progress * bars.length);

  const togglePlay = () => {
    const el = audioRef.current;
    if (hasRecording && el) {
      if (finished) {
        el.currentTime = 0;
        void el.play().catch(() => setPlaying(false));
        setPlaying(true);
      } else if (playing) {
        el.pause();
        setPlaying(false);
      } else {
        void el.play().catch(() => setPlaying(false));
        setPlaying(true);
      }
      return;
    }
    if (finished) {
      setCurrent(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };

  const seek = (next: number) => {
    setCurrent(next);
    if (hasRecording && audioRef.current) audioRef.current.currentTime = next;
  };

  return (
    <Box
      sx={{
        mt: 1.5
      }}>

      {hasRecording &&
      <audio ref={audioRef} src={proxiedRecordingUrl} preload="metadata" />
      }
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
      {!hasRecording &&
      <Typography
        variant="caption"
        color="text.disabled"
        sx={{
          display: 'block',
          mb: 0.75
        }}>

        No recording available for this call.
      </Typography>
      }

      {/* Voice-note waveform card — deterministic bar pattern derived from
          duration, not real amplitude. Accent = played, muted tone = unplayed. */}
      <Box
        sx={{
          p: 1.25,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'action.hover',
          opacity: hasRecording || fallbackTotal > 0 ? 1 : 0.55
        }}>

        <Stack direction="row" spacing={1.25} alignItems="center">
          <Tooltip title={finished ? 'Replay' : playing ? 'Pause' : 'Play'}>
            <span>
            <IconButton
              size="small"
              disabled={!hasRecording && fallbackTotal === 0}
              onClick={togglePlay}
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
                width: 34,
                height: 34,
                flexShrink: 0,
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
            </span>
          </Tooltip>

          <Box
            role="slider"
            aria-label="Seek recording"
            aria-valuemin={0}
            aria-valuemax={total || 1}
            aria-valuenow={current}
            tabIndex={hasRecording || fallbackTotal > 0 ? 0 : -1}
            onClick={(e) => {
              if (!(hasRecording || fallbackTotal > 0)) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              seek(ratio * (total || 0));
            }}
            onKeyDown={(e) => {
              if (!(hasRecording || fallbackTotal > 0) || !total) return;
              if (e.key === 'ArrowRight') seek(Math.min(total, current + 5));
              else if (e.key === 'ArrowLeft') seek(Math.max(0, current - 5));
            }}
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              height: 28,
              cursor: hasRecording || fallbackTotal > 0 ? 'pointer' : 'default'
            }}>

            {bars.map((h, i) => (
              <Box
                key={i}
                sx={{
                  flex: 1,
                  height: `${Math.round(h * 100)}%`,
                  minHeight: 3,
                  borderRadius: 999,
                  bgcolor: i < playedBars ? accent : iris.textSubtle,
                  opacity: i < playedBars ? 0.95 : 0.35,
                  transition: 'opacity 0.15s'
                }} />
            ))}
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
              minWidth: 76,
              textAlign: 'right'
            }}>

            {formatTime(current)} / {formatTime(total)}
          </Typography>

          <Tooltip title={muted ? 'Unmute' : 'Mute'}>
            <IconButton
              size="small"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute recording' : 'Mute recording'}
              sx={{
                color: 'text.secondary',
                flexShrink: 0
              }}>

              {muted ?
              <VolumeOffIcon fontSize="small" /> :

              <VolumeUpIcon fontSize="small" />
              }
            </IconButton>
          </Tooltip>
        </Stack>

        {transcript &&
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: 'block',
            mt: 1,
            pt: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
            lineHeight: 1.5
          }}>

          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>Transcript · </Box>
          {transcript}
        </Typography>
        }
      </Box>

      {hasRecording &&
      <Button
        size="small"
        component="a"
        href={recordingUrl}
        target="_blank"
        rel="noopener noreferrer"
        startIcon={<OpenInNewIcon fontSize="small" />}
        sx={{
          mt: 0.75,
          color: 'text.secondary'
        }}>

        Open recording
      </Button>
      }
    </Box>);

}
