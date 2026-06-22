"use client";
import React, { useRef, useState } from 'react';
import { Alert, Box, Chip, Stack, Typography, Button, TextField, IconButton, CircularProgress, Tooltip } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFileOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CircleIcon from '@mui/icons-material/Circle';
import KeyboardVoiceIcon from '@mui/icons-material/KeyboardVoiceOutlined';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToyOutlined';

type ManualChannel = 'email' | 'sms' | 'whatsapp' | 'instagram' | 'messenger' | 'website';

interface ReaderFooterProps {
  threadId?: string;
  channel?: ManualChannel;
  to?: string;
  subject?: string;
  disabledReason?: string;
}

type QueuedAttachment = { url: string; filename: string };

export function ReaderFooter({ threadId, channel = 'sms', to, subject, disabledReason }: ReaderFooterProps) {
  const [takenOver, setTakenOver] = useState(false);
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<QueuedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [handingBack, setHandingBack] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSendChannel = channel !== 'website';
  const sendTarget = to || threadId || '';

  const handleTakeOver = async () => {
    if (!threadId) {
      setError('Thread is not ready for takeover.');
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

  const uploadFiles = async (files: FileList | File[]) => {
    if (!threadId || !files.length) return;
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
        uploaded.push({ url: data.url, filename: data.filename || file.name });
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload attachment.');
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
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.url) throw new Error(data.error || 'Voice note could not be generated.');
      setAttachments((current) => [...current, {
        url: String(data.url),
        filename: String(data.filename || 'voice-note.mp3'),
      }]);
    } catch (voiceError) {
      setError(voiceError instanceof Error ? voiceError.message : 'Voice note could not be generated.');
    } finally {
      setGeneratingVoice(false);
    }
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
      handleSend();
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
          <Button variant="outlined" size="small" onClick={handleTakeOver} disabled={!threadId || Boolean(disabledReason)}>
            Take over
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

  const sendDisabled = (!message.trim() && !attachments.length) || sending || uploading || generatingVoice || !threadId || !sendTarget || !canSendChannel;

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

      {error && <Alert severity="warning" sx={{ mx: 1.25, mt: 1 }}>{error}</Alert>}
      {!canSendChannel && <Alert severity="info" sx={{ mx: 1.25, mt: 1 }}>Website chat manual send is not wired yet.</Alert>}

      {!!attachments.length && (
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ px: 1.25, pt: 1 }}>
          {attachments.map((attachment) => (
            <Chip
              key={attachment.url}
              size="small"
              label={attachment.filename}
              onDelete={() => setAttachments((current) => current.filter((item) => item.url !== attachment.url))}
              deleteIcon={<CloseIcon />}
            />
          ))}
        </Stack>
      )}

      {/* Message input */}
      <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ p: 1.25 }}>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,audio/aac,audio/m4a,audio/mpeg,audio/mp3,audio/mp4,audio/ogg,audio/wav,audio/webm,application/pdf"
          onChange={(event) => event.target.files && void uploadFiles(event.target.files)}
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
        <Tooltip title="Generate voice note from this reply">
          <span>
            <IconButton
              size="small"
              onClick={handleGenerateVoiceNote}
              disabled={generatingVoice || !message.trim() || !threadId || !canSendChannel}
              sx={{ flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, width: 34, height: 34 }}
              aria-label="Generate voice note">
              {generatingVoice ? <CircularProgress size={14} /> : <KeyboardVoiceIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </span>
        </Tooltip>
        <TextField
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
        />
        <IconButton
          onClick={handleSend}
          disabled={sendDisabled}
          size="small"
          color="primary"
          sx={{ flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, width: 34, height: 34 }}
          aria-label="Send message"
        >
          {sending ? <CircularProgress size={14} /> : <SendIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Stack>
    </Box>
  );
}
