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
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import FlagIcon from '@mui/icons-material/OutlinedFlag';
import SendIcon from '@mui/icons-material/SendOutlined';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { reviewQueue, channelMeta } from '../data/inboxData';
export function ReviewPanel() {
  const [index, setIndex] = useState(0);
  const [resolved, setResolved] = useState<
    Record<string, 'approved' | 'dismissed'>>(
    {});
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const item = reviewQueue[index];
  const meta = channelMeta[item.channel];
  const Icon = meta.icon;
  const status = resolved[item.id];
  const draftValue = drafts[item.id] ?? item.draft;
  const remaining = useMemo(
    () => reviewQueue.filter((r) => !resolved[r.id]).length,
    [resolved]
  );
  const go = (dir: 1 | -1) => {
    setEditing(false);
    setIndex((i) => (i + dir + reviewQueue.length) % reviewQueue.length);
  };
  const confidencePct = Math.round(item.confidence * 100);
  const confColor =
  item.confidence >= 0.7 ?
  '#34d399' :
  item.confidence >= 0.6 ?
  '#fbbf24' :
  '#f87171';
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
                bgcolor: 'rgba(148,163,184,0.14)',
                color: meta.accent,
                width: 36,
                height: 36
              }}>
              
              <Icon fontSize="small" />
            </Avatar>
            <Box
              sx={{
                minWidth: 0
              }}>
              
              <Typography variant="subtitle2" noWrap>
                {item.contact}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {meta.label} · {item.receivedAt}
              </Typography>
            </Box>
          </Stack>
          <Chip
            size="small"
            icon={<FlagIcon />}
            label={item.intent}
            sx={{
              bgcolor: 'rgba(251,191,36,0.12)',
              color: 'warning.main',
              '& .MuiChip-icon': {
                color: 'warning.main',
                fontSize: 14
              }
            }} />
          
        </Stack>

        <Box
          sx={{
            p: 1.5,
            borderRadius: 2,
            bgcolor: 'rgba(148,163,184,0.06)',
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

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            mt: 1.5,
            p: 1,
            borderRadius: 2,
            bgcolor: 'rgba(251,191,36,0.08)'
          }}>
          
          <FlagIcon
            fontSize="small"
            sx={{
              color: 'warning.main'
            }} />
          
          <Typography
            variant="caption"
            sx={{
              color: 'warning.main',
              fontWeight: 600
            }}>
            
            {item.reason}
          </Typography>
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
            <AutoAwesomeIcon
              fontSize="small"
              sx={{
                color: 'primary.light'
              }} />
            
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
            bgcolor: 'rgba(148,163,184,0.18)',
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
              bgcolor: 'rgba(129,140,248,0.06)',
              fontSize: 14,
              lineHeight: 1.6
            }
          }} /> :


        <Box
          sx={{
            p: 1.75,
            borderRadius: 2,
            bgcolor: 'rgba(129,140,248,0.07)',
            border: '1px solid',
            borderColor: 'rgba(129,140,248,0.2)'
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
            'rgba(52,211,153,0.12)' :
            'rgba(148,163,184,0.1)'
          }}>
          
            <CheckCircleIcon
            fontSize="small"
            sx={{
              color:
              status === 'approved' ? 'success.main' : 'text.secondary'
            }} />
          
            <Typography
            variant="body2"
            sx={{
              color:
              status === 'approved' ? 'success.main' : 'text.secondary',
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
            startIcon={<SendIcon />}
            onClick={() => {
              setEditing(false);
              setResolved((r) => ({
                ...r,
                [item.id]: 'approved'
              }));
            }}>
            
                Send edited reply
              </Button> :

          <Button
            fullWidth
            variant="contained"
            startIcon={<CheckCircleIcon />}
            onClick={() =>
            setResolved((r) => ({
              ...r,
              [item.id]: 'approved'
            }))
            }>
            
                Approve & send
              </Button>
          }
            <Tooltip title={editing ? 'Cancel edit' : 'Edit draft'}>
              <IconButton
              onClick={() => setEditing((e) => !e)}
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
              onClick={() =>
              setResolved((r) => ({
                ...r,
                [item.id]: 'dismissed'
              }))
              }
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