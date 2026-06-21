"use client";
import React, { useRef, useState } from 'react';
import { Box, Stack, Typography, Button, TextField, IconButton, CircularProgress, Tooltip } from '@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToyOutlined';

interface ReaderFooterProps {
  threadId?: string;
  channel?: 'email' | 'sms';
}

export function ReaderFooter({ threadId, channel = 'sms' }: ReaderFooterProps) {
  const [takenOver, setTakenOver] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [handingBack, setHandingBack] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleTakeOver = () => {
    setTakenOver(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSend = async () => {
    const body = message.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await fetch('/api/takeover/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, channel, message: body }),
      });
      setMessage('');
    } finally {
      setSending(false);
    }
  };

  const handleHandBack = async () => {
    setHandingBack(true);
    try {
      await fetch('/api/takeover/handback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, channel }),
      });
      setTakenOver(false);
      setMessage('');
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
        <Button variant="outlined" size="small" onClick={handleTakeOver}>
          Take over
        </Button>
      </Box>
    );
  }

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

      {/* Message input */}
      <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ p: 1.25 }}>
        <TextField
          inputRef={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
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
          disabled={!message.trim() || sending}
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
