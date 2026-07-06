"use client";
import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Card,
  Stack,
  Typography,
  IconButton,
  Button,
  Avatar,
  CircularProgress,
  Tooltip } from
'@mui/material';
import CallEndIcon from '@mui/icons-material/CallEnd';
import VoicemailIcon from '@mui/icons-material/Voicemail';
import GraphicEqIcon from '@mui/icons-material/GraphicEqOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useTheme } from '@mui/material/styles';
import { agentAvatar } from '../data/inboxData';
import type { IrisPalette } from '../theme/tokens';

type LiveTurn = { speaker: 'ai' | 'lead'; text: string };

interface LiveCallPanelProps {
  callId: string;
  contactName: string;
  onClose: () => void;
}

const POLL_MS = 1500;

function statusLabel(status: string, isVoicemail: boolean, iris: IrisPalette): { text: string; color: string } {
  if (isVoicemail) return { text: 'Voicemail detected', color: iris.warning };
  switch (status) {
    case 'queued':
      return { text: 'Queued', color: iris.textSubtle };
    case 'ringing':
      return { text: 'Ringing…', color: iris.info };
    case 'in-progress':
      return { text: 'Connected', color: iris.success };
    case 'forwarding':
      return { text: 'Transferring…', color: iris.accent };
    case 'ended':
      return { text: 'Call ended', color: iris.textSubtle };
    default:
      return { text: status, color: iris.textSubtle };
  }
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LiveCallPanel({ callId, contactName, onClose }: LiveCallPanelProps) {
  const theme = useTheme();
  const iris = theme.iris;
  const [status, setStatus] = useState('queued');
  const [isVoicemail, setIsVoicemail] = useState(false);
  const [transcript, setTranscript] = useState<LiveTurn[]>([]);
  const [duration, setDuration] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/voice/live?callId=${encodeURIComponent(callId)}&ts=${Date.now()}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled || !data.ok) return;
        setStatus(data.status);
        setIsVoicemail(data.isVoicemail);
        setTranscript(data.transcript || []);
        setDuration(data.durationSec || 0);
        if (data.recordingUrl) setRecordingUrl(data.recordingUrl);
        if (data.status === 'ended') endedRef.current = true;
      } catch {
        if (!cancelled) setError('Lost connection to call status');
      }
    };
    poll();
    const id = setInterval(() => {
      if (endedRef.current) {
        clearInterval(id);
        return;
      }
      poll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [callId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript]);

  const handleEnd = async () => {
    endedRef.current = true;
    setStatus('ended');
    try {
      await fetch('/api/voice/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      });
    } catch {
      // best-effort — Vapi may already have ended
    }
  };

  const sl = statusLabel(status, isVoicemail, iris);
  const ended = status === 'ended';
  const live = status === 'in-progress' || status === 'ringing' || status === 'forwarding';

  return (
    <Card
      sx={{
        border: '1px solid',
        borderColor: isVoicemail ? 'warning.main' : live ? 'success.main' : 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        mb: 2,
      }}>
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{
          p: 1.75,
          bgcolor: isVoicemail ? iris.warningSoft : live ? iris.successSoft : 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}>
        <Box sx={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
          <Avatar src={agentAvatar} alt="Iris AI" sx={{ width: 36, height: 36 }} />
          {live && (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                inset: -3,
                borderRadius: '50%',
                border: '2px solid',
                borderColor: iris.accent,
                animation: 'irisCallRipple 2.2s infinite',
                '@keyframes irisCallRipple': {
                  '0%': { transform: 'scale(0.85)', opacity: 0.9 },
                  '100%': { transform: 'scale(1.5)', opacity: 0 },
                },
              }}
            />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {live ? 'Iris is calling' : 'Call'} {contactName}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: sl.color, animation: live ? 'pulse 1.4s infinite' : 'none', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } } }} />
            <Typography variant="caption" sx={{ color: sl.color, fontWeight: 700 }}>
              {sl.text}
            </Typography>
            {(live || ended) && (
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', ml: 0.5 }}>
                {fmt(duration)}
              </Typography>
            )}
          </Stack>
        </Box>
        {isVoicemail && <VoicemailIcon sx={{ color: 'warning.main' }} aria-hidden />}
        {ended ? (
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} aria-label="Close call panel">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="End call">
            <IconButton
              size="small"
              onClick={handleEnd}
              aria-label="End call"
              sx={{ bgcolor: 'error.main', color: '#fff', '&:hover': { bgcolor: 'error.dark' } }}>
              <CallEndIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {/* Live transcript */}
      <Box
        ref={scrollRef}
        sx={{ maxHeight: 280, overflowY: 'auto', p: 2, bgcolor: 'background.default' }}
        role="log"
        aria-label="Live call transcript"
        aria-live="polite">
        {error && (
          <Typography variant="caption" color="error.main" sx={{ display: 'block', mb: 1 }}>
            {error}
          </Typography>
        )}
        {transcript.length === 0 ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2, justifyContent: 'center' }}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">
              {status === 'ringing' ? 'Waiting for answer…' : 'Connecting…'}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1.25}>
            {transcript.map((turn, i) => {
              const isAI = turn.speaker === 'ai';
              return (
                <Box key={i} sx={{ display: 'flex', justifyContent: isAI ? 'flex-end' : 'flex-start' }}>
                  <Box sx={{ maxWidth: '78%' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: isAI ? 'primary.main' : 'text.secondary', display: 'block', mb: 0.25, textAlign: isAI ? 'right' : 'left' }}>
                      {isAI ? 'Iris' : contactName}
                    </Typography>
                    <Box
                      sx={{
                        px: 1.5,
                        py: 1,
                        borderRadius: 2.5,
                        borderTopRightRadius: isAI ? 4 : 20,
                        borderTopLeftRadius: isAI ? 20 : 4,
                        bgcolor: isAI ? 'primary.main' : 'background.paper',
                        color: isAI ? 'primary.contrastText' : 'text.primary',
                        border: isAI ? 'none' : '1px solid',
                        borderColor: 'divider',
                      }}>
                      <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                        {turn.text}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>

      {/* Ended footer */}
      {ended && (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <GraphicEqIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden />
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {isVoicemail ? 'Voicemail left. Saved to the thread.' : 'Call complete. Transcript saved to the thread.'}
          </Typography>
          {recordingUrl && (
            <Button size="small" component="a" href={recordingUrl} target="_blank" rel="noopener noreferrer">
              Recording
            </Button>
          )}
        </Stack>
      )}
    </Card>
  );
}
