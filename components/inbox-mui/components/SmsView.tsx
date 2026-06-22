"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Card, CircularProgress, Stack, Tooltip, Typography, Avatar, Chip } from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import PersonIcon from '@mui/icons-material/PersonOutline';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter';
import { LiveCallPanel } from './LiveCallPanel';
import {
  agentAvatar,
  type SmsMessage,
  type LeadCategoryId } from
'../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { clearActivityEventTarget, useActivityEventTarget } from '../hooks/useActivityEventTarget';
import { usePersistedSelection } from '../hooks/usePersistedSelection';
import { useCategoryColors } from '../theme/CategoryColorContext';

type SmsViewProps = {
  onOpenVoice?: (threadId?: string) => void;
};

export function SmsView({ onOpenVoice }: SmsViewProps = {}) {
  const { smsThreads, leadCategories } = useInboxModel();
  const { colors } = useCategoryColors();
  const categoryValues = useMemo(
    () => ['all', ...leadCategories.map((c) => c.id)] as CategoryFilterValue[],
    [leadCategories]
  );
  const [category, setCategory] = usePersistedSelection<CategoryFilterValue>(
    'iris.inbox.sms.category',
    'all',
    categoryValues
  );
	  const counts = useMemo(() => {
    const base = Object.fromEntries(
      leadCategories.map((c) => [c.id, 0])
    ) as Record<LeadCategoryId, number>;
    smsThreads.forEach((t) => {
      base[t.category] += 1;
    });
    return base;
	  }, [leadCategories, smsThreads]);
  const categoryMeta = useMemo(
    () => Object.fromEntries(leadCategories.map((category) => [category.id, category])),
    [leadCategories]
  ) as Record<LeadCategoryId, (typeof leadCategories)[number]>;
  const visibleThreads = useMemo(
    () =>
    category === 'all' ?
    smsThreads :
    smsThreads.filter((t) => t.category === category),
    [category, smsThreads]
  );
  const visibleThreadIds = useMemo(
    () => visibleThreads.map((t) => t.id),
    [visibleThreads]
  );
  const [selectedId, setSelectedId] = usePersistedSelection(
    'iris.inbox.sms.thread',
    visibleThreadIds[0] ?? '',
    visibleThreadIds
  );
  const thread =
  visibleThreads.find((t) => t.id === selectedId) ??
  visibleThreads[0];
  const targetEventId = useActivityEventTarget('sms', thread?.id);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledTargetRef = useRef<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [dialing, setDialing] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);
  useEffect(() => {
    if (!targetEventId || scrolledTargetRef.current === targetEventId) return;
    const target = messageRefs.current.get(targetEventId);
    if (!target) return;
    scrolledTargetRef.current = targetEventId;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearActivityEventTarget();
    });
  }, [targetEventId, thread?.id]);
  useEffect(() => {
    if (targetEventId || !scrollRef.current) return;
    const el = scrollRef.current;
    const scrollLatest = () => {
      el.scrollTop = el.scrollHeight;
    };
    requestAnimationFrame(() => {
      scrollLatest();
      requestAnimationFrame(scrollLatest);
    });
    const timeout = window.setTimeout(scrollLatest, 120);
    return () => window.clearTimeout(timeout);
  }, [targetEventId, thread?.id, thread?.messages.length]);
  const handleSelectThread = (id: string) => {
    clearActivityEventTarget();
    setSelectedId(id);
  };
  const handleCallLead = async () => {
    if (!thread?.contact || dialing) return;
    setDialing(true);
    setDialError(null);
    try {
      const recentContext = thread.messages
        .slice(-6)
        .map((message) => `${message.direction === 'iris' ? 'Iris' : message.direction === 'owner' ? 'Owner' : thread.contact}: ${message.body || (message.media?.length ? `${message.media.length} MMS image${message.media.length === 1 ? '' : 's'}` : '')}`)
        .filter((line) => line.trim())
        .join('\n');
      const res = await fetch('/api/voice/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: thread.contact,
          leadName: thread.contact,
          callReason: 'follow up on the active SMS conversation',
          leadContext: recentContext,
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
  const handleCloseCall = () => {
    setActiveCallId(null);
    if (typeof window !== 'undefined' && thread?.id) {
      window.localStorage.setItem('iris.inbox.voice.thread', thread.id);
    }
    onOpenVoice?.(thread?.id);
  };
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}>
      
      <WorkspaceHeader
        title="SMS Threads"
        subtitle="Read the exact conversation as the AI handled it."
        count="51 touches" />
      

      <CategoryFilter
        value={category}
        onChange={setCategory}
        counts={counts}
        totalCount={smsThreads.length} />
      

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
          items={visibleThreads.map((t) => ({
            id: t.id,
            title: t.contact,
            time: t.time,
	            preview: t.preview,
	            meta: `${t.messageCount} messages`,
	            categoryLabel: categoryMeta[t.category]?.label,
	            categoryColor: colors[t.category]
	          }))}
          selectedId={thread?.id ?? ''}
          onSelect={handleSelectThread} />
        

        {thread ?
        <Card
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0
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
                <Typography variant="subtitle1">{thread.contact}</Typography>
                <Typography variant="caption" color="text.secondary">
                  sms:{thread.contact}
                </Typography>
              </Box>
              <Tooltip title={thread.contact ? `Call ${thread.contact} with Iris` : 'No phone number on file'}>
                <span>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={dialing ? <CircularProgress size={14} color="inherit" /> : <PhoneIcon fontSize="small" />}
                    onClick={handleCallLead}
                    disabled={!thread.contact || dialing || Boolean(activeCallId)}
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
            }}
            role="log"
            aria-label="SMS conversation">
            
              {activeCallId &&
              <LiveCallPanel
                callId={activeCallId}
                contactName={thread.contact}
                onClose={handleCloseCall} />
              }
              <Stack spacing={0.9}>
                {thread.messages.map((m) =>
              <SmsBubble
                key={m.id}
                message={m}
                contact={thread.contact}
                highlighted={m.eventId === targetEventId}
                registerTarget={(node) => {
                  if (node) messageRefs.current.set(m.eventId, node);
                  else messageRefs.current.delete(m.eventId);
                }} />
              )}
              </Stack>
            </Box>

            <ReaderFooter threadId={thread.id} channel="sms" to={thread.contact} />
          </Card> :

        <Card
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 4,
            minHeight: 200
          }}>
          
            <Typography variant="body2" color="text.secondary">
              No conversations in this category.
            </Typography>
          </Card>
        }
      </Box>
    </Box>);

}
export function SmsBubble({
  message,
  contact,
  highlighted,
  registerTarget



}: {message: SmsMessage;contact: string;highlighted?: boolean;registerTarget?: (node: HTMLDivElement | null) => void;}) {
  const isIris = message.direction === 'iris';
  const isOwner = message.direction === 'owner';
  const isOutbound = message.direction !== 'inbound';
  const imageMedia = message.media?.filter((item) => (item.kind || 'image') === 'image') || [];
  const audioMedia = message.media?.filter((item) => item.kind === 'audio') || [];
  const fileMedia = message.media?.filter((item) => item.kind === 'file') || [];
  const voiceTranscripts = (message.body || "")
    .split("\n")
    .map((line) => line.trim().match(/^Voice note transcript:\s*(.+)$/i)?.[1]?.trim() || "")
    .filter(Boolean);
  const visibleBody = (message.body || "")
    .split("\n")
    .filter((line) => !/^Voice note transcript:/i.test(line.trim()))
    .join("\n")
    .trim();
  const cleanHtml =
    message.html && typeof window !== 'undefined'
      ? (() => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const DOMPurify = require('dompurify');
          return DOMPurify.sanitize(message.html, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
          });
        })()
      : message.html;
  return (
    <Box
      ref={registerTarget}
      sx={{
        display: 'flex',
        flexDirection: isOutbound ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: 1,
        scrollMargin: '24px'
      }}>

      <Avatar
        src={isIris ? agentAvatar : undefined}
        alt={isIris ? 'Iris, AI agent' : undefined}
        sx={{
          width: 28,
          height: 28,
          flexShrink: 0,
          bgcolor: (theme) => isIris
            ? theme.palette.primary.main
            : isOwner
              ? theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.2)' : theme.palette.text.primary
              : theme.palette.action.selected,
          color: (theme) => isOwner && theme.palette.mode === 'dark' ? theme.palette.text.primary : 'background.paper'
        }}>
        {!isIris && <PersonIcon sx={{ fontSize: 16, color: (theme) => isOwner && theme.palette.mode === 'dark' ? theme.palette.text.primary : isOwner ? theme.palette.background.paper : '#64748b' }} aria-hidden />}
      </Avatar>

      <Box
        sx={{
          maxWidth: { xs: '84%', md: '68%' },
          display: 'flex',
          flexDirection: 'column',
          alignItems: isOutbound ? 'flex-end' : 'flex-start'
        }}>

        <Stack
          direction="row"
          spacing={1}
          justifyContent={isOutbound ? 'flex-end' : 'flex-start'}
          alignItems="center"
          sx={{
            mb: 0.25
          }}>

          <Typography
            sx={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'text.secondary'
            }}>

            {isIris ? 'Iris sent' : isOwner ? 'Owner sent' : `${contact} received`}
          </Typography>
          <Typography
            sx={{
              fontSize: '10px',
              fontFamily: 'monospace',
              color: 'text.secondary'
            }}>
            {message.time}
          </Typography>
        </Stack>
        {!!imageMedia.length &&
        <SmsMediaGallery
          media={imageMedia}
          isIris={isOutbound}
          hasText={Boolean(visibleBody || cleanHtml || voiceTranscripts.length)} />
        }
        {!!audioMedia.length &&
        <Stack spacing={0.75} sx={{ mt: imageMedia.length ? 0.7 : 0, mb: (visibleBody || cleanHtml) ? 0.7 : 0, alignSelf: isOutbound ? 'flex-end' : 'flex-start' }}>
          {audioMedia.map((item, index) => (
            <Box
              key={`${item.url}-${index}`}
              sx={{
                p: 0.75,
                borderRadius: 3,
                bgcolor: (theme) => isOutbound
                  ? theme.palette.primary.main
                  : theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.12)' : theme.palette.background.default,
                border: '1px solid',
                borderColor: (theme) => isOutbound ? 'rgba(255,255,255,0.18)' : theme.palette.divider,
                boxShadow: isOutbound ? '0 8px 24px rgba(99,102,241,0.18)' : 'none',
                '& audio': {
                  display: 'block',
                  width: { xs: 210, sm: 260 },
                  maxWidth: '100%',
                  height: 34,
                  colorScheme: (theme) => theme.palette.mode
                }
              }}>
              <audio controls preload="metadata" src={item.url} />
              {voiceTranscripts[index] &&
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 0.65,
                  px: 0.5,
                  color: isOutbound ? 'rgba(255,255,255,0.82)' : 'text.secondary',
                  lineHeight: 1.35,
                  whiteSpace: 'pre-wrap'
                }}>
                {voiceTranscripts[index]}
              </Typography>
              }
            </Box>
          ))}
        </Stack>
        }
        {!!fileMedia.length &&
        <Stack spacing={0.5} sx={{ mt: imageMedia.length || audioMedia.length ? 0.7 : 0, mb: (message.body || cleanHtml) ? 0.7 : 0, alignSelf: isOutbound ? 'flex-end' : 'flex-start' }}>
          {fileMedia.map((item, index) => (
            <Chip
              key={`${item.url}-${index}`}
              component="a"
              href={item.url}
              clickable
              size="small"
              label={item.alt || 'Attachment'}
            />
          ))}
        </Stack>
        }
        {(visibleBody || cleanHtml) &&
        <Box
          sx={{
            mt: message.media?.length ? 0.7 : 0,
            py: 1,
            px: 1.75,
            borderRadius: '16px',
            borderBottomRightRadius: isOutbound ? '4px' : '16px',
            borderBottomLeftRadius: isOutbound ? '16px' : '4px',
            bgcolor: (theme) => isIris
              ? theme.palette.primary.main
              : isOwner
                ? theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.16)' : theme.palette.text.primary
                : theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : theme.palette.background.default,
            color: (theme) => isOutbound
              ? isOwner && theme.palette.mode === 'dark' ? theme.palette.text.primary : '#fff'
              : theme.palette.text.secondary,
            border: highlighted ? '1px solid' : isOutbound ? 'none' : '1px solid',
            borderColor: highlighted ? 'primary.main' : 'divider',
            boxShadow: highlighted ? '0 0 0 3px rgba(99,102,241,0.18)' : 'none'
          }}>

          {cleanHtml ?
          <Box
            sx={{
              fontSize: '0.875rem',
              lineHeight: 1.5,
              color: (theme) => isOutbound ? isOwner && theme.palette.mode === 'dark' ? theme.palette.text.primary : '#fff' : theme.palette.text.secondary,
              overflowWrap: 'anywhere',
              '& a': { color: isOutbound ? '#fff' : 'primary.main' },
              '& img': { maxWidth: '100%', borderRadius: 1, display: 'block', my: 0.75 },
              '& p': { m: 0, mb: 0.75 }
            }}
            dangerouslySetInnerHTML={{ __html: cleanHtml }} /> :
          <Typography
            variant="body2"
            sx={{
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere'
            }}>

            {visibleBody}
          </Typography>
          }
        </Box>
        }
      </Box>
    </Box>);

}

export function SmsMediaGallery({
  media,
  isIris,
  hasText
}: {
  media: NonNullable<SmsMessage['media']>;
  isIris: boolean;
  hasText: boolean;
}) {
  const visible = media.slice(0, Math.min(media.length, 4));
  const count = media.length;
  const cardHeight = count === 1 ? 220 : 118;
  const cardWidth = count === 1 ? 288 : 176;
  const stackHeight = count === 1 ? 224 : count === 2 ? 182 : count === 3 ? 254 : 238;
  const offsets = [
    { top: 0, left: count >= 4 ? 48 : count === 1 ? 0 : 34, rotate: count >= 4 ? 0 : 0, z: 4 },
    { top: count >= 4 ? 10 : 78, left: count >= 4 ? 66 : 0, rotate: count >= 4 ? 7 : 0, z: count >= 4 ? 3 : 5 },
    { top: count >= 4 ? 20 : 150, left: count >= 4 ? 84 : 26, rotate: count >= 4 ? 13 : 0, z: count >= 4 ? 2 : 6 },
    { top: count >= 4 ? 30 : 170, left: count >= 4 ? 102 : 52, rotate: count >= 4 ? 19 : 0, z: 1 },
  ];
  return (
    <Box
      sx={{
        mb: hasText ? 0.1 : 0,
        width: count === 1 ? cardWidth : 240,
        height: stackHeight,
        position: 'relative',
        alignSelf: isIris ? 'flex-end' : 'flex-start',
        flexShrink: 0
      }}>
      {count > 4 &&
      <Typography
        variant="caption"
        sx={{
          position: 'absolute',
          top: -18,
          right: isIris ? 2 : 'auto',
          left: isIris ? 'auto' : 2,
          color: isIris ? 'primary.main' : 'text.secondary',
          fontWeight: 800,
          fontSize: 11
        }}>
        
        {count} Photos
      </Typography>
      }
      {visible.map((item, index) =>
      <Box
        key={`${item.url}-${index}`}
        sx={{
          position: 'absolute',
          top: offsets[index].top,
          left: offsets[index].left,
          width: cardWidth,
          height: cardHeight,
          borderRadius: 3.5,
          overflow: 'hidden',
          bgcolor: 'background.default',
          border: '1px solid',
          borderColor: isIris ? 'rgba(99,102,241,0.28)' : 'rgba(15,23,42,0.14)',
          boxShadow: '0 10px 28px rgba(15,23,42,0.22)',
          transform: `rotate(${offsets[index].rotate}deg)`,
          transformOrigin: 'center center',
          zIndex: offsets[index].z
        }}>
        <Box
          component="img"
          src={item.url}
          alt={item.alt}
          loading="lazy"
          sx={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }} />
      </Box>
      )}
    </Box>);
}
