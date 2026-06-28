"use client";
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Chip, Stack, Typography, Button, TextField, IconButton, CircularProgress, Tooltip } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFileOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import CircleIcon from '@mui/icons-material/Circle';
import KeyboardVoiceIcon from '@mui/icons-material/KeyboardVoiceOutlined';
import MicIcon from '@mui/icons-material/MicOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAltOutlined';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToyOutlined';
import StopCircleIcon from '@mui/icons-material/StopCircleOutlined';

type ManualChannel = 'email' | 'sms' | 'whatsapp' | 'instagram' | 'messenger' | 'website';

interface ReaderFooterProps {
  threadId?: string;
  channel?: ManualChannel;
  to?: string;
  subject?: string;
  disabledReason?: string;
}

type QueuedAttachment = { url: string; filename: string; transcript?: string; kind?: 'voice-note' | 'file' };

const VOICE_CLONE_ID_KEY = 'iris.operator.cartesiaVoiceId';
const VOICE_CLONE_META_KEY = 'iris.operator.cartesiaVoiceMeta';

type SavedVoiceCloneMeta = {
  title?: string;
  state?: string;
  savedAt?: string;
};

function shortVoiceId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}...` : id;
}

function RecordingWaveform({ seconds }: { seconds: number }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        flex: 1,
        minWidth: 0,
        height: 42,
        px: 1.25,
        borderRadius: 999,
        bgcolor: (theme) => theme.palette.mode === 'dark' ? '#08090d' : '#111827',
        color: '#ff365f',
        border: '1px solid',
        borderColor: 'rgba(255,54,95,0.22)'
      }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', flex: 1, minWidth: 0, height: 22, overflow: 'hidden' }}>
        {Array.from({ length: 38 }).map((_, index) => (
          <Box
            key={index}
            sx={{
              width: 2,
              borderRadius: 999,
              bgcolor: '#ff365f',
              height: `${7 + ((index * 13) % 18)}px`,
              animation: 'irisWavePulse 620ms ease-in-out infinite',
              animationDelay: `${index * 28}ms`,
              '@keyframes irisWavePulse': {
                '0%, 100%': { transform: 'scaleY(0.55)', opacity: 0.62 },
                '50%': { transform: 'scaleY(1.15)', opacity: 1 }
              }
            }}
          />
        ))}
      </Box>
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#ff365f', fontVariantNumeric: 'tabular-nums' }}>
        0:{String(seconds).padStart(2, '0')}
      </Typography>
    </Stack>
  );
}

export function ReaderFooter({ threadId, channel = 'sms', to, subject, disabledReason }: ReaderFooterProps) {
  const [takenOver, setTakenOver] = useState(false);
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<QueuedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [cloningVoice, setCloningVoice] = useState(false);
  const [voiceCloneStatus, setVoiceCloneStatus] = useState('');
  const [voiceCloneId, setVoiceCloneId] = useState('');
  const [voiceCloneMeta, setVoiceCloneMeta] = useState<SavedVoiceCloneMeta | null>(null);
  const [handingBack, setHandingBack] = useState(false);
  const [loadingTakeover, setLoadingTakeover] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceCloneInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const canSendChannel = channel !== 'website';
  const sendTarget = to || threadId || '';

  useEffect(() => {
    const savedVoiceId = window.localStorage.getItem(VOICE_CLONE_ID_KEY);
    if (savedVoiceId) setVoiceCloneId(savedVoiceId);
    const savedMeta = window.localStorage.getItem(VOICE_CLONE_META_KEY);
    if (savedMeta) {
      try {
        setVoiceCloneMeta(JSON.parse(savedMeta) as SavedVoiceCloneMeta);
      } catch {
        window.localStorage.removeItem(VOICE_CLONE_META_KEY);
      }
    }
  }, []);

  useEffect(() => {
    setTakenOver(false);
    setMessage('');
    setAttachments([]);
    setError('');
    if (!threadId) return undefined;

    const controller = new AbortController();
    setLoadingTakeover(true);
    fetch(`/api/threads/${encodeURIComponent(threadId)}/takeover`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not read takeover state.');
        setTakenOver(Boolean(data.isActive));
      })
      .catch((takeoverStateError) => {
        if (controller.signal.aborted) return;
        setError(takeoverStateError instanceof Error ? takeoverStateError.message : 'Could not read takeover state.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTakeover(false);
      });

    return () => controller.abort();
  }, [threadId]);

  const handleTakeOver = async () => {
    if (!threadId) {
      setError('Thread is not ready for takeover.');
      return;
    }
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    setError('');
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'take', channel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not take over this thread.');
      setTakenOver(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (takeoverError) {
      setError(takeoverError instanceof Error ? takeoverError.message : 'Could not take over this thread.');
    }
  };

  useEffect(() => {
    if (!recordingVoice) {
      setRecordingSeconds(0);
      return undefined;
    }
    const tick = () => setRecordingSeconds(Math.max(0, Math.round((Date.now() - recordingStartedAtRef.current) / 1000)));
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [recordingVoice]);

  useEffect(() => {
    if (!takenOver || !disabledReason || !threadId) return;
    setTakenOver(false);
    setMessage('');
    setAttachments([]);
    void fetch(`/api/threads/${encodeURIComponent(threadId)}/takeover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release', channel }),
    }).catch(() => {});
  }, [channel, disabledReason, takenOver, threadId]);

  const uploadFiles = async (files: FileList | File[]): Promise<QueuedAttachment[]> => {
    if (!threadId || !files.length) return [];
    setUploading(true);
    setError('');
    try {
      const uploaded: QueuedAttachment[] = [];
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.set('file', file);
        const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/upload`, { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `Could not upload ${file.name}`);
        uploaded.push({ url: data.url, filename: data.filename || file.name, kind: 'file' });
      }
      setAttachments((current) => [...current, ...uploaded]);
      return uploaded;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload attachment.');
      return [];
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      void uploadFiles(files);
    }
  };

  const handleSend = async () => {
    const body = message.trim();
    if ((!body && !attachments.length) || sending || !threadId || !sendTarget || !canSendChannel) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          to: sendTarget,
          body,
          subject,
          mediaUrls: attachments.map((attachment) => attachment.url),
          mediaTranscripts: attachments
            .filter((attachment) => attachment.transcript?.trim())
            .map((attachment) => ({ url: attachment.url, text: attachment.transcript?.trim() })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Message did not send.');
      setMessage('');
      setAttachments([]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Message did not send.');
    } finally {
      setSending(false);
    }
  };

  const handleGenerateVoiceNote = async () => {
    const text = message.trim();
    if (!text || !threadId || !canSendChannel) return;
    setGeneratingVoice(true);
    setError('');
    try {
      const res = await fetch('/api/media/voice-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId: voiceCloneId || undefined, threadRef: threadId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.url) throw new Error(data.error || 'Voice note could not be generated.');
      setAttachments((current) => [...current, {
        url: String(data.url),
        filename: String(data.filename || 'voice-note.mp3'),
        transcript: text,
        kind: 'voice-note',
      }]);
      setMessage('');
    } catch (voiceError) {
      setError(voiceError instanceof Error ? voiceError.message : 'Voice note could not be generated.');
    } finally {
      setGeneratingVoice(false);
    }
  };

  const transcribeBlob = async (blob: Blob): Promise<string> => {
    try {
      const file = new File([blob], `manual-voice-transcript-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/media/transcribe', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) return '';
      return String(data.text || '').trim();
    } catch {
      return '';
    }
  };

  const uploadRecordedVoice = async (blob: Blob) => {
    const type = (blob.type || 'audio/webm').split(';')[0] || 'audio/webm';
    const extension = type.includes('ogg') ? 'ogg' : type.includes('mpeg') || type.includes('mp3') ? 'mp3' : 'webm';
    const file = new File([blob], `manual-voice-note-${Date.now()}.${extension}`, { type });
    const [uploaded] = await uploadFiles([file]);
    if (!uploaded) return;
    const transcript = await transcribeBlob(blob);
    if (!transcript) return;
    setAttachments((current) => current.map((attachment) => attachment.url === uploaded.url ? { ...attachment, transcript, kind: 'voice-note' } : attachment));
  };

  const cleanupRecordingStream = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  const handleStartManualVoiceNote = async () => {
    if (!threadId || !canSendChannel || recordingVoice) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Browser microphone recording is not available here.');
      return;
    }
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : '';
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError('Voice note recording failed.');
        setRecordingVoice(false);
        cleanupRecordingStream();
      };
      recorder.onstop = () => {
        const chunks = [...recordingChunksRef.current];
        const mimeType = recorder.mimeType || 'audio/webm';
        setRecordingVoice(false);
        cleanupRecordingStream();
        mediaRecorderRef.current = null;
        recordingChunksRef.current = [];
        if (chunks.length) void uploadRecordedVoice(new Blob(chunks, { type: mimeType }));
      };
      recorder.start(250);
      setRecordingVoice(true);
    } catch (recordError) {
      cleanupRecordingStream();
      setRecordingVoice(false);
      setError(recordError instanceof Error ? recordError.message : 'Microphone access was blocked.');
    }
  };

  const handleStopManualVoiceNote = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      setRecordingVoice(false);
      cleanupRecordingStream();
    }
  };

  const handleCloneVoice = async (files: FileList | null) => {
    if (!files?.length) return;
    setCloningVoice(true);
    setVoiceCloneStatus('');
    setError('');
    try {
      const form = new FormData();
      form.set('file', files[0]);
      form.set('title', 'Iris operator voice');
      const res = await fetch('/api/media/voice-clone', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.voiceId) throw new Error(data.error || 'Voice clone could not be created.');
      const nextVoiceId = String(data.voiceId);
      const nextMeta: SavedVoiceCloneMeta = {
        title: String(data.title || 'Operator voice'),
        state: data.state ? String(data.state) : undefined,
        savedAt: new Date().toISOString(),
      };
      setVoiceCloneId(nextVoiceId);
      setVoiceCloneMeta(nextMeta);
      window.localStorage.setItem(VOICE_CLONE_ID_KEY, nextVoiceId);
      window.localStorage.setItem(VOICE_CLONE_META_KEY, JSON.stringify(nextMeta));
      setVoiceCloneStatus(`Voice clone saved: ${shortVoiceId(nextVoiceId)}`);
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : 'Voice clone could not be created.');
    } finally {
      setCloningVoice(false);
      if (voiceCloneInputRef.current) voiceCloneInputRef.current.value = '';
    }
  };

  const handleResetVoiceClone = () => {
    setVoiceCloneId('');
    setVoiceCloneMeta(null);
    setVoiceCloneStatus('Saved voice clone cleared.');
    window.localStorage.removeItem(VOICE_CLONE_ID_KEY);
    window.localStorage.removeItem(VOICE_CLONE_META_KEY);
  };

  const handleHandBack = async () => {
    if (!threadId) return;
    setHandingBack(true);
    setError('');
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release', channel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Could not hand back this thread.');
      setTakenOver(false);
      setMessage('');
      setAttachments([]);
    } catch (handbackError) {
      setError(handbackError instanceof Error ? handbackError.message : 'Could not hand back this thread.');
    } finally {
      setHandingBack(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!takenOver) {
    return (
      <>
        <Box
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            p: 1.5,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            bgcolor: 'background.paper',
          }}
        >
          <Stack direction="row" spacing={0.75} alignItems="center">
            <CircleIcon sx={{ fontSize: 10, color: 'success.main' }} />
            <Typography variant="body2" color="text.secondary">
              AI active
            </Typography>
          </Stack>
          <Button
            variant="outlined"
            size="small"
            onClick={handleTakeOver}
            disabled={!threadId || loadingTakeover || Boolean(disabledReason)}
            startIcon={loadingTakeover ? <CircularProgress size={12} /> : undefined}
          >
            {loadingTakeover ? 'Checking' : 'Take over'}
          </Button>
        </Box>
      {(error || disabledReason) && (
        <Alert severity="warning" sx={{ m: 1.25, mt: 0 }}>
          {error || disabledReason}
        </Alert>
      )}
      </>
    );
  }

  const sendDisabled = (!message.trim() && !attachments.length)
    || sending
    || uploading
    || generatingVoice
    || recordingVoice
    || !threadId
    || !sendTarget
    || !canSendChannel
    || Boolean(disabledReason);
  const hasQueuedVoiceNote = attachments.some((attachment) => attachment.kind === 'voice-note');
  const sendTooltip = hasQueuedVoiceNote && !message.trim()
    ? 'Send queued voice note'
    : hasQueuedVoiceNote
      ? 'Send message and queued voice note'
      : 'Send message';

  return (
    <Box
      sx={{
        borderTop: '1px solid',
        borderColor: 'warning.main',
        bgcolor: 'background.paper',
      }}
    >
      {/* Takeover banner */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ px: 1.5, py: 0.75, bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)' }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center">
          <CircleIcon sx={{ fontSize: 10, color: 'warning.main' }} />
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'warning.main' }}>
            You have control
          </Typography>
        </Stack>
        <Tooltip title="Hand conversation back to AI">
          <Button
            size="small"
            variant="text"
            startIcon={handingBack ? <CircularProgress size={12} /> : <SmartToyIcon sx={{ fontSize: 14 }} />}
            onClick={handleHandBack}
            disabled={handingBack}
            sx={{ color: 'text.secondary', fontSize: 11 }}
          >
            Hand back to AI
          </Button>
        </Tooltip>
      </Stack>

      {(error || disabledReason) && <Alert severity="warning" sx={{ mx: 1.25, mt: 1 }}>{error || disabledReason}</Alert>}
      {voiceCloneStatus && <Alert severity="success" sx={{ mx: 1.25, mt: 1 }}>{voiceCloneStatus}</Alert>}
      {!canSendChannel && <Alert severity="info" sx={{ mx: 1.25, mt: 1 }}>Website chat manual send is not wired yet.</Alert>}

      {voiceCloneId && (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1.25, pt: 1 }}>
          <Tooltip title={`Saved Cartesia clone ${shortVoiceId(voiceCloneId)}${voiceCloneMeta?.state ? ` (${voiceCloneMeta.state})` : ''}. Generated voice notes use this voice until reset.`}>
            <Chip
              size="small"
              color="success"
              variant="outlined"
              icon={<CheckCircleIcon />}
              label={voiceCloneMeta?.title || 'Voice saved'}
              sx={{
                maxWidth: 220,
                '& .MuiChip-label': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              }}
            />
          </Tooltip>
          <Tooltip title="Reset saved clone and use the default Cartesia voice">
            <span>
              <IconButton
                size="small"
                onClick={handleResetVoiceClone}
                disabled={generatingVoice || cloningVoice || recordingVoice}
                aria-label="Reset saved voice clone"
                sx={{
                  width: 28,
                  height: 28,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.25,
                  '&:hover': {
                    borderColor: 'warning.main',
                    color: 'warning.main',
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)',
                  },
                }}>
                <RestartAltIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )}

      {!!attachments.length && (
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ px: 1.25, pt: 1 }}>
          {attachments.map((attachment) => (
            <Tooltip
              key={attachment.url}
              title={attachment.kind === 'voice-note' ? 'Voice note is ready. Press the send arrow to deliver it.' : attachment.filename}
            >
              <Chip
                size="small"
                color={attachment.kind === 'voice-note' ? 'primary' : 'default'}
                variant={attachment.kind === 'voice-note' ? 'outlined' : 'filled'}
                icon={attachment.kind === 'voice-note' ? <SendIcon /> : undefined}
                label={attachment.kind === 'voice-note'
                  ? 'Voice note ready to send'
                  : attachment.transcript
                    ? `${attachment.filename} · transcript ready`
                    : attachment.filename}
                onDelete={() => setAttachments((current) => current.filter((item) => item.url !== attachment.url))}
                deleteIcon={<CloseIcon />}
                sx={{
                  maxWidth: attachment.kind === 'voice-note' ? 210 : 260,
                  borderColor: attachment.kind === 'voice-note' ? 'primary.main' : undefined,
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                }}
              />
            </Tooltip>
          ))}
        </Stack>
      )}

      {/* Message input */}
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
        sx={{ p: 1.25, display: 'flex', gap: 1, alignItems: 'flex-end' }}
      >
        <input
          ref={fileInputRef}
          hidden
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,audio/aac,audio/m4a,audio/mpeg,audio/mp3,audio/mp4,audio/ogg,audio/wav,audio/webm,application/pdf"
          onChange={(event) => event.target.files && void uploadFiles(event.target.files)}
        />
        <input
          ref={voiceCloneInputRef}
          hidden
          type="file"
          accept="audio/aac,audio/m4a,audio/mpeg,audio/mp3,audio/mp4,audio/ogg,audio/wav,audio/webm,video/webm"
          onChange={(event) => void handleCloneVoice(event.target.files)}
        />
        <Tooltip title="Attach image, audio, PDF, or video">
          <span>
            <IconButton
              size="small"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !threadId || !canSendChannel}
              sx={{ flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, width: 34, height: 34 }}
              aria-label="Attach file">
              {uploading ? <CircularProgress size={14} /> : <AttachFileIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </span>
        </Tooltip>
        {recordingVoice && <RecordingWaveform seconds={recordingSeconds} />}
        <Tooltip title={recordingVoice ? 'Stop recording manual voice note' : 'Record manual voice note'}>
          <span>
            <IconButton
              size="small"
              onClick={recordingVoice ? handleStopManualVoiceNote : handleStartManualVoiceNote}
              disabled={uploading || sending || !threadId || !canSendChannel}
              sx={{
                flexShrink: 0,
                border: '1px solid',
                borderColor: recordingVoice ? '#ff365f' : 'divider',
                bgcolor: recordingVoice ? '#ff365f' : 'transparent',
                color: recordingVoice ? '#fff' : 'inherit',
                borderRadius: 1.5,
                width: 34,
                height: 34,
                '&:hover': { bgcolor: recordingVoice ? '#e11d48' : undefined },
              }}
              aria-label={recordingVoice ? 'Stop recording manual voice note' : 'Record manual voice note'}>
              {recordingVoice ? <StopCircleIcon sx={{ fontSize: 16 }} /> : <MicIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={voiceCloneId ? `Generate voice note with saved clone ${shortVoiceId(voiceCloneId)}` : 'Generate voice note with the default Cartesia voice'}>
          <span>
            <IconButton
              size="small"
              onClick={handleGenerateVoiceNote}
              disabled={generatingVoice || recordingVoice || !message.trim() || !threadId || !canSendChannel}
              sx={{
                flexShrink: 0,
                border: '1px solid',
                borderColor: voiceCloneId ? 'success.main' : 'divider',
                borderRadius: 1.5,
                width: 34,
                height: 34,
                '&:hover': {
                  borderColor: voiceCloneId ? 'success.main' : 'primary.main',
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(124,92,255,0.12)' : 'rgba(124,92,255,0.08)',
                },
              }}
              aria-label="Generate cloned AI voice note">
              {generatingVoice ? <CircularProgress size={14} /> : <KeyboardVoiceIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={voiceCloneId ? 'Replace saved operator voice clone' : 'Clone and save operator voice from an audio sample'}>
          <span>
            <IconButton
              size="small"
              onClick={() => voiceCloneInputRef.current?.click()}
              disabled={cloningVoice || recordingVoice || !threadId || !canSendChannel}
              sx={{
                flexShrink: 0,
                border: '1px solid',
                borderColor: voiceCloneId ? 'success.main' : 'divider',
                borderRadius: 1.5,
                width: 34,
                height: 34,
                '&:hover': {
                  borderColor: 'success.main',
                  color: 'success.main',
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.08)',
                },
              }}
              aria-label="Clone operator voice">
              {cloningVoice ? <CircularProgress size={14} /> : <RecordVoiceOverIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </span>
        </Tooltip>
        {!recordingVoice && <TextField
          inputRef={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder={channel === 'email' ? 'Write an email reply…' : 'Send a message…'}
          multiline
          maxRows={5}
          size="small"
          fullWidth
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
        />}
        <Tooltip title={sendTooltip}>
          <span>
            <IconButton
              type="submit"
              disabled={sendDisabled}
              size="small"
              color="primary"
              sx={{
                flexShrink: 0,
                border: '1px solid',
                borderColor: hasQueuedVoiceNote ? 'primary.main' : 'divider',
                bgcolor: hasQueuedVoiceNote ? 'primary.main' : 'transparent',
                color: hasQueuedVoiceNote ? 'primary.contrastText' : 'inherit',
                borderRadius: 1.5,
                width: 34,
                height: 34,
                '&:hover': {
                  bgcolor: hasQueuedVoiceNote ? 'primary.dark' : undefined,
                  borderColor: 'primary.main',
                },
              }}
              aria-label={sendTooltip}
            >
              {sending ? <CircularProgress size={14} /> : <SendIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
