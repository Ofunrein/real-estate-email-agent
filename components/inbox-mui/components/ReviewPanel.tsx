"use client";
import React, { useMemo, useState } from 'react';
import {
  Box,
  Card,
  Stack,
  Typography,
  Avatar,
  Chip,
  Button,
  IconButton,
  Divider,
  TextField,
  LinearProgress,
  Tooltip } from
'@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import EditIcon from '@mui/icons-material/EditOutlined';
import CloseIcon from '@mui/icons-material/Close';
import FlagIcon from '@mui/icons-material/OutlinedFlag';
import SendIcon from '@mui/icons-material/SendOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmberOutlined';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useTheme } from '@mui/material/styles';
import { agentAvatar } from '../data/inboxData';
import { useInboxData, useInboxModel } from '../InboxDataContext';
export function ReviewPanel() {
  const { reviewQueue, channelMeta } = useInboxModel();
  const { onDraftChanged } = useInboxData();
  const theme = useTheme();
  const iris = theme.iris;
  const [index, setIndex] = useState(0);
  const [resolved, setResolved] = useState<
    Record<string, 'approved' | 'dismissed'>>(
    {});
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const item = reviewQueue[index];
  const meta = item ? channelMeta[item.channel] : undefined;
  const Icon = meta?.icon;
  const status = item ? resolved[item.id] : undefined;
  const draftValue = item ? (drafts[item.id] ?? item.draft) : '';
  const remaining = useMemo(
    () => reviewQueue.filter((r) => !resolved[r.id]).length,
    [resolved, reviewQueue]
  );
  const go = (dir: 1 | -1) => {
    setEditing(false);
    setIndex((i) => (i + dir + reviewQueue.length) % Math.max(reviewQueue.length, 1));
  };

  // POST a draft action to /api/threads/[threadRef]/draft/action then resolve
  // the item locally. Optimistic: parent removes the draft via onDraftChanged.
  const submitAction = async (
    action: 'approve_send' | 'save_edit' | 'dismiss',
    bodyOverride?: string,
  ) => {
    if (!item || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(item.threadRef)}/draft/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          channel: item.channel,
          body: bodyOverride ?? item.draft,
          to: item.contact,
        }),
      });
      if (!res.ok) throw new Error(`draft action failed (${res.status})`);
      setResolved((r) => ({ ...r, [item.id]: action === 'dismiss' ? 'dismissed' : 'approved' }));
      onDraftChanged?.(item.key);
    } catch (err) {
      // keep item actionable on failure
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const confidencePct = item ? Math.round(item.confidence * 100) : 0;
  const confColor = item
    ? (item.confidence >= 0.7
        ? iris.success
        : item.confidence >= 0.6
          ? iris.warning
          : iris.danger)
    : iris.textSubtle;
  if (!item) {
    return (
      <Card sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle1">Human review queue</Typography>
          <Typography variant="caption" color="text.secondary">
            Nothing flagged for human review right now.
          </Typography>
        </Box>
      </Card>
    );
  }
  return (
    <Card
      sx={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
      
      {/* Header */}
      <Box
        sx={{
          p: 2,
          pb: 1.5
        }}>
        
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center">
          
          <Stack direction="row" spacing={1} alignItems="center">
            <FlagIcon
              fontSize="small"
              sx={{
                color: 'warning.main'
              }} />
            
            <Typography variant="subtitle1">Human review queue</Typography>
          </Stack>
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={`${remaining} flagged`} />
          
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Approve, edit, or dismiss Iris's drafts before they send.
        </Typography>
      </Box>
      <Divider />

      {/* Inbound message */}
      <Box
        sx={{
          p: 2
        }}>
        
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
            mb: 1.5
          }}>
          
          <Stack
            direction="row"
            spacing={1.25}
            alignItems="center"
            sx={{
              minWidth: 0
            }}>
            
            <Avatar
              variant="rounded"
              sx={{
                bgcolor: 'action.selected',
                color: meta?.accent,
                width: 36,
                height: 36
              }}>

              {Icon ? <Icon fontSize="small" /> : null}
            </Avatar>
            <Box
              sx={{
                minWidth: 0
              }}>
              
              <Typography variant="subtitle2" noWrap>
                {item.contact}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {meta?.label ?? item.channel} · {item.receivedAt}
              </Typography>
            </Box>
          </Stack>
          <Chip
            size="small"
            icon={<FlagIcon />}
            label={item.intent}
            sx={{
              bgcolor: iris.warningSoft,
              color: iris.warning,
              '& .MuiChip-icon': {
                color: iris.warning,
                fontSize: 14
              }
            }} />

        </Stack>

        <Box
          sx={{
            p: 1.5,
            borderRadius: 2,
            bgcolor: 'action.hover',
            border: '1px solid',
            borderColor: 'divider'
          }}>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              fontWeight: 600
            }}>

            Inbound message
          </Typography>
          <Typography
            variant="body2"
            sx={{
              mt: 0.5,
              lineHeight: 1.5
            }}>

            {item.inbound}
          </Typography>
        </Box>

        {/* "Needs a human" warning banner — warning-soft bg, icon square, matches
            the mockup's AI status card handoff banner pattern. */}
        <Stack
          direction="row"
          spacing={1.25}
          alignItems="center"
          sx={{
            mt: 1.5,
            p: 1.25,
            borderRadius: 2,
            bgcolor: iris.warningSoft,
            border: '1px solid',
            borderColor: iris.warning
          }}>

          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1.5,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: iris.warning,
              color: '#fff'
            }}>
            <WarningAmberIcon sx={{ fontSize: 16 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
              Needs a human
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: iris.warning,
                fontWeight: 600
              }}>

              {item.reason}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Divider />

      {/* AI Draft */}
      <Box
        sx={{
          p: 2,
          flex: 1
        }}>
        
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
            mb: 1
          }}>
          
          <Stack direction="row" spacing={1} alignItems="center">
            <Avatar src={agentAvatar} alt="Iris" sx={{ width: 20, height: 20 }} />
            <Typography variant="subtitle2">Iris's drafted reply</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Confidence
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: confColor,
                fontWeight: 700
              }}>
              
              {confidencePct}%
            </Typography>
          </Stack>
        </Stack>

        <LinearProgress
          variant="determinate"
          value={confidencePct}
          sx={{
            height: 5,
            borderRadius: 3,
            mb: 1.5,
            bgcolor: 'action.selected',
            '& .MuiLinearProgress-bar': {
              bgcolor: confColor,
              borderRadius: 3
            }
          }} />


        {editing ?
        <TextField
          fullWidth
          multiline
          minRows={5}
          value={draftValue}
          onChange={(e) =>
          setDrafts((d) => ({
            ...d,
            [item.id]: e.target.value
          }))
          }
          autoFocus
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: iris.accentSoft,
              fontSize: 14,
              lineHeight: 1.6
            }
          }} /> :


        <Box
          sx={{
            p: 1.75,
            borderRadius: 2,
            bgcolor: iris.accentSoft,
            border: '1px solid',
            borderColor: iris.accent
          }}>

            <Typography
            variant="body2"
            sx={{
              lineHeight: 1.6
            }}>

              {draftValue}
            </Typography>
          </Box>
        }
      </Box>

      <Divider />

      {/* Action bar */}
      <Box
        sx={{
          p: 2
        }}>
        
        {status ?
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            p: 1.25,
            borderRadius: 2,
            bgcolor:
            status === 'approved' ?
            iris.successSoft :
            'action.hover'
          }}>

            <CheckCircleIcon
            fontSize="small"
            sx={{
              color:
              status === 'approved' ? iris.success : 'text.secondary'
            }} />

            <Typography
            variant="body2"
            sx={{
              color:
              status === 'approved' ? iris.success : 'text.secondary',
              fontWeight: 600
            }}>

              {status === 'approved' ?
            'Approved & sent by you' :
            'Dismissed — Iris will not send'}
            </Typography>
          </Stack> :

        <Stack direction="row" spacing={1}>
            {editing ?
          <Button
            fullWidth
            variant="contained"
            disabled={submitting}
            startIcon={<SendIcon />}
            onClick={() => {
              setEditing(false);
              submitAction('approve_send', draftValue);
            }}>

                Send edited reply
              </Button> :

          <Button
            fullWidth
            variant="contained"
            disabled={submitting}
            startIcon={<CheckCircleIcon />}
            onClick={() => submitAction('approve_send')}>

                Approve & send
              </Button>
          }
            <Tooltip title={editing ? 'Cancel edit' : 'Edit draft'}>
              <IconButton
              onClick={() => setEditing((e) => !e)}
              disabled={submitting}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2
              }}
              aria-label="Edit draft">

                {editing ?
              <CloseIcon fontSize="small" /> :

              <EditIcon fontSize="small" />
              }
              </IconButton>
            </Tooltip>
            <Tooltip title="Dismiss draft">
              <IconButton
              disabled={submitting}
              onClick={() => submitAction('dismiss')}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2
              }}
              aria-label="Dismiss draft">

                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        }

        {/* Pager */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
            mt: 1.5
          }}>
          
          <IconButton
            size="small"
            onClick={() => go(-1)}
            aria-label="Previous flagged item">
            
            <KeyboardArrowLeftIcon fontSize="small" />
          </IconButton>
          <Typography variant="caption" color="text.secondary">
            {index + 1} of {reviewQueue.length} flagged
          </Typography>
          <IconButton
            size="small"
            onClick={() => go(1)}
            aria-label="Next flagged item">
            
            <KeyboardArrowRightIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>
    </Card>);

}
